import { RpcProvider, hash, uint256 } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.cartridge.gg/x/starknet/sepolia';
const STRK_SEPOLIA = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const ETH_SEPOLIA = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

const DEPLOYER_FILE = path.join(process.cwd(), 'deployments/deployer_account.json');
const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_FILE, 'utf8'));

async function check() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  console.log(`Checking balance for address: ${deployerData.accountAddress}...`);

  try {
    const strkRes = await provider.callContract({
      contractAddress: STRK_SEPOLIA,
      entrypoint: 'balanceOf',
      calldata: [deployerData.accountAddress],
    });
    const low = BigInt(strkRes[0]);
    const high = BigInt(strkRes[1]);
    const balanceWei = (high << 128n) + low;
    const balanceStrk = Number(balanceWei) / 1e18;
    console.log(`STRK Balance: ${balanceStrk.toFixed(4)} STRK`);
  } catch (e) {
    console.log('STRK Balance query error:', e.message);
  }

  try {
    const ethRes = await provider.callContract({
      contractAddress: ETH_SEPOLIA,
      entrypoint: 'balanceOf',
      calldata: [deployerData.accountAddress],
    });
    const low = BigInt(ethRes[0]);
    const high = BigInt(ethRes[1]);
    const balanceWei = (high << 128n) + low;
    const balanceEth = Number(balanceWei) / 1e18;
    console.log(`ETH Balance : ${balanceEth.toFixed(6)} ETH`);
  } catch (e) {
    console.log('ETH Balance query error:', e.message);
  }
}

check();
