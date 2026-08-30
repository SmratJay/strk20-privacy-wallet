import { describe, it, expect } from 'vitest';
import {
  TREASURY_POLICY_PRESETS,
  DEFAULT_POLICY_PRESET_ID,
  DEFAULT_TREASURY_POLICY,
  getPolicyPreset,
  resolveUserPolicy,
  POLICY_BOUNDS,
} from '@/ai/policy';

describe('TREASURY_POLICY_PRESETS — user-selected guardrails', () => {
  it('defines exactly Conservative / Balanced / Flexible with realistic small-wallet floors', () => {
    const ids = TREASURY_POLICY_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['conservative', 'balanced', 'flexible']);

    const conservative = getPolicyPreset('conservative')!;
    const balanced = getPolicyPreset('balanced')!;
    const flexible = getPolicyPreset('flexible')!;

    // No preset keeps an arbitrary $1,000 floor — small testnet treasuries must be usable.
    for (const p of TREASURY_POLICY_PRESETS) {
      expect(p.minLiquidityUsd).toBeLessThanOrEqual(100);
      expect(p.minLiquidityUsd).toBeGreaterThanOrEqual(0);
    }
    // Stricter → looser ordering.
    expect(conservative.minLiquidityUsd).toBeGreaterThan(balanced.minLiquidityUsd);
    expect(balanced.minLiquidityUsd).toBeGreaterThan(flexible.minLiquidityUsd);
    expect(conservative.maxPositionPct).toBeLessThan(balanced.maxPositionPct);
    expect(balanced.maxPositionPct).toBeLessThan(flexible.maxPositionPct);
  });

  it('defaults the demo to the flexible preset so a small wallet is not blocked', () => {
    expect(DEFAULT_POLICY_PRESET_ID).toBe('flexible');
    const flexible = getPolicyPreset(DEFAULT_POLICY_PRESET_ID)!;
    // DEFAULT_TREASURY_POLICY (also the no-selection analyze base) matches flexible values.
    expect(DEFAULT_TREASURY_POLICY.minLiquidityUsd).toBe(flexible.minLiquidityUsd);
    expect(DEFAULT_TREASURY_POLICY.maxPositionPct).toBe(flexible.maxPositionPct);
    expect(DEFAULT_TREASURY_POLICY.maxTxUsd).toBe(flexible.maxTxUsd);
    // And it is NOT the old unusable $1,000 floor.
    expect(DEFAULT_TREASURY_POLICY.minLiquidityUsd).toBeLessThan(1000);
  });
});

describe('resolveUserPolicy — deterministic, bounds-validated', () => {
  it('resolves a named preset to its fixed values', () => {
    const r = resolveUserPolicy({ preset: 'conservative' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toEqual({ minLiquidityUsd: 100, maxPositionPct: 60, maxTxUsd: 100 });
    }
  });

  it('resolves a missing selection to the demo default preset', () => {
    expect(resolveUserPolicy(undefined).ok).toBe(true);
    const d = resolveUserPolicy(undefined);
    if (d.ok) expect(d.values.maxPositionPct).toBe(100);
    expect(resolveUserPolicy(null).ok).toBe(true);
  });

  it('accepts in-bounds custom limits', () => {
    const r = resolveUserPolicy({ preset: 'custom', custom: { minLiquidityUsd: 0, maxPositionPct: 75, maxTxUsd: 200 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values).toEqual({ minLiquidityUsd: 0, maxPositionPct: 75, maxTxUsd: 200 });
  });

  it('rejects out-of-bounds custom limits (never clamps silently)', () => {
    const bad: Record<string, unknown>[] = [
      { preset: 'custom', custom: { minLiquidityUsd: -1, maxPositionPct: 80, maxTxUsd: 150 } },
      { preset: 'custom', custom: { minLiquidityUsd: POLICY_BOUNDS.minLiquidityUsd.max + 1, maxPositionPct: 80, maxTxUsd: 150 } },
      { preset: 'custom', custom: { minLiquidityUsd: 50, maxPositionPct: 0, maxTxUsd: 150 } },
      { preset: 'custom', custom: { minLiquidityUsd: 50, maxPositionPct: 101, maxTxUsd: 150 } },
      { preset: 'custom', custom: { minLiquidityUsd: 50, maxPositionPct: 80, maxTxUsd: 0 } },
      { preset: 'custom', custom: { minLiquidityUsd: 50, maxPositionPct: 80, maxTxUsd: NaN } },
    ];
    for (const sel of bad) {
      const r = resolveUserPolicy(sel);
      expect(r.ok, JSON.stringify(sel)).toBe(false);
    }
  });

  it('rejects an unknown preset and a non-object selection', () => {
    expect(resolveUserPolicy({ preset: 'nope' }).ok).toBe(false);
    expect(resolveUserPolicy('conservative').ok).toBe(false);
    expect(resolveUserPolicy([{ preset: 'conservative' }]).ok).toBe(false);
  });

  it('is deterministic for the same input', () => {
    expect(resolveUserPolicy({ preset: 'balanced' })).toEqual(resolveUserPolicy({ preset: 'balanced' }));
  });
});