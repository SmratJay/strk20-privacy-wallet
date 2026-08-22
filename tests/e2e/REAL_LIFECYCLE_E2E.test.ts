/**
 * @file tests/e2e/REAL_LIFECYCLE_E2E.test.ts
 * @description Real on-chain lifecycle (OPEN -> CLOSE profit/loss, OPEN -> LIQUIDATE)
 * with collateral-conservation assertions against the canonical PELLiquidityVault,
 * using the actual deployed Garaga verifiers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RpcProvider, Account, uint256 } from 'starknet';
import * as garaga from 'garaga';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { generateOwnerSecret, generateNonce } from '../../src/protocol/witnessStore';
import { bn254ToStorageKey } from '../../src/protocol/canonical';
import { deployPerpsDevnet, PerpsDevnetManifest, resolveDevnetAccounts, DevnetAccounts } from '../../scripts/deploy_perps_devnet';

const RPC_URL = process.env.STARKNET_RPC_URL || 'http://127.0.0.1:5050';
const MARKET_FELT = '0x4254432d50455250';
const QTY = 100000000n; // 1 BTC
const MARGIN = 500000n; // $5,000
const ENTRY = 9500000n; // $95,000

async function publishPrice(admin: Account, oracle: string, priceCents: bigint) {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const block = await provider.getBlock('latest');
  const tx = await admin.execute({
    contractAddress: oracle,
    entrypoint: 'publish_oracle_price',
    calldata: [MARKET_FELT, '0x' + priceCents.toString(16), '0x' + block.timestamp.toString(16)],
  });
  await provider.waitForTransaction(tx.transaction_hash);
}

interface VaultState {
  balanceCents: bigint;
  locked: bigint;
  lpNav: bigint;
  payouts: bigint;
  bounties: bigint;
  withdrawals: bigint;
  treasury: bigint;
}

async function vaultState(provider: RpcProvider, manifest: PerpsDevnetManifest): Promise<VaultState> {
  const s = await provider.callContract({ contractAddress: manifest.lpVault, entrypoint: 'get_solvency_snapshot', calldata: [] });
  const bal = await provider.callContract({ contractAddress: manifest.collateralToken, entrypoint: 'balance_of', calldata: [manifest.lpVault] });
  return {
    balanceCents: uint256.uint256ToBN({ low: bal[0], high: bal[1] }) / 10000n,
    locked: BigInt(s[1]),
    lpNav: BigInt(s[2]),
    payouts: BigInt(s[3]),
    bounties: BigInt(s[4]),
    withdrawals: BigInt(s[5]),
    treasury: BigInt(s[6]),
  };
}

async function insuranceBalance(provider: RpcProvider, manifest: PerpsDevnetManifest): Promise<bigint> {
  const s = await provider.callContract({ contractAddress: manifest.insurance, entrypoint: 'get_insurance_balance', calldata: [] });
  return BigInt(s[0]);
}

describe('REAL_LIFECYCLE_E2E (OPEN/CLOSE/LIQUIDATE with vault conservation)', () => {
  let manifest: PerpsDevnetManifest;
  let provider: RpcProvider;
  let accs: DevnetAccounts;

  beforeAll(async () => {
    await garaga.init();
    provider = new RpcProvider({ nodeUrl: RPC_URL });
    manifest = await deployPerpsDevnet(RPC_URL);
    accs = await resolveDevnetAccounts(provider, RPC_URL);
  }, 600000);

  async function openPosition(marginCents: bigint): Promise<{ commitmentKey: string; ownerSecret: bigint; nonce: bigint }> {
    const ownerSecret = BigInt(generateOwnerSecret());
    const nonce = BigInt(generateNonce());
    // reset the oracle to the entry price (each test republishes to its own mark)
    await publishPrice(accs.admin, manifest.oracleAdapter, ENTRY);
    const proof = await pelCircuitService.generateOpenProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents, nonce, ownerSecret,
      oraclePriceCents: ENTRY,
    });
    // the vault pulls margin via transfer_from; approve it (deploy already approves 500k)
    const approve = await accs.trader.execute({
      contractAddress: manifest.collateralToken,
      entrypoint: 'approve',
      calldata: [manifest.lpVault, '0x' + (marginCents * 10000n).toString(16), '0x0'],
    });
    await provider.waitForTransaction(approve.transaction_hash);
    const tx = await accs.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'open_position',
      calldata: [
        manifest.accounts.trader, MARKET_FELT, '0x' + marginCents.toString(16),
        ...proof.calldata!.map((x) => '0x' + BigInt(x).toString(16)),
      ],
    });
    await provider.waitForTransaction(tx.transaction_hash);
    return { commitmentKey: bn254ToStorageKey(proof.commitment), ownerSecret, nonce };
  }

  async function closeAt(markPriceCents: bigint, ownerSecret: bigint, nonce: bigint): Promise<bigint> {
    await publishPrice(accs.admin, manifest.oracleAdapter, markPriceCents);
    const payoutNonce = BigInt(generateNonce());
    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents: MARGIN,
      fundingCents: 0n, feesCents: 0n, nonce, ownerSecret, payoutNonce,
      oraclePriceCents: markPriceCents, recipient: BigInt(manifest.accounts.trader),
    });
    const tx = await accs.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'close_position',
      calldata: [MARKET_FELT, manifest.accounts.trader, ...closeProof.calldata!.map((x) => '0x' + BigInt(x).toString(16))],
    });
    const receipt: any = await provider.waitForTransaction(tx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);
    return closeProof.payout;
  }

  it('OPEN -> profitable CLOSE (LP pays full profit, payout note registered)', async () => {
    const before = await vaultState(provider, manifest);
    const { ownerSecret, nonce } = await openPosition(MARGIN);
    // price $95,000 -> $100,000: LONG profit
    const payout = await closeAt(10000000n, ownerSecret, nonce);
    const profit = payout - MARGIN; // payout = margin + profit (net of fees)
    expect(profit).toBeGreaterThan(0n);

    const after = await vaultState(provider, manifest);
    expect(after.locked).toBe(before.locked);            // margin fully released
    expect(after.lpNav).toBe(before.lpNav - profit);     // LP pays full profit
    expect(after.payouts).toBe(before.payouts + payout); // payout note
    // conservation
    expect(after.balanceCents).toBe(after.locked + after.lpNav + after.payouts + after.bounties + after.withdrawals + after.treasury);
  });

  it('OPEN -> losing CLOSE (full loss routed to LP NAV)', async () => {
    const before = await vaultState(provider, manifest);
    const { ownerSecret, nonce } = await openPosition(MARGIN);
    // price $95,000 -> $92,000: LONG loss
    const payout = await closeAt(9200000n, ownerSecret, nonce);
    const loss = MARGIN - payout; // loss = margin - payout (net of fees)
    expect(loss).toBeGreaterThan(0n);

    const after = await vaultState(provider, manifest);
    expect(after.locked).toBe(before.locked);
    expect(after.lpNav).toBe(before.lpNav + loss);       // LP gains full loss
    expect(after.payouts).toBe(before.payouts + payout);
    expect(after.balanceCents).toBe(after.locked + after.lpNav + after.payouts + after.bounties + after.withdrawals + after.treasury);
  });

  it('OPEN -> LIQUIDATION (proof-bound seized collateral: bounty/insurance/treasury waterfall)', async () => {
    const before = await vaultState(provider, manifest);
    const insBefore = await insuranceBalance(provider, manifest);
    // 50x leveraged position: margin $1,900 on $95,000 notional
    const margin = 190000n;
    const { commitmentKey, ownerSecret, nonce } = await openPosition(margin);
    // price $95,000 -> $94,000: pnl -100,000, equity 90,000 <= maintenance 188,000
    await publishPrice(accs.admin, manifest.oracleAdapter, 9400000n);

    const keeperFelt = BigInt(manifest.accounts.keeper);
    const liqProof = await pelCircuitService.generateLiquidateProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents: margin,
      fundingCents: 0n, feesCents: 0n, nonce, ownerSecret,
      markPriceCents: 9400000n, keeper: keeperFelt,
    });
    expect(liqProof.seizedCollateral).toBe(90000n);
    expect(liqProof.badDebt).toBe(0n);

    const tx = await accs.keeper.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'liquidate_position',
      calldata: [MARKET_FELT, manifest.accounts.keeper, ...liqProof.calldata!.map((x) => '0x' + BigInt(x).toString(16))],
    });
    const receipt: any = await provider.waitForTransaction(tx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);

    const pos = await provider.callContract({ contractAddress: manifest.pelCore, entrypoint: 'get_position', calldata: [commitmentKey] });
    expect(pos[7]).toBe('0x0'); // position inactive

    const after = await vaultState(provider, manifest);
    const insAfter = await insuranceBalance(provider, manifest);
    // Derive expected from the proof-bound seized collateral (source of truth).
    const seized = liqProof.seizedCollateral;
    const bounty = (seized * 200n) / 10000n;
    const traderLoss = margin - seized;
    const net = seized - bounty;
    const lpShare = (net * 7000n) / 10000n;
    const insShare = (net * 2000n) / 10000n;
    const treasuryShare = net - lpShare - insShare;
    expect(after.locked).toBe(before.locked);
    expect(after.bounties).toBe(before.bounties + bounty);
    expect(after.lpNav).toBe(before.lpNav + traderLoss + lpShare);
    expect(after.treasury).toBe(before.treasury + treasuryShare);
    expect(insAfter).toBe(insBefore + insShare);
    expect(after.balanceCents).toBe(after.locked + after.lpNav + after.payouts + after.bounties + after.withdrawals + after.treasury);
  });
});