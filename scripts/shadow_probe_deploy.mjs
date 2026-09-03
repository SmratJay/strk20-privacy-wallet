#!/usr/bin/env node
/**
 * ORRANGE — ShadowExecutionProbe deployment (Starknet Sepolia).
 *
 * Deploys the tiny acceptance application that a REAL STRK20 shadow account calls. The probe
 * records `{ caller (the shadow account), amount, block }` so the shadow-account execution is
 * observable on-chain (application sees the SHADOW account as caller, never the root wallet).
 *
 * Steps: declare (idempotent) → deploy → write deployments/shadow-execution-sepolia.json →
 * print the .env.local line to wire the UI.
 *
 * Usage:
 *   (cd contracts && scarb build) then: node scripts/shadow_probe_deploy.mjs
 */
import { Account, RpcProvider, json, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEPLOYMENTS_DIR = path.join(ROOT, 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const OUTPUT_FILE = path.join(DEPLOYMENTS_DIR, 'shadow-execution-sepolia.json');

const RPC = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

const SIERRA = path.join(ROOT, 'contracts/target/dev/pel_perpetuals_core_ShadowExecutionProbe.contract_class.json');
const CASM = path.join(ROOT, 'contracts/target/dev/pel_perpetuals_core_ShadowExecutionProbe.compiled_contract_class.json');

const bounds = {
  l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
  l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
  l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
};

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const sierra = json.parse(fs.readFileSync(SIERRA, 'utf8'));
  const casm = json.parse(fs.readFileSync(CASM, 'utf8'));
  const classHash = hash.computeContractClassHash(sierra);

  console.log(`Deployer:   ${deployerData.accountAddress}`);
  console.log(`ShadowExecutionProbe class hash: ${classHash}`);

  // 1. Declare (idempotent).
  try {
    const declared = await account.declareIfNot({ contract: sierra, casm, classHash }, { resourceBounds: bounds });
    if (declared.transaction_hash) {
      console.log(`Probe class declared (tx ${declared.transaction_hash})`);
      await provider.waitForTransaction(declared.transaction_hash, { retryInterval: 3000 });
    } else {
      console.log(`Probe class declared (${declared.class_hash})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already declared/i.test(msg)) throw err;
    console.log('Probe class already declared.');
  }

  // 2. Deploy (no constructor args).
  let nonce;
  try {
    nonce = await provider.getNonceForAddress(deployerData.accountAddress, 'pending');
  } catch {
    nonce = await provider.getNonceForAddress(deployerData.accountAddress, 'latest');
  }
  let deploy;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      deploy = await account.deployContract({ classHash, constructorCalldata: [] }, { resourceBounds: bounds, nonce });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const expected = msg.match(/Expected: nonce\s+(\d+)/i);
      if (expected && attempt < 4) {
        nonce = BigInt(expected[1]);
        continue;
      }
      throw err;
    }
  }
  if (!deploy) throw new Error('Deploy did not complete.');
  const address = deploy.contract_address;
  console.log(`Deploying probe at ${address} (tx ${deploy.transaction_hash})`);
  const receipt = await provider.waitForTransaction(deploy.transaction_hash, { retryInterval: 3000 });
  const execStatus =
    receipt && typeof receipt === 'object' ? (receipt.execution_status ?? receipt.status ?? 'unknown') : 'unknown';
  console.log(`Deploy finality: ${execStatus}`);

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        network: 'sepolia',
        updatedAt: new Date().toISOString(),
        contract: {
          name: 'ShadowExecutionProbe',
          address,
          classHash,
          deployTx: deploy.transaction_hash,
          status: execStatus === 'SUCCEEDED' ? 'DEPLOYED' : 'PENDING_CONFIRM',
        },
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log('\n.env.local line to wire the UI default target:');
  console.log(`NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA=${address}`);
}

main().catch((err) => {
  console.error('Deploy failed:', err);
  process.exit(1);
});