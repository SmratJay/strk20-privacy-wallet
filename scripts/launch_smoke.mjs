#!/usr/bin/env node
/**
 * ORRANGE LAUNCHPAD V2 smoke test — reads a deployed token's REAL on-chain state and
 * optionally performs a tiny public buy.
 *
 *   node scripts/launch_smoke.mjs [--buy]
 *
 * Never fabricates: all values come from the chain. Requires a funded deployer account.
 */
import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch-v2.json'), 'utf8'),
);
if (manifest.network !== 'sepolia') {
  console.error(`Manifest is for ${manifest.network}, not sepolia.`);
  process.exit(1);
}

const RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const { token, curve, executor } = manifest.tokens.HAMSTR || {};

  console.log(`LAUNCHPAD V2 smoke → SEPOLIA`);
  console.log(`token    ${token}`);
  console.log(`curve    ${curve}`);
  console.log(`executor ${executor}`);

  const call = async (addr, entrypoint, calldata = []) =>
    provider.callContract({ contractAddress: addr, entrypoint, calldata });

  const [vb, vt] = await call(curve, 'get_virtual_reserves');
  const [br, tr] = await call(curve, 'get_real_reserves');
  const gt = await call(curve, 'get_graduation_target');
  const graduated = await call(curve, 'is_graduated');
  const [cf] = await call(curve, 'get_creator_fee_bps');
  const [pf] = await call(curve, 'get_protocol_fee_bps');
  const [mt] = await call(curve, 'get_max_trade_bps');
  const [pb, pt] = await call(curve, 'get_price');
  const supply = await call(token, 'total_supply');
  const [mig] = await call(manifest.contracts.GraduationRouter.address, 'is_migrated', [curve]);

  console.log('\n--- curve state (on-chain) ---');
  console.log(`virtual reserves      base=${vb} token=${vt}`);
  console.log(`real reserves         base=${br} token=${tr}`);
  console.log(`graduation target     ${gt} (graduated=${BigInt(graduated)})`);
  console.log(`fee split             creator=${cf} protocol=${pf} maxTrade=${mt}`);
  console.log(`migrated              ${BigInt(mig)}`);
  console.log(`price (base/token)    ${pb}/${pt}`);
  const supplyArr = Array.isArray(supply) ? supply : [supply.low, supply.high ?? 0n];
  const totalSupply = BigInt(supplyArr[0]) + (BigInt(supplyArr[1] ?? 0n) << 128n);
  console.log(`total supply          ${totalSupply}`);

  const ONE = 10n ** 18n;
  const amount = ONE; // 1 STRK
  const quote = await call(curve, 'quote_buy', [amount.toString()]);
  console.log(`\nquote_buy(1 STRK)     ${BigInt(quote)} tokens`);

  if (process.argv.includes('--buy')) {
    const deployer = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/deployer_account.json'), 'utf8'));
    const account = new Account({ provider, address: deployer.accountAddress, signer: deployer.privateKey });
    const bounds = {
      l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
      l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
      l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
    };
    const LOW_MASK = (1n << 128n) - 1n;
    const res = await account.execute(
      [
        { contractAddress: manifest.baseAsset, entrypoint: 'approve', calldata: [curve, (amount & LOW_MASK).toString(), (amount >> 128n).toString()] },
        { contractAddress: curve, entrypoint: 'buy', calldata: [amount.toString(), account.address] },
      ],
      { resourceBounds: bounds },
    );
    console.log(`\npublic buy tx: ${res.transaction_hash}`);
    await provider.waitForTransaction(res.transaction_hash);
    console.log('confirmed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});