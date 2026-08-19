import { Account, RpcProvider, json, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');

async function main() {
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const name = 'PELPerpsCore';
  const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.contract_class.json`);
  const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_${name}.compiled_contract_class.json`);
  const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
  const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));
  const sierraClassHash = hash.computeContractClassHash(sierra);
  const compiledClassHash = hash.computeCompiledClassHash(casm);

  console.log(`Checking ${name} (${sierraClassHash})...`);
  try {
    const existing = await provider.getClassByHash(sierraClassHash);
    if (existing) {
      console.log('Already declared!');
      return;
    }
  } catch (e) {}

  console.log('Declaring with explicit bounds...');
  const bounds = {
    l2_gas: { max_amount: 500000000n, max_price_per_unit: 100000000000n },
    l1_gas: { max_amount: 10000n, max_price_per_unit: 300000000000000n },
    l1_data_gas: { max_amount: 5000n, max_price_per_unit: 15000000000000n },
  };

  try {
    const res = await account.declare(
      {
        contract: sierra,
        casm: casm,
        compiledClassHash: compiledClassHash,
      },
      { resourceBounds: bounds }
    );
    console.log('Success Tx:', res.transaction_hash);
    await provider.waitForTransaction(res.transaction_hash);
    console.log('Mined!');
  } catch (err) {
    console.error('FAILED DECLARE:', err.message || err);
  }
}

main().catch(console.error);
