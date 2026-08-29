#!/usr/bin/env node
/**
 * UMBRA LAUNCH live audit — verifies the fixed launchpad logic against the ACTUAL deployed
 * Sepolia contracts (HAMSTR + STRKFTW) and a real wallet address.
 *
 *   node scripts/launch_audit.mjs --sepolia --wallet <address>
 *
 * Exercises exactly what /explore and /launch/<token> now compute:
 *   - felt → ticker decoding (must print STRKFTW, never 0x5354524B465457)
 *   - unit-correct market cap (priceUsd × human-readable supply)
 *   - cumulative volume from on-chain Buy/Sell events (never current reserve)
 *   - public STRK balance via the actual ABI (balance_of / balanceOf fallback)
 */
import { RpcProvider, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const isSepolia = process.argv.includes('--sepolia');
const NETWORK = isSepolia ? 'sepolia' : 'mainnet';
const walletFlag = process.argv.findIndex((a) => a === '--wallet');
const WALLET = walletFlag >= 0 ? process.argv[walletFlag + 1] : '';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch.json'), 'utf8'));
if (manifest.network !== NETWORK) {
  console.error(`Manifest is for ${manifest.network}, not ${NETWORK}.`);
  process.exit(1);
}

const RPC = isSepolia
  ? process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia'
  : process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://free-rpc.nethermind.io/mainnet-juno';

const ONE = 10n ** 18n;
const EVENT_SCAN_START = 14247000; // before the Sepolia factory deployment (block 14247451)

// Mirror of src/services/launchService.decodeShortString
function decodeShortString(v) {
  const unwrapped = Array.isArray(v) ? (v.length > 0 ? v[0] : '') : v;
  if (unwrapped === null || unwrapped === undefined) return '';
  const fromHex = (hex) => {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (byte === 0) break;
      out += String.fromCharCode(byte);
    }
    return out;
  };
  if (typeof unwrapped === 'bigint' || typeof unwrapped === 'number') {
    try {
      const hex = unwrapped.toString(16).padStart(Math.ceil(unwrapped.toString(16).length / 2) * 2, '0');
      return fromHex(hex) || unwrapped.toString();
    } catch {
      return String(unwrapped);
    }
  }
  if (typeof unwrapped === 'string') {
    if (/^0x[0-9a-f]+$/i.test(unwrapped)) {
      try {
        const hex = BigInt(unwrapped).toString(16).padStart(Math.ceil(BigInt(unwrapped).toString(16).length / 2) * 2, '0');
        return fromHex(hex) || unwrapped;
      } catch {
        return unwrapped;
      }
    }
    return unwrapped;
  }
  return String(unwrapped ?? '');
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const factory = manifest.contracts.TokenFactory.address;
  const baseAsset = manifest.baseAsset;
  const call = async (addr, ep, cd = []) => provider.callContract({ contractAddress: addr, entrypoint: ep, calldata: cd });
  const u256 = (r) => BigInt(Array.isArray(r) ? r[0] : r);

  const buySel = hash.getSelectorFromName('Buy');
  const sellSel = hash.getSelectorFromName('Sell');

  const cumulativeVolume = async (curve) => {
    let total = 0n;
    let cont;
    for (let page = 0; page < 10; page++) {
      const filter = { from_block: { block_number: EVENT_SCAN_START }, address: curve, keys: [[buySel, sellSel]], chunk_size: 1000 };
      if (cont) filter.continuation_token = cont;
      const res = await provider.getEvents(filter);
      for (const e of res.events ?? []) {
        if (e.keys?.[0] === buySel) total += BigInt(e.data?.[2] ?? 0);
        else if (e.keys?.[0] === sellSel) total += BigInt(e.data?.[3] ?? 0);
      }
      if (!res.continuation_token) break;
      cont = res.continuation_token;
    }
    return total;
  };

  const [countRes] = await call(factory, 'get_token_count');
  const count = Number(BigInt(countRes));
  console.log(`\n=== UMBRA LAUNCH live audit (${NETWORK.toUpperCase()}) — ${count} token(s) ===`);
  console.log(`wallet under test: ${WALLET || '(none — pass --wallet <addr> for balance check)'}\n`);

  for (let i = 0; i < count; i++) {
    const [tok] = await call(factory, 'get_token', [String(i)]);
    const [cur] = await call(factory, 'get_curve', [String(i)]);
    const token = '0x' + BigInt(tok).toString(16);
    const curve = '0x' + BigInt(cur).toString(16);

    // 1) felt decode (raw callContract array shape)
    const nameRaw = await call(token, 'name');
    const symRaw = await call(token, 'symbol');
    const decRaw = await call(token, 'decimals');
    const supplyRaw = await call(token, 'total_supply');
    const symbol = decodeShortString(symRaw);
    const name = decodeShortString(nameRaw);
    const decimals = Number(BigInt(decRaw));
    const supply = BigInt(supplyRaw[0]) + (BigInt(supplyRaw[1] ?? 0n) << 128n);

    // 2) curve state
    const [vb, vt] = await call(curve, 'get_virtual_reserves');
    const [br, tr] = await call(curve, 'get_real_reserves');
    const [gt] = await call(curve, 'get_graduation_target');
    const [grad] = await call(curve, 'is_graduated');
    const [pb, pt] = await call(curve, 'get_price');
    const baseReserve = BigInt(br);
    const tokenReserve = BigInt(tr);
    const target = BigInt(gt);
    const priceBase = BigInt(pb);
    const priceToken = BigInt(pt);

    // 3) metrics (fixed logic)
    const price = priceToken > 0n ? Number(priceBase) / Number(priceToken) : 0;
    const priceUsd = price * 0.001; // sepolia baseUsd
    const circulatingRaw = tokenReserve > 0n ? tokenReserve : supply;
    const circulatingHuman = Number(circulatingRaw) / 10 ** decimals;
    const marketCap = priceUsd * circulatingHuman;
    const liquidity = Number(baseReserve) / Number(ONE);
    const volume = Number(await cumulativeVolume(curve)) / Number(ONE);
    const graduationPct = target > 0n ? Math.min(100, (Number(baseReserve) / Number(target)) * 100) : 0;

    console.log(`--- token id ${i}: ${symbol} (${name}) ---`);
    console.log(`  symbol decode:  ${JSON.stringify(symbol)} (raw=${JSON.stringify(symRaw)})  ${symbol === 'STRKFTW' || symbol === 'HAMSTR' ? 'OK' : 'BAD'}`);
    console.log(`  decimals: ${decimals}  totalSupply: ${(Number(supply) / 1e18).toFixed(2)}`);
    console.log(`  price: ${price.toExponential(4)} STRK  priceUsd: ${priceUsd.toExponential(4)} USD`);
    console.log(`  marketCap: $${marketCap.toFixed(4)}  (raw circulating would be $${(priceUsd * Number(circulatingRaw)).toExponential(2)})`);
    console.log(`  liquidity: ${liquidity.toFixed(4)} STRK (real reserve)`);
    console.log(`  volume: ${volume.toFixed(4)} STRK (cumulative Buy/Sell events)`);
    console.log(`  graduation: ${graduationPct.toFixed(2)}% (target ${Number(target) / 1e18} STRK) graduated=${BigInt(grad)}`);
    console.log(`  token=${token} curve=${curve}`);

    // 4) public STRK balance (actual ABI: balance_of then balanceOf)
    if (WALLET) {
      for (const ep of ['balance_of', 'balanceOf']) {
        try {
          const bal = await call(baseAsset, ep, [WALLET]);
          const b = Number(BigInt(bal[0])) / 1e18;
          console.log(`  public STRK (${ep}): ${b.toFixed(6)} STRK for ${WALLET.slice(0, 12)}…`);
          break;
        } catch {
          /* try next */
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});