import { describe, it, expect } from 'vitest';
import { simulateAction, DEFAULT_TREASURY_POLICY, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return {
    ...DEFAULT_TREASURY_POLICY,
    minLiquidityUsd: 1000,
    maxPositionPct: 60,
    maxTxUsd: 5000,
    allowedDestinations: [DEST],
    selfTransferAddress: STRK,
    ...over,
  };
}

function concentrated(): PortfolioSummary {
  return {
    generatedAt: 1,
    totalUsd: 183.16,
    liquidityUsd: 183.16,
    liquidPct: 100,
    topAsset: { symbol: 'STRK', pct: 100 },
    positions: [
      { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: (482n * 10n ** 18n).toString(), balanceHuman: 482, usdValue: 183.16, priceUsd: 0.38, priceSource: 'static', pct: 100, liquid: true },
    ],
  };
}

function balanced(): PortfolioSummary {
  return {
    generatedAt: 1,
    totalUsd: 10000,
    liquidityUsd: 10000,
    liquidPct: 100,
    topAsset: { symbol: 'STRK', pct: 50 },
    positions: [
      { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: (1000n * 10n ** 18n).toString(), balanceHuman: 1000, usdValue: 5000, priceUsd: 5, priceSource: 'avnu', priceFetchedAt: 1, pct: 50, liquid: true },
      { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
    ],
  };
}

describe('simulateAction — What-If scenario (advisory, never executes)', () => {
  it('computes before/after economics and reuses the deterministic policy verdict', () => {
    const s = simulateAction(concentrated(), policy(), { asset: STRK, amount: '50', now: 1 });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.symbol).toBe('STRK');
      expect(s.amountBaseUnits).toBe(50n * 10n ** 18n);
      // before: 100% STRK, $183.16
      expect(s.before.concentrationPct).toBe(100);
      expect(s.before.liquidityUsd).toBeCloseTo(183.16, 2);
      // after: 50 STRK ($19) leaves $164.16, still 100% STRK (single asset)
      expect(s.after.liquidityUsd).toBeCloseTo(164.16, 2);
      expect(s.after.concentrationPct).toBe(100);
      // still blocked: below the $1,000 liquidity floor + over the concentration cap
      expect(s.verdict.allowed).toBe(false);
      expect(s.verdict.checks.some((c) => c.id === 'min-liquidity-after' && !c.passed)).toBe(true);
      // STRK static price -> scenario is advisory/estimated
      expect(s.estimated).toBe(true);
    }
  });

  it('marks a scenario estimated=false when volatile prices are live', () => {
    const s = simulateAction(balanced(), policy(), { asset: STRK, amount: '100', now: 1 });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.estimated).toBe(false); // STRK is avnu; USDC is a pinned stablecoin
      // 100 STRK ($500) out of $10,000
      expect(s.after.totalUsd).toBeCloseTo(9500, 0);
      expect(s.after.concentrationPct).toBeLessThan(60); // USDC ~52.6% becomes top
      expect(s.verdict.allowed).toBe(true);
    }
  });

  it('rejects an invalid amount without a verdict path', () => {
    const s = simulateAction(concentrated(), policy(), { asset: STRK, amount: '10.0000000000000000001' });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toBeTruthy();
  });

  it('rejects an asset that is not in the treasury', () => {
    const s = simulateAction(concentrated(), policy(), { asset: USDC, amount: '1' });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error).toContain('not in the treasury');
  });
});