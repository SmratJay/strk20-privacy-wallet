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

  const name = 'STRK20Adapter';
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

  console.log('Fetching live dynamic gas bounds...');
  let l1GasPrice = 200000000000000n;
  let l2GasPrice = 50000000000n;
  let l1DataGasPrice = 5000000000000n;

  try {
    const block = await provider.getBlockWithTxs('latest');
    if (block.l1_gas_price?.price_in_fri) l1GasPrice = BigInt(block.l1_gas_price.price_in_fri);
    if (block.l2_gas_price?.price_in_fri) l2GasPrice = BigInt(block.l2_gas_price.price_in_fri);
    if (block.l1_data_gas_price?.price_in_fri) l1DataGasPrice = BigInt(block.l1_data_gas_price.price_in_fri);
  } catch (e) {}

  const bounds = {
    l2_gas: { max_amount: 300000000n, max_price_per_unit: (l2GasPrice * 18n) / 10n },
    l1_gas: { max_amount: 500n, max_price_per_unit: (l1GasPrice * 18n) / 10n },
    l1_data_gas: { max_amount: 500n, max_price_per_unit: (l1DataGasPrice * 18n) / 10n },
  };

  try {
    const res = await account.declare(
      { contract: sierra, casm, compiledClassHash },
      { resourceBounds: bounds }
    );
    console.log('Success Tx:', res.transaction_hash);
    await provider.waitForTransaction(res.transaction_hash);
    console.log('Declared successfully!');
  } catch (err) {
    console.error('Declare failed:', err.message || err);
  }
}

main().catch(console.error);
