import { Account, RpcProvider, json, hash } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const deployerData = JSON.parse(fs.readFileSync('deployments/deployer_account.json', 'utf8'));
  const provider = new RpcProvider({ nodeUrl: 'https://api.cartridge.gg/x/starknet/sepolia' });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  const sierra = json.parse(fs.readFileSync('contracts/target/dev/pel_perpetuals_core_STRK20Adapter.contract_class.json', 'utf8'));
  const casm = json.parse(fs.readFileSync('contracts/target/dev/pel_perpetuals_core_STRK20Adapter.compiled_contract_class.json', 'utf8'));

  try {
    const fee = await account.estimateDeclareFee({ contract: sierra, casm });
    console.log('Estimated declare fee:', fee);
  } catch (err) {
    console.log('Estimate declare fee error:', err.message);
  }
}

main();
