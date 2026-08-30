import { describe, it, expect } from 'vitest';
import { evaluateProposal, DEFAULT_TREASURY_POLICY, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';
import { ActionProposal } from '@/ai/schema';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x1234abcd';

/** $5,000 STRK (50%) + $5,000 USDC (50%); $10,000 total, $10,000 liquid. */
function summary(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    generatedAt: 1,
    totalUsd: 10000,
    liquidityUsd: 10000,
    liquidPct: 100,
    topAsset: { symbol: 'STRK', pct: 50 },
    positions: [
      { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: '1000000000000000000000', balanceHuman: 1000, usdValue: 5000, priceUsd: 5, priceSource: 'static', pct: 50, liquid: true },
      { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
    ],
    ...over,
  };
}

function transfer(asset: string, amount: string, recipient = DEST): ActionProposal {
  return {
    intent: 'rebalance',
    reason: 'test',
    action: { type: 'private_transfer', asset, amount, recipient },
    requiresUserConfirmation: true,
  };
}

describe('evaluateProposal', () => {
  it('allows a small, compliant transfer', () => {
    const v = evaluateProposal(transfer(STRK, '100'), summary());
    expect(v.allowed).toBe(true);
    expect(v.amountUsd).toBeCloseTo(500, 5); // 100 STRK * $5
    expect(v.checks.every((c) => c.passed)).toBe(true);
  });

  it('allows advisory reports without execution', () => {
    const v = evaluateProposal(
      { intent: 'report', reason: 'ok', action: { type: 'report', asset: '', amount: '', recipient: '' }, requiresUserConfirmation: false },
      summary(),
    );
    expect(v.allowed).toBe(true);
    expect(v.reportOnly).toBe(true);
  });

  it('blocks when the asset is not in the treasury', () => {
    const v = evaluateProposal(transfer('0xdeadbeef', '1'), summary());
    expect(v.allowed).toBe(false);
    expect(v.checks.find((c) => c.id === 'asset-valid')?.passed).toBe(false);
  });

  it('blocks when the asset is not on the allowed-assets list', () => {
    const policy: TreasuryPolicy = { ...DEFAULT_TREASURY_POLICY, allowedAssets: [USDC] };
    const v = evaluateProposal(transfer(STRK, '1'), summary(), policy);
    expect(v.allowed).toBe(false);
    expect(v.checks.find((c) => c.id === 'asset-valid')?.passed).toBe(false);
  });

  it('blocks when the destination is not allowed', () => {
    const policy: TreasuryPolicy = { ...DEFAULT_TREASURY_POLICY, allowedDestinations: [DEST] };
    const v = evaluateProposal(transfer(STRK, '1', '0xffffffff'), summary(), policy);
    expect(v.allowed).toBe(false);
    expect(v.checks.find((c) => c.id === 'destination-valid')?.passed).toBe(false);
  });

  it('blocks when the tx amount exceeds maxTxUsd', () => {
    const policy: TreasuryPolicy = { ...DEFAULT_TREASURY_POLICY, maxTxUsd: 400 };
    const v = evaluateProposal(transfer(STRK, '100'), summary(), policy); // $500 > $400
    expect(v.allowed).toBe(false);
    expect(v.checks.find((c) => c.id === 'max-tx-amount')?.passed).toBe(false);
  });

  it('passes the liquidity floor for small transfers and blocks when it breaks', () => {
    const ok = evaluateProposal(transfer(USDC, '1000'), summary()); // 9000 liquid after
    expect(ok.allowed).toBe(true);
    expect(ok.checks.find((c) => c.id === 'min-liquidity-after')?.passed).toBe(true);

    const badPolicy: TreasuryPolicy = { ...DEFAULT_TREASURY_POLICY, maxTxUsd: 20000 };
    const bad = evaluateProposal(transfer(USDC, '9500'), summary(), badPolicy); // 500 liquid after
    expect(bad.allowed).toBe(false);
    expect(bad.checks.find((c) => c.id === 'min-liquidity-after')?.passed).toBe(false);
  });

  it('blocks when a position would exceed the concentration cap after the action', () => {
    // Transferring USDC raises STRK's share above the 60% cap.
    const v = evaluateProposal(transfer(USDC, '2000'), summary()); // totalAfter 8000, STRK 5000 -> 62.5%
    expect(v.allowed).toBe(false);
    expect(v.checks.find((c) => c.id === 'max-position-after')?.passed).toBe(false);
  });

  it('allows a transfer that keeps concentration under the cap', () => {
    // Transferring STRK reduces the dominant position: STRK (5000-500)/9000 = 50%.
    const v = evaluateProposal(transfer(STRK, '100'), summary());
    expect(v.checks.find((c) => c.id === 'max-position-after')?.passed).toBe(true);
  });

  it('is deterministic: same inputs => same verdict', () => {
    const a = evaluateProposal(transfer(STRK, '100'), summary());
    const b = evaluateProposal(transfer(STRK, '100'), summary());
    expect(a.allowed).toBe(b.allowed);
    expect(a.checks.map((c) => [c.id, c.passed])).toEqual(b.checks.map((c) => [c.id, c.passed]));
  });
});