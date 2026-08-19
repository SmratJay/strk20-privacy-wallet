import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';
const DEPLOYER_FILE = path.join(process.cwd(), 'deployments/deployer_account.json');
const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

async function testSimulation() {
  const provider = new RpcProvider({ nodeUrl: SEPOLIA_RPC });
  const account = new Account({
    provider,
    address: deployerData.accountAddress,
    signer: deployerData.privateKey,
  });

  console.log('Testing deployAccount simulation for address: ' + deployerData.accountAddress);
  console.log('Class Hash          : ' + deployerData.classHash);
  console.log('Constructor Calldata: ' + JSON.stringify(deployerData.constructorCalldata));

  try {
    const feeEstimate = await account.estimateAccountDeployFee({
      classHash: deployerData.classHash,
      constructorCalldata: deployerData.constructorCalldata,
      addressSalt: deployerData.publicKey,
    });
    console.log('\n\x1b[32m✓ SIMULATION PASSED! The account is 100% valid and deployable on Sepolia!\x1b[0m');
    console.log('Estimated Gas / Fee:', feeEstimate);
  } catch (err) {
    console.error('Simulation error:', err.message);
    if (err.data) console.error('Data:', JSON.stringify(err.data, null, 2));
  }
}

testSimulation();
