#!/usr/bin/env node
/**
 * ORRANGE LAUNCHPAD V2 graduation verification — drives the REAL V2 curve to its graduation
 * target (the crossing buy auto-graduates), then verifies the router received the reserves,
 * trading locked, and the truthful migrated state.
 *
 *   node scripts/launch_graduate.mjs
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

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'deployments/umbra-launch-v2.json'), 'utf8'),
);
if (manifest.network !== 'sepolia') {
  console.error(`Manifest is for ${manifest.network}, not sepolia.`);
  process.exit(1);
}

const RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia';

const ONE = 10n ** 18n;

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const deployer = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/deployer_account.json'), 'utf8'));
  const account = new Account({ provider, address: deployer.accountAddress, signer: deployer.privateKey });
  const { token, curve } = manifest.tokens.HAMSTR;
  const router = manifest.contracts.GraduationRouter.address;

  const call = async (addr, entrypoint, calldata = []) =>
    provider.callContract({ contractAddress: addr, entrypoint, calldata });

  const [br] = await call(curve, 'get_real_reserves');
  const [gt] = await call(curve, 'get_graduation_target');
  const [graduated] = await call(curve, 'is_graduated');
  const baseReserve = BigInt(br);
  const target = BigInt(gt);
  const isGrad = BigInt(graduated) === 1n;
  console.log(`base reserve ${Number(baseReserve) / 1e18} STRK / target ${Number(target) / 1e18} STRK (graduated=${isGrad})`);

  const bounds = {
    l2_gas: { max_amount: 1000000000n, max_price_per_unit: 200000000000n },
    l1_gas: { max_amount: 100000n, max_price_per_unit: 400000000000000n },
    l1_data_gas: { max_amount: 10000000n, max_price_per_unit: 20000000000000n },
  };

  if (!isGrad && baseReserve < target) {
    // Buy cap-compliant steps until the crossing trade auto-graduates the curve.
    const step = 3n * ONE; // 3 STRK — within the 10% max-trade cap
    const LOW_MASK = (1n << 128n) - 1n;
    let guard = 0;
    while (guard < 100) {
      const [b2] = await call(curve, 'get_real_reserves');
      const [g2] = await call(curve, 'is_graduated');
      if (BigInt(b2) >= target || BigInt(g2) === 1n) break;
      const buy = await account.execute(
        [
          { contractAddress: manifest.baseAsset, entrypoint: 'approve', calldata: [curve, (step & LOW_MASK).toString(), (step >> 128n).toString()] },
          { contractAddress: curve, entrypoint: 'buy', calldata: [step.toString(), deployer.accountAddress] },
        ],
        { resourceBounds: bounds },
      );
      await provider.waitForTransaction(buy.transaction_hash);
      guard += 1;
      if (guard % 10 === 0) console.log(`  step ${guard}...`);
    }
  }

  // With auto-graduation the crossing buy already closed the curve; call graduate() only if
  // (impossibly) it did not. Never force a revert.
  const [g3] = await call(curve, 'is_graduated');
  if (BigInt(g3) !== 1n) {
    const grad = await account.execute(
      { contractAddress: curve, entrypoint: 'graduate', calldata: [] },
      { resourceBounds: bounds },
    );
    console.log(`graduate() tx: ${grad.transaction_hash}`);
    await provider.waitForTransaction(grad.transaction_hash);
  }

  // Verify on-chain.
  const [gradV] = await call(curve, 'is_graduated');
  const [migV] = await call(router, 'is_migrated', [curve]);
  const routerBase = await call(manifest.baseAsset, 'balanceOf', [router]);
  const routerToken = await call(token, 'balance_of', [router]);
  const curveToken = await call(token, 'balance_of', [curve]);
  const baseBal = BigInt(routerBase[0]) + (BigInt(routerBase[1] ?? 0n) << 128n);
  const tokBal = BigInt(routerToken[0]) + (BigInt(routerToken[1] ?? 0n) << 128n);
  const curveTok = BigInt(curveToken[0]) + (BigInt(curveToken[1] ?? 0n) << 128n);

  console.log('\n--- graduation verification (on-chain) ---');
  console.log(`is_graduated        ${BigInt(gradV) === 1n}`);
  console.log(`is_migrated         ${BigInt(migV) === 1n} (false = graduated but awaiting migration)`);
  console.log(`router STRK balance ${Number(baseBal) / 1e18} STRK`);
  console.log(`router token balance ${Number(tokBal) / 1e18} tokens`);
  console.log(`curve token balance  ${Number(curveTok) / 1e18} tokens (should be ~0)`);
  console.log(`router = ${router}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});