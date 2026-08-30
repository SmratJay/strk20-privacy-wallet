/**
 * @file src/ai/verification.ts
 * @description Post-execution verification: compare the expected (simulated) outcome against the
 * actual (refreshed) portfolio. Deterministic and advisory — it reports, it never authorizes.
 */
import { PortfolioSummary } from '@/ai/portfolio';

export interface OutcomePoint {
  concentrationPct: number;
  liquidityUsd: number;
  totalUsd: number;
}

export interface ExecutionVerification {
  ok: boolean;
  expected: OutcomePoint;
  actual: OutcomePoint;
  matches: boolean;
  tolerancePct: number;
  note: string;
}

export const DEFAULT_VERIFICATION_TOLERANCE_PCT = 5;

/**
 * Compare an expected outcome (from a scenario simulation) against the actual refreshed
 * portfolio. `matches` is true when concentration and liquidity are within `tolerancePct` of
 * the expectation — on-chain fees, rounding, and price moves make small deltas normal.
 */
export function verifyExecution(
  expected: OutcomePoint,
  actualSummary: PortfolioSummary,
  tolerancePct: number = DEFAULT_VERIFICATION_TOLERANCE_PCT,
): ExecutionVerification {
  const actual: OutcomePoint = {
    concentrationPct: actualSummary.topAsset?.pct ?? 0,
    liquidityUsd: actualSummary.liquidityUsd,
    totalUsd: actualSummary.totalUsd,
  };

  const within = (expectedValue: number, actualValue: number): boolean => {
    const base = Math.abs(expectedValue);
    if (base === 0) return Math.abs(actualValue) <= tolerancePct;
    const deltaPct = (Math.abs(actualValue - expectedValue) / base) * 100;
    return deltaPct <= tolerancePct;
  };

  const matches = within(expected.concentrationPct, actual.concentrationPct) && within(expected.liquidityUsd, actual.liquidityUsd);

  return {
    ok: matches,
    expected,
    actual,
    matches,
    tolerancePct,
    note: matches
      ? 'Expected and actual outcomes agree within tolerance.'
      : 'The actual outcome deviates from the expected outcome beyond tolerance — review the refreshed state.',
  };
}