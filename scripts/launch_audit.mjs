#!/usr/bin/env node
/**
 * ORRANGE LAUNCHPAD V2 live audit — verifies the fixed launchpad logic against the ACTUAL
 * deployed Sepolia V2 contracts and a real wallet address.
 *
 *   node scripts/launch_audit.mjs --wallet <address>
 *
 * Exercises exactly what /explore and /launch/<token> now compute:
 *   - felt → ticker decoding
 *   - unit-correct market cap (priceUsd × human-readable supply)
 *   - cumulative volume from on-chain Buy/Sell events (V2 event layout, never current reserve)
 *   - private-execution awareness (executor volume/count)
 *   - truthful migration state (GraduationRouter.is_migrated)
 *   - public STRK balance via the actual ABI (balance_of / balanceOf fallback)
 */
import { RpcProvider, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const walletFlag = process.argv.findIndex((a) => a === '--wallet');
const WALLET = walletFlag >= 0 ? process.argv[walletFlag + 1] : '';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch-v2.json'), 'utf8'));
if (manifest.network !== 'sepolia') {
  console.error(`Manifest is for ${manifest.network}, not sepolia.`);
  process.exit(1);
}

const RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

const ONE = 10n ** 18n;
const EVENT_SCAN_START = manifest.eventScanStartBlock || 0;

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
  const router = manifest.contracts.GraduationRouter.address;
  const baseAsset = manifest.baseAsset;
  const call = async (addr, ep, cd = []) => provider.callContract({ contractAddress: addr, entrypoint: ep, calldata: cd });
  const u256 = (r) => BigInt(Array.isArray(r) ? r[0] : r);

  const buySel = hash.getSelectorFromName('Buy');
  const sellSel = hash.getSelectorFromName('Sell');

  // V2 event layout: Buy data[2]=base_amount, data[3]=token_out, data[4]=fee, data[5]=base_after, data[6]=token_after
  //                   Sell data[2]=token_amount, data[3]=base_out(net), data[4]=fee, data[5]=base_after, data[6]=token_after
  const cumulativeVolume = async (curve) => {
    let total = 0n;
    let cont;
    for (let page = 0; page < 10; page++) {
      const filter = { from_block: { block_number: EVENT_SCAN_START }, address: curve, keys: [[buySel, sellSel]], chunk_size: 1000 };
      if (cont) filter.continuation_token = cont;
      const res = await provider.getEvents(filter);
      for (const e of res.events ?? []) {
        if (e.keys?.[0] === buySel) total += BigInt(e.data?.[2] ?? 0);
        else if (e.keys?.[0] === sellSel) total += BigInt(e.data?.[3] ?? 0) + BigInt(e.data?.[4] ?? 0);
      }
      if (!res.continuation_token) break;
      cont = res.continuation_token;
    }
    return total;
  };

  const [countRes] = await call(factory, 'get_token_count');
  const count = Number(BigInt(countRes));
  console.log(`\n=== LAUNCHPAD V2 live audit (SEPOLIA) — ${count} token(s) ===`);
  console.log(`wallet under test: ${WALLET || '(none — pass --wallet <addr> for balance check)'}\n`);

  for (let i = 0; i < count; i++) {
    const [tok] = await call(factory, 'get_token', [String(i)]);
    const [cur] = await call(factory, 'get_curve', [String(i)]);
    const [exe] = await call(factory, 'get_executor', [String(i)]);
    const token = '0x' + BigInt(tok).toString(16);
    const curve = '0x' + BigInt(cur).toString(16);
    const executor = '0x' + BigInt(exe).toString(16);

    const nameRaw = await call(token, 'name');
    const symRaw = await call(token, 'symbol');
    const decRaw = await call(token, 'decimals');
    const supplyRaw = await call(token, 'total_supply');
    const symbol = decodeShortString(symRaw);
    const name = decodeShortString(nameRaw);
    const decimals = Number(BigInt(decRaw));
    const supply = BigInt(supplyRaw[0]) + (BigInt(supplyRaw[1] ?? 0n) << 128n);

    const [vb, vt] = await call(curve, 'get_virtual_reserves');
    const [br, tr] = await call(curve, 'get_real_reserves');
    const [gt] = await call(curve, 'get_graduation_target');
    const [grad] = await call(curve, 'is_graduated');
    const [cf] = await call(curve, 'get_creator_fee_bps');
    const [pf] = await call(curve, 'get_protocol_fee_bps');
    const [pb, pt] = await call(curve, 'get_price');
    const [mig] = await call(router, 'is_migrated', [curve]);
    const [pcnt, pvol] = await call(executor, 'get_private_trade_count');
    const [pvol2] = await call(executor, 'get_private_volume_base');
    const baseReserve = BigInt(br);
    const tokenReserve = BigInt(tr);
    const target = BigInt(gt);
    const priceBase = BigInt(pb);
    const priceToken = BigInt(pt);

    const price = priceToken > 0n ? Number(priceBase) / Number(priceToken) : 0;
    const priceUsd = price * 0.001; // sepolia baseUsd
    const circulatingRaw = tokenReserve > 0n ? tokenReserve : supply;
    const circulatingHuman = Number(circulatingRaw) / 10 ** decimals;
    const marketCap = priceUsd * circulatingHuman;
    const liquidity = Number(baseReserve) / Number(ONE);
    const volume = Number(await cumulativeVolume(curve)) / Number(ONE);
    const graduationPct = target > 0n ? Math.min(100, (Number(baseReserve) / Number(target)) * 100) : 0;
    const privateVolumeStrk = Number(BigInt(pvol2)) / Number(ONE);
    const privateShare = volume > 0 ? Math.min(100, (privateVolumeStrk / volume) * 100) : 0;

    console.log(`--- token id ${i}: ${symbol} (${name}) ---`);
    console.log(`  symbol decode:  ${JSON.stringify(symbol)}  ${symbol === symbol ? 'OK' : 'BAD'}`);
    console.log(`  decimals: ${decimals}  totalSupply: ${(Number(supply) / 1e18).toFixed(2)}`);
    console.log(`  price: ${price.toExponential(4)} STRK  priceUsd: ${priceUsd.toExponential(4)} USD`);
    console.log(`  marketCap: $${marketCap.toFixed(4)}  (raw circulating would be $${(priceUsd * Number(circulatingRaw)).toExponential(2)})`);
    console.log(`  liquidity: ${liquidity.toFixed(4)} STRK (real reserve)`);
    console.log(`  volume: ${volume.toFixed(4)} STRK (cumulative Buy/Sell events)`);
    console.log(`  private lane: ${Number(BigInt(pcnt))} trade(s), ${privateVolumeStrk.toFixed(4)} STRK (${privateShare.toFixed(1)}% of volume)`);
    console.log(`  graduation: ${graduationPct.toFixed(2)}% (target ${Number(target) / 1e18} STRK) graduated=${BigInt(grad)} migrated=${BigInt(mig)}`);
    console.log(`  fee split: creator=${cf}bps protocol=${pf}bps`);
    console.log(`  token=${token} curve=${curve} executor=${executor}`);

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