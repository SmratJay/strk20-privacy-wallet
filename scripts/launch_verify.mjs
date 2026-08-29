#!/usr/bin/env node
/**
 * UMBRA LAUNCH verification — real on-chain BUY/SELL round trip + graduation progress.
 *
 *   node scripts/launch_verify.mjs --sepolia
 *
 * Reads the live curve, sells the deployer's full memecoin balance back through the real
 * BondingCurve, then re-reads. Nothing is fabricated; every number comes from the chain.
 */
import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const isSepolia = process.argv.includes('--sepolia');
const NETWORK = isSepolia ? 'sepolia' : 'mainnet';

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch.json'), 'utf8'),
);
if (manifest.network !== NETWORK) {
  console.error(`Manifest is for ${manifest.network}, not ${NETWORK}.`);
  process.exit(1);
}

const RPC = isSepolia
  ? process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia'
  : process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://free-rpc.nethermind.io/mainnet-juno';

const ONE = 10n ** 18n;

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const deployer = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/deployer_account.json'), 'utf8'));
  const account = new Account({ provider, address: deployer.accountAddress, signer: deployer.privateKey });
  const { token, curve } = manifest.tokens.HAMSTR;

  const call = async (addr, entrypoint, calldata = []) =>
    provider.callContract({ contractAddress: addr, entrypoint, calldata });

  const curveState = async (label) => {
    const [br, tr] = await call(curve, 'get_real_reserves');
    const gt = await call(curve, 'get_graduation_target');
    const graduated = await call(curve, 'is_graduated');
    const [pb, pt] = await call(curve, 'get_price');
    const base = BigInt(br);
    const target = BigInt(gt);
    const pct = target > 0n ? Math.min(100, (Number(base) / Number(target)) * 100) : 0;
    console.log(`\n--- ${label} ---`);
    console.log(`real base reserve    ${Number(base) / 1e18} STRK`);
    console.log(`real token reserve   ${Number(BigInt(tr)) / 1e18} tokens sold`);
    console.log(`graduation target    ${Number(target) / 1e18} STRK (${pct.toFixed(2)}%)`);
    console.log(`graduated            ${BigInt(graduated) === 1n}`);
    console.log(`price (base/token)   ${pb}/${pt}`);
  };

  await curveState('state BEFORE sell');

  const balRes = await call(token, 'balance_of', [deployer.accountAddress]);
  const balance = BigInt(balRes[0]) + (BigInt(balRes[1] ?? 0n) << 128n);
  console.log(`\ndeployer memecoin balance: ${Number(balance) / 1e18} tokens`);

  if (balance > 0n) {
    const bounds = {
      l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
      l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
      l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
    };
    // approve amount is a u256 → split [low, high] in calldata.
    const LOW_MASK = (1n << 128n) - 1n;
    const res = await account.execute(
      [
        { contractAddress: token, entrypoint: 'approve', calldata: [curve, (balance & LOW_MASK).toString(), (balance >> 128n).toString()] },
        { contractAddress: curve, entrypoint: 'sell', calldata: [balance.toString(), deployer.accountAddress] },
      ],
      { resourceBounds: bounds },
    );
    console.log(`\nreal sell tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    console.log('confirmed');
  } else {
    console.log('\nNothing to sell (no memecoin balance). Buy first via launch_smoke --buy.');
  }

  await curveState('state AFTER sell');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});