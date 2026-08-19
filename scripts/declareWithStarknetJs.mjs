import { Account, RpcProvider, json, hash, cairo } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYER_FILE = path.join(process.cwd(), 'deployments/deployer_account.json');
const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

const TARGET_DEV_DIR = path.join(process.cwd(), 'contracts/target/dev');

async function main() {
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const sierraPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_StwoVerifier.contract_class.json`);
  const casmPath = path.join(TARGET_DEV_DIR, `pel_perpetuals_core_StwoVerifier.compiled_contract_class.json`);

  const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'));
  const casm = json.parse(fs.readFileSync(casmPath, 'utf8'));

  const compiledClassHash = hash.computeCompiledClassHash(casm);
  const sierraClassHash = hash.computeContractClassHash(sierra);

  console.log(`Sierra Class Hash   : ${sierraClassHash}`);
  console.log(`Compiled Class Hash : ${compiledClassHash}`);

  // Let's check if class is already declared
  try {
    const existingClass = await provider.getClassByHash(sierraClassHash);
    if (existingClass) {
      console.log('✓ Class already declared on-chain!');
      return;
    }
  } catch (e) {
    console.log('Class not declared yet, proceeding to declare...');
  }

  // Let's estimate fee or declare with resource bounds
  const declarePayload = {
    contract: sierra,
    casm: casm,
    compiledClassHash: compiledClassHash,
  };

  const fee = await account.estimateDeclareFee(declarePayload);
  console.log('Estimated Fee:', fee);

  const res = await account.declare(declarePayload);
  console.log('Declaration Tx Hash:', res.transaction_hash);
  await provider.waitForTransaction(res.transaction_hash);
  console.log('✓ Declaration confirmed!');
}

main().catch((err) => {
  console.error('Error:', err);
  if (err.data) console.error('Data:', JSON.stringify(err.data, null, 2));
});
