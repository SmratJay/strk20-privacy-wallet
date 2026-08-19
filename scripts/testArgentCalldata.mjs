import { ec, hash, CallData, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const ARGENT_ACCOUNT_CLASS_HASH = '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f';
const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';

const DEPLOYER_FILE = path.join(process.cwd(), 'deployments/deployer_account.json');
const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

// Argent v0.4.0 constructor calldata:
// 1. owner: Signer::Starknet(StarknetSigner { pubkey }) -> [0, pubkey]
// 2. guardian: Option::None -> [1]
const constructorCalldata = ['0x0', deployerData.publicKey, '0x1'];

const correctAddress = hash.calculateContractAddressFromHash(
  deployerData.publicKey,
  ARGENT_ACCOUNT_CLASS_HASH,
  constructorCalldata,
  0
);

console.log('PublicKey           :', deployerData.publicKey);
console.log('Constructor Calldata:', constructorCalldata);
console.log('Correct Address     :', correctAddress);

deployerData.constructorCalldata = constructorCalldata;
deployerData.accountAddress = correctAddress;
fs.writeFileSync(DEPLOYER_FILE, JSON.stringify(deployerData, null, 2));
