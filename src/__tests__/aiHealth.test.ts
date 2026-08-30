import { describe, it, expect } from 'vitest';
import {
  computeTreasuryHealth,
  extractRequestedLiquidityUsd,
  classifyActionability,
  blockedPolicyChecks,
  buildDiagnosis,
  liquidityRequestConflicts,
} from '@/ai/health';
import { DEFAULT_TREASURY_POLICY, evaluateProposal, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';
import { ActionProposal } from '@/ai/schema';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

/** The example from the brief: 482 STRK ≈ $183.16, 100% STRK. */
function concentratedSummary(): PortfolioSummary {
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

function balancedSummary(): PortfolioSummary {
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

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, minLiquidityUsd: 1000, allowedDestinations: [DEST], ...over };
}

describe('computeTreasuryHealth', () => {
  it('flags the concentrated, below-target example correctly', () => {
    const h = computeTreasuryHealth(concentratedSummary(), policy());
    expect(h.concentrationPct).toBe(100);
    expect(h.concentrationRisk).toBe('high');
    expect(h.liquidityUsd).toBeCloseTo(183.16, 2);
    expect(h.liquidityRatio).toBeCloseTo(0.18316, 4);
    expect(h.liquidityRisk).toBe('critical');
    expect(h.assetCount).toBe(1);
    expect(h.diversification).toBe('low');
    expect(h.policyHeadroomUsd).toBeCloseTo(-816.84, 2);
    expect(h.aboveLiquidityTarget).toBe(false);
    // 100 - (100-40)*0.5 - (1-0.18316)*40 - (3-1)*10 = 100 - 30 - 32.67 - 20 = 17.33
    expect(h.healthScore).toBeCloseTo(17.33, 1);
  });

  it('scores a healthy diversified portfolio much higher', () => {
    const h = computeTreasuryHealth(balancedSummary(), policy());
    expect(h.healthScore).toBeGreaterThan(80);
    expect(h.concentrationRisk).toBe('low');
    expect(h.liquidityRisk).toBe('low');
    expect(h.aboveLiquidityTarget).toBe(true);
  });

  it('never exceeds 0..100', () => {
    const h = computeTreasuryHealth(concentratedSummary(), policy({ minLiquidityUsd: 10000 }));
    expect(h.healthScore).toBeGreaterThanOrEqual(0);
    expect(h.healthScore).toBeLessThanOrEqual(100);
  });
});

describe('liquidityRequestConflicts', () => {
  it('flags a requested target below the active policy minimum', () => {
    expect(liquidityRequestConflicts(50, policy())).toBe(true); // policy min 1000
    expect(liquidityRequestConflicts(999, policy())).toBe(true);
  });

  it('does not flag a target at or above the active minimum', () => {
    expect(liquidityRequestConflicts(1000, policy())).toBe(false);
    expect(liquidityRequestConflicts(5000, policy())).toBe(false);
  });

  it('ignores a missing request', () => {
    expect(liquidityRequestConflicts(null, policy())).toBe(false);
  });
});

describe('extractRequestedLiquidityUsd', () => {
  it('extracts $50 from "keep at least $50 liquid"', () => {
    expect(extractRequestedLiquidityUsd('Make my treasury safer while keeping at least $50 liquid.')).toBe(50);
  });

  it('handles commas: "keep $1,000 liquid"', () => {
    expect(extractRequestedLiquidityUsd('keep $1,000 liquid')).toBe(1000);
  });

  it('returns null when no liquidity target is mentioned', () => {
    expect(extractRequestedLiquidityUsd('rebalance my treasury')).toBeNull();
    expect(extractRequestedLiquidityUsd('')).toBeNull();
    expect(extractRequestedLiquidityUsd('keep $50 dollars somewhere')).toBeNull(); // no "liquid"
  });
});

describe('classifyActionability', () => {
  const transfer = (): ActionProposal => ({
    intent: 'rebalance',
    reason: 'x',
    action: { type: 'private_transfer', asset: STRK, amount: '10', recipient: DEST },
    requiresUserConfirmation: true,
  });
  const report = (): ActionProposal => ({
    intent: 'report',
    reason: 'x',
    action: { type: 'report', asset: '', amount: '', recipient: '' },
    requiresUserConfirmation: false,
  });

  it('maps a report to ADVISORY', () => {
    const v = evaluateProposal(report(), balancedSummary(), policy(), { now: 1 });
    expect(classifyActionability(report(), v)).toBe('ADVISORY');
  });

  it('maps an allowed transfer to EXECUTABLE', () => {
    const v = evaluateProposal(transfer(), balancedSummary(), policy(), { now: 1 });
    expect(v.allowed).toBe(true);
    expect(classifyActionability(transfer(), v)).toBe('EXECUTABLE');
  });

  it('maps a rejected transfer to BLOCKED', () => {
    const v = evaluateProposal(transfer(), concentratedSummary(), policy(), { now: 1 });
    expect(v.allowed).toBe(false);
    expect(classifyActionability(transfer(), v)).toBe('BLOCKED');
  });
});

describe('blockedPolicyChecks', () => {
  it('returns only the failed checks with labels and details', () => {
    const v = evaluateProposal(
      { intent: 'rebalance', reason: 'x', action: { type: 'private_transfer', asset: STRK, amount: '10', recipient: DEST }, requiresUserConfirmation: true },
      concentratedSummary(),
      policy(),
      { now: 1 },
    );
    const failed = blockedPolicyChecks(v);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((c) => c.label && c.detail)).toBe(true);
  });
});

describe('buildDiagnosis', () => {
  it('uses the actual computed values, not hardcoded copy', () => {
    const health = computeTreasuryHealth(concentratedSummary(), policy());
    const d = buildDiagnosis(health, concentratedSummary());
    expect(d.concentrationLine).toContain('100%');
    expect(d.concentrationLine).toContain('STRK');
    expect(d.liquidityLine).toContain('$183.16');
    expect(d.liquidityLine).toContain('$1,000');
    expect(d.diversificationLine).toContain('Only one asset');
    expect(d.bestNextStep).toContain('Increase liquidity');
  });
});