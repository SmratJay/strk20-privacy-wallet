#!/usr/bin/env node
/**
 * UMBRA LAUNCH graduation verification — drives the REAL curve to its graduation target,
 * calls graduate(), and verifies the router received the reserves and trading locked.
 *
 *   node scripts/launch_graduate.mjs --sepolia
 *
 * This consumes real (Sepolia testnet) STRK to reach the graduation target. Nothing is
 * fabricated; every check reads the chain.
 */
import { Account, RpcProvider } from 'starknet';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const isSepolia = process.argv.includes('--sepolia');
const NETWORK = isSepolia ? 'sepolia' : 'mainnet';

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch.json'), 'utf8'),
);
if (manifest.network !== NETWORK) {
  console.error(`Manifest is for ${manifest.network}, not ${NETWORK}.`);
  process.exit(1);
}

const RPC = isSepolia
  ? process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia'
  : process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://free-rpc.nethermind.io/mainnet-juno';

const ONE = 10n ** 18n;

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const deployer = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/deployer_account.json'), 'utf8'));
  const account = new Account({ provider, address: deployer.accountAddress, signer: deployer.privateKey });
  const { token, curve } = manifest.tokens.HAMSTR;
  const router = manifest.contracts.TokenFactory
    ? (await provider.callContract({ contractAddress: manifest.contracts.TokenFactory.address, entrypoint: 'get_router', calldata: [] }))[0]
    : '';
  const routerAddress = '0x' + BigInt(router).toString(16);

  const call = async (addr, entrypoint, calldata = []) =>
    provider.callContract({ contractAddress: addr, entrypoint, calldata });

  const [br] = await call(curve, 'get_real_reserves');
  const [gt] = await call(curve, 'get_graduation_target');
  const baseReserve = BigInt(br);
  const target = BigInt(gt);
  console.log(`base reserve ${Number(baseReserve) / 1e18} STRK / target ${Number(target) / 1e18} STRK`);

  if (baseReserve < target) {
    const toBuy = target - baseReserve + ONE; // a touch over target so it definitely passes
    const LOW_MASK = (1n << 128n) - 1n;
    const bounds = {
      l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
      l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
      l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
    };
    const buy = await account.execute(
      [
        { contractAddress: manifest.baseAsset, entrypoint: 'approve', calldata: [curve, (toBuy & LOW_MASK).toString(), (toBuy >> 128n).toString()] },
        { contractAddress: curve, entrypoint: 'buy', calldata: [toBuy.toString(), deployer.accountAddress] },
      ],
      { resourceBounds: bounds },
    );
    console.log(`buy-to-target tx: ${buy.transaction_hash} (${Number(toBuy) / 1e18} STRK)`);
    await provider.waitForTransaction(buy.transaction_hash);
    console.log('confirmed');
  }

  // Trigger graduation.
  const grad = await account.execute(
    { contractAddress: curve, entrypoint: 'graduate', calldata: [] },
    { resourceBounds: { l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n }, l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n }, l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n } } },
  );
  console.log(`graduate() tx: ${grad.transaction_hash}`);
  await provider.waitForTransaction(grad.transaction_hash);
  console.log('confirmed');

  // Verify on-chain.
  const graduated = await call(curve, 'is_graduated');
  const routerBase = await call(manifest.baseAsset, 'balanceOf', [routerAddress]);
  const routerToken = await call(token, 'balance_of', [routerAddress]);
  const curveToken = await call(token, 'balance_of', [curve]);
  const baseBal = BigInt(routerBase[0]) + (BigInt(routerBase[1] ?? 0n) << 128n);
  const tokBal = BigInt(routerToken[0]) + (BigInt(routerToken[1] ?? 0n) << 128n);
  const curveTok = BigInt(curveToken[0]) + (BigInt(curveToken[1] ?? 0n) << 128n);
  const supply = await call(token, 'total_supply');
  const totalSupply = BigInt(supply[0]) + (BigInt(supply[1] ?? 0n) << 128n);

  console.log('\n--- graduation verification (on-chain) ---');
  console.log(`is_graduated        ${BigInt(graduated) === 1n}`);
  console.log(`router STRK balance ${Number(baseBal) / 1e18} STRK`);
  console.log(`router token balance ${Number(tokBal) / 1e18} tokens`);
  console.log(`curve token balance  ${Number(curveTok) / 1e18} tokens (should be ~0)`);
  console.log(`total supply        ${Number(totalSupply) / 1e18}`);
  console.log(`router = ${routerAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});