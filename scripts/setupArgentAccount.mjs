import { ec, hash, CallData, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const ARGENT_ACCOUNT_CLASS_HASH = '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f';
const SEPOLIA_RPC = 'https://api.cartridge.gg/x/starknet/sepolia';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');

if (!fs.existsSync(DEPLOYMENTS_DIR)) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
}

// Generate fresh STARK keypair
const privBytes = ec.starkCurve.utils.randomPrivateKey();
const privateKey = '0x' + Buffer.from(privBytes).toString('hex');
const publicKey = ec.starkCurve.getStarkKey(privateKey);

// Argent Account constructor: (owner, guardian)
const constructorCalldata = [publicKey, '0x0'];
const accountAddress = hash.calculateContractAddressFromHash(
  publicKey,
  ARGENT_ACCOUNT_CLASS_HASH,
  constructorCalldata,
  0
);

const accountInfo = {
  accountType: 'Argent_v0.4.0',
  network: 'sepolia',
  accountAddress,
  publicKey,
  privateKey,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  constructorCalldata,
  rpcUrl: SEPOLIA_RPC,
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(DEPLOYER_FILE, JSON.stringify(accountInfo, null, 2));

console.log('=============================================================');
console.log('  ARGENT V0.4.0 SEPOLIA DEPLOYER ACCOUNT INITIALIZED');
console.log('=============================================================');
console.log(`  Account Address : \x1b[32m${accountAddress}\x1b[0m`);
console.log(`  Public Key      : ${publicKey}`);
console.log(`  Class Hash      : ${ARGENT_ACCOUNT_CLASS_HASH}`);
console.log(`  Network         : Starknet Sepolia Testnet`);
console.log(`  Credentials     : deployments/deployer_account.json (GITIGNORED)`);
console.log('=============================================================');
console.log('\n\x1b[36m👉 Please send ~5 to 10 testnet STRK to this address.\x1b[0m\n');
