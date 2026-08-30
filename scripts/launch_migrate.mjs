#!/usr/bin/env node
/**
 * ORRANGE LAUNCHPAD V2 liquidity migration — the truthful "LIQUIDITY MIGRATED" step.
 *
 *   node scripts/launch_migrate.mjs <liquidity_manager_address>
 *
 * Requires a GRADUATED curve. Governance sets the DEX liquidity manager on the
 * GraduationRouter, then forwards the router-held reserves (base + unsold tokens) to it.
 * After this, GraduationRouter.is_migrated(curve) === true — the UI stops saying "awaiting
 * migration" and shows LIQUIDITY MIGRATED. Nothing is faked: reserves actually move.
 */
import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const MANAGER = process.argv[2];
if (!MANAGER) {
  console.error('Usage: node scripts/launch_migrate.mjs <liquidity_manager_address>');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch-v2.json'), 'utf8'));
if (manifest.network !== 'sepolia') {
  console.error(`Manifest is for ${manifest.network}, not sepolia.`);
  process.exit(1);
}

const RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

const bounds = {
  l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
  l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
  l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
};

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const deployer = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/deployer_account.json'), 'utf8'));
  const account = new Account({ provider, address: deployer.accountAddress, signer: deployer.privateKey });
  const router = manifest.contracts.GraduationRouter.address;
  const { token, curve } = manifest.tokens.HAMSTR;
  const baseAsset = manifest.baseAsset;

  const call = async (addr, ep, cd = []) => provider.callContract({ contractAddress: addr, entrypoint: ep, calldata: cd });

  const [grad] = await call(curve, 'is_graduated');
  if (BigInt(grad) !== 1n) {
    console.error('Curve is NOT graduated yet. Run scripts/launch_graduate.mjs first.');
    process.exit(1);
  }
  const [mig] = await call(router, 'is_migrated', [curve]);
  if (BigInt(mig) === 1n) {
    console.log('Already migrated for this curve. Nothing to do.');
    return;
  }

  console.log(`setting liquidity manager -> ${MANAGER}`);
  const setTx = await account.execute(
    { contractAddress: router, entrypoint: 'set_liquidity_manager', calldata: [MANAGER] },
    { resourceBounds: bounds },
  );
  // Wait for confirmation so the account nonce advances before the next tx (the node
  // returns the old nonce while the previous tx is unconfirmed).
  await provider.waitForTransaction(setTx.transaction_hash);
  console.log(`manager set tx: ${setTx.transaction_hash}`);

  console.log('forwarding reserves...');
  const tx = await account.execute(
    { contractAddress: router, entrypoint: 'forward_reserves', calldata: [curve, token, baseAsset] },
    { resourceBounds: bounds },
  );
  await provider.waitForTransaction(tx.transaction_hash);
  console.log(`forward tx: ${tx.transaction_hash}`);

  const [mig2] = await call(router, 'is_migrated', [curve]);
  const mgrBase = await call(baseAsset, 'balanceOf', [MANAGER]);
  const mgrTok = await call(token, 'balance_of', [MANAGER]);
  const baseBal = BigInt(mgrBase[0]) + (BigInt(mgrBase[1] ?? 0n) << 128n);
  const tokBal = BigInt(mgrTok[0]) + (BigInt(mgrTok[1] ?? 0n) << 128n);
  console.log('\n--- migration verification (on-chain) ---');
  console.log(`is_migrated        ${BigInt(mig2) === 1n}`);
  console.log(`manager STRK       ${Number(baseBal) / 1e18} STRK`);
  console.log(`manager tokens     ${Number(tokBal) / 1e18} tokens`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});