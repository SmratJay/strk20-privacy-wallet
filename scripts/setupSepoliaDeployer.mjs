import { ec, hash, CallData, stark } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f22811551ccdef710877b173b4664514d3021483d1ba42013c2e577';
const SEPOLIA_RPC = 'https://starknet-sepolia.public.blastapi.io/rpc/v0_7';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');

if (!fs.existsSync(DEPLOYMENTS_DIR)) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
}

let privateKey;
let publicKey;

if (fs.existsSync(DEPLOYER_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));
    if (data.privateKey && data.publicKey) {
      privateKey = data.privateKey;
      publicKey = data.publicKey;
    }
  } catch {}
}

if (!privateKey) {
  const privBytes = ec.starkCurve.utils.randomPrivateKey();
  privateKey = '0x' + Buffer.from(privBytes).toString('hex');
  publicKey = ec.starkCurve.getStarkKey(privateKey);
}

const constructorCalldata = CallData.compile({ publicKey });
const accountAddress = hash.calculateContractAddressFromHash(
  publicKey,
  OZ_ACCOUNT_CLASS_HASH,
  constructorCalldata,
  0
);

const accountInfo = {
  network: 'sepolia',
  accountAddress,
  publicKey,
  privateKey,
  classHash: OZ_ACCOUNT_CLASS_HASH,
  rpcUrl: SEPOLIA_RPC,
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(DEPLOYER_FILE, JSON.stringify(accountInfo, null, 2));

console.log('-------------------------------------------------------------');
console.log('STARKNET SEPOLIA DEPLOYER ACCOUNT INITIALIZED:');
console.log('Address    : ' + accountAddress);
console.log('Public Key : ' + publicKey);
console.log('Saved to   : deployments/deployer_account.json (GITIGNORED)');
console.log('-------------------------------------------------------------');
