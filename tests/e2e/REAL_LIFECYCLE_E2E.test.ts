/**
 * @file tests/e2e/REAL_LIFECYCLE_E2E.test.ts
 * @description Real on-chain lifecycle (OPEN -> CLOSE profit/loss, OPEN -> LIQUIDATE)
 * with collateral-conservation assertions, using the actual deployed Garaga verifiers.
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
const QTY = 100000000n; // 1 BTC in sats
const MARGIN = 500000n; // $5,000
const ENTRY = 9500000n; // $95,000
const ORACLE_INIT = 9500000n; // matches deploy script (0x90f560)

async function rpc(method: string, params: any[]): Promise<any> {
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function publishPrice(admin: Account, oracle: string, priceCents: bigint) {
  const block = await new RpcProvider({ nodeUrl: RPC_URL }).getBlock('latest');
  const tx = await admin.execute({
    contractAddress: oracle,
    entrypoint: 'publish_oracle_price',
    calldata: [MARKET_FELT, '0x' + priceCents.toString(16), '0x' + block.timestamp.toString(16)],
  });
  await new RpcProvider({ nodeUrl: RPC_URL }).waitForTransaction(tx.transaction_hash);
}

interface Solvency {
  balanceCents: bigint;
  locked: bigint;
  lpNav: bigint;
  insurance: bigint;
  unclaimedPayouts: bigint;
  unclaimedBounties: bigint;
  isSolvent: boolean;
}

async function snapshot(provider: RpcProvider, adapter: string, token: string): Promise<Solvency> {
  const s = await provider.callContract({ contractAddress: adapter, entrypoint: 'get_solvency_snapshot', calldata: [] });
  const bal = await provider.callContract({ contractAddress: token, entrypoint: 'balance_of', calldata: [adapter] });
  const balanceCents = uint256.uint256ToBN({ low: bal[0], high: bal[1] }) / 10000n;
  return {
    balanceCents,
    locked: BigInt(s[1]),
    lpNav: BigInt(s[2]),
    insurance: BigInt(s[3]),
    unclaimedPayouts: BigInt(s[4]),
    unclaimedBounties: BigInt(s[5]),
    isSolvent: s[6] === '0x1' || s[6] === '1',
  };
}

function assertConserved(s: Solvency) {
  const liabilities = s.locked + s.lpNav + s.insurance + s.unclaimedPayouts + s.unclaimedBounties;
  expect(s.balanceCents).toBe(liabilities);
  expect(s.isSolvent).toBe(true);
}

describe('REAL_LIFECYCLE_E2E (OPEN/CLOSE/LIQUIDATE with conservation)', () => {
  let manifest: PerpsDevnetManifest;
  let provider: RpcProvider;
  let accs: DevnetAccounts;

  beforeAll(async () => {
    await garaga.init();
    provider = new RpcProvider({ nodeUrl: RPC_URL });
    manifest = await deployPerpsDevnet(RPC_URL);
    accs = await resolveDevnetAccounts(provider, RPC_URL);
  }, 600000);

  async function openPosition(entryPriceCents: bigint): Promise<{ commitmentKey: string; ownerSecret: bigint; nonce: bigint }> {
    const ownerSecret = BigInt(generateOwnerSecret());
    const nonce = BigInt(generateNonce());
    const proof = await pelCircuitService.generateOpenProof({
      side: 0n, quantitySats: QTY, entryPriceCents, marginCents: MARGIN, nonce, ownerSecret,
      oraclePriceCents: ORACLE_INIT,
    });
    // (re)approve the adapter for this margin amount
    const approve = await accs.trader.execute({
      contractAddress: manifest.collateralToken,
      entrypoint: 'approve',
      calldata: [manifest.strk20Adapter, '0x' + (MARGIN * 10000n).toString(16), '0x0'],
    });
    await provider.waitForTransaction(approve.transaction_hash);
    const tx = await accs.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'open_position',
      calldata: [
        manifest.accounts.trader, MARKET_FELT, '0x' + MARGIN.toString(16),
        ...proof.calldata!.map((x) => '0x' + BigInt(x).toString(16)),
      ],
    });
    await provider.waitForTransaction(tx.transaction_hash);
    return { commitmentKey: bn254ToStorageKey(proof.commitment), ownerSecret, nonce };
  }

  it('OPEN -> profitable CLOSE conserves collateral (profit paid from LP)', async () => {
    // seed LP with 1,000,000 cents ($10,000) so profit can be paid
    await accs.admin.execute({
      contractAddress: manifest.collateralToken,
      entrypoint: 'mint',
      calldata: [manifest.accounts.trader, '0x' + (1000000n * 10000n).toString(16), '0x0'],
    });
    await accs.trader.execute({
      contractAddress: manifest.collateralToken,
      entrypoint: 'approve',
      calldata: [manifest.strk20Adapter, '0x' + (1000000n * 10000n).toString(16), '0x0'],
    });
    const lp = await accs.trader.execute({
      contractAddress: manifest.strk20Adapter,
      entrypoint: 'deposit_liquidity',
      calldata: ['0x' + (1000000n).toString(16)],
    });
    await provider.waitForTransaction(lp.transaction_hash);

    const { commitmentKey, ownerSecret, nonce } = await openPosition(ENTRY);

    // price up to $100,000 -> LONG profit 500,000
    await publishPrice(accs.admin, manifest.oracleAdapter, 10000000n);

    const payoutNonce = BigInt(generateNonce());
    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents: MARGIN,
      fundingCents: 0n, feesCents: 0n, nonce, ownerSecret, payoutNonce,
      oraclePriceCents: 10000000n, recipient: BigInt(manifest.accounts.trader),
    });
    expect(closeProof.payout).toBe(1000000n);

    const tx = await accs.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'close_position',
      calldata: [
        MARKET_FELT, manifest.accounts.trader,
        ...closeProof.calldata!.map((x) => '0x' + BigInt(x).toString(16)),
      ],
    });
    const receipt: any = await provider.waitForTransaction(tx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);

    // position closed
    const pos = await provider.callContract({ contractAddress: manifest.pelCore, entrypoint: 'get_position', calldata: [commitmentKey] });
    expect(pos[7]).toBe('0x0');

    const s = await snapshot(provider, manifest.strk20Adapter, manifest.collateralToken);
    expect(s.locked).toBe(0n);           // full margin released
    expect(s.lpNav).toBe(500000n);       // 1,000,000 - 500,000 profit
    expect(s.unclaimedPayouts).toBe(1000000n);
    assertConserved(s);
  });

  it('OPEN -> losing CLOSE conserves collateral (loss routed to LP NAV)', async () => {
    const { commitmentKey, ownerSecret, nonce } = await openPosition(ENTRY);

    // price down to $92,000 -> LONG loss, equity = 200,000
    await publishPrice(accs.admin, manifest.oracleAdapter, 9200000n);

    const payoutNonce = BigInt(generateNonce());
    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents: MARGIN,
      fundingCents: 0n, feesCents: 0n, nonce, ownerSecret, payoutNonce,
      oraclePriceCents: 9200000n, recipient: BigInt(manifest.accounts.trader),
    });
    expect(closeProof.payout).toBe(200000n);

    const tx = await accs.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'close_position',
      calldata: [MARKET_FELT, manifest.accounts.trader, ...closeProof.calldata!.map((x) => '0x' + BigInt(x).toString(16))],
    });
    const receipt: any = await provider.waitForTransaction(tx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);

    const s = await snapshot(provider, manifest.strk20Adapter, manifest.collateralToken);
    // This position's loss (300,000) is added to LP NAV; previous position left 500,000 LP NAV
    expect(s.locked).toBe(0n);
    expect(s.lpNav).toBe(500000n + 300000n);
    expect(s.unclaimedPayouts).toBe(1000000n + 200000n);
    assertConserved(s);
  });

  it('OPEN -> LIQUIDATION conserves collateral (bounty + insurance)', async () => {
    const { commitmentKey, ownerSecret, nonce } = await openPosition(ENTRY);

    // price down to $90,000 -> equity 0 <= maintenance margin -> liquidatable
    await publishPrice(accs.admin, manifest.oracleAdapter, 9000000n);

    const keeperFelt = BigInt(manifest.accounts.keeper);
    const liqProof = await pelCircuitService.generateLiquidateProof({
      side: 0n, quantitySats: QTY, entryPriceCents: ENTRY, marginCents: MARGIN,
      fundingCents: 0n, feesCents: 0n, nonce, ownerSecret,
      markPriceCents: 9000000n, keeper: keeperFelt,
    });

    const tx = await accs.keeper.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'liquidate_position',
      calldata: [MARKET_FELT, manifest.accounts.keeper, ...liqProof.calldata!.map((x) => '0x' + BigInt(x).toString(16))],
    });
    const receipt: any = await provider.waitForTransaction(tx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);

    const pos = await provider.callContract({ contractAddress: manifest.pelCore, entrypoint: 'get_position', calldata: [commitmentKey] });
    expect(pos[7]).toBe('0x0');

    const s = await snapshot(provider, manifest.strk20Adapter, manifest.collateralToken);
    // seized margin: 2% bounty (10,000) + 98% insurance (490,000)
    expect(s.locked).toBe(0n);
    expect(s.unclaimedBounties).toBe(10000n);
    // insurance = previous 0 + 490,000
    expect(s.insurance).toBe(490000n);
    assertConserved(s);
  });
});
