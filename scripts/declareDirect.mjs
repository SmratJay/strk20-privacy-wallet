import { Account, RpcProvider, json, hash } from 'starknet';
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

  console.log(`Declaring StwoVerifier with 70M L2 gas amount...`);
  console.log(`Sierra Class Hash   : ${sierraClassHash}`);
  console.log(`Compiled Class Hash : ${compiledClassHash}`);

  const nonce = await provider.getNonceForAddress(deployerData.accountAddress);
  console.log(`Account Nonce       : ${nonce}`);

  const res = await account.declare(
    {
      contract: sierra,
      casm: casm,
      compiledClassHash: compiledClassHash,
    },
    {
      resourceBounds: {
        l2_gas: { max_amount: 70000000n, max_price_per_unit: 60000000000n },
        l1_gas: { max_amount: 10000n, max_price_per_unit: 200000000000000n },
        l1_data_gas: { max_amount: 5000n, max_price_per_unit: 5000000000000n },
      },
    }
  );

  console.log('✓ DECLARE TX BROADCASTED! Tx Hash:', res.transaction_hash);
  console.log('Waiting for block inclusion and confirmation on Starknet Sepolia...');
  const receipt = await provider.waitForTransaction(res.transaction_hash);
  console.log('✓ StwoVerifier declared successfully! Status:', receipt.execution_status || receipt.status || 'ACCEPTED_ON_L2');
}

main().catch((err) => {
  console.error('Declare error:', err);
  if (err.data) console.error('Data:', JSON.stringify(err.data, null, 2));
});
