import * as fs from 'fs';
import * as path from 'path';

const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const DEPLOYER_FILE = path.join(DEPLOYMENTS_DIR, 'deployer_account.json');
const STARKLI_ACCOUNT_FILE = path.join(DEPLOYMENTS_DIR, 'starkli_account.json');

const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

// Starkli Account Descriptor format for Argent Account
const starkliAccount = {
  version: 1,
  variant: {
    type: 'argent',
    version: 1,
    owner: deployerData.publicKey,
    guardian: '0x0',
  },
  deployment: {
    status: 'deployed',
    class_hash: deployerData.classHash,
    address: deployerData.accountAddress,
  },
};

fs.writeFileSync(STARKLI_ACCOUNT_FILE, JSON.stringify(starkliAccount, null, 2));
console.log('Starkli account descriptor saved to:', STARKLI_ACCOUNT_FILE);
