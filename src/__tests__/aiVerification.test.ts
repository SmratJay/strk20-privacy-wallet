import { describe, it, expect } from 'vitest';
import { verifyExecution, DEFAULT_VERIFICATION_TOLERANCE_PCT } from '@/ai/verification';
import { buildPortfolioSummary } from '@/ai/portfolio';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';

function summaryAt(strkUsd: number, usdcUsd: number): ReturnType<typeof buildPortfolioSummary> {
  const strk = strkUsd / 5; // $5/STRK
  return buildPortfolioSummary(
    [
      { token: STRK, balance: BigInt(Math.round(strk * 10 ** 18)) },
      { token: USDC, balance: BigInt(Math.round(usdcUsd * 10 ** 6)) },
    ],
    {
      [STRK]: { priceUsd: 5, source: 'avnu', priceFetchedAt: 1 },
      [USDC]: { priceUsd: 1, source: 'static', priceFetchedAt: 1 },
    },
    1,
  );
}

describe('verifyExecution — expected vs actual', () => {
  it('matches within tolerance when actual agrees with the expectation', () => {
    const expected = { concentrationPct: 58.7, liquidityUsd: 6300, totalUsd: 6300 };
    const actual = summaryAt(3700, 2600); // STRK $3700 / total $6300 = 58.7%, liquidity $6300
    const v = verifyExecution(expected, actual, DEFAULT_VERIFICATION_TOLERANCE_PCT);
    expect(v.matches).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.actual.concentrationPct).toBeCloseTo(58.7, 0);
  });

  it('detects a deviation beyond tolerance', () => {
    const expected = { concentrationPct: 50, liquidityUsd: 9000, totalUsd: 10000 };
    const actual = summaryAt(7400, 2600); // STRK 74% — far from 50%
    const v = verifyExecution(expected, actual, 5);
    expect(v.matches).toBe(false);
    expect(v.ok).toBe(false);
  });

  it('is deterministic for the same inputs', () => {
    const expected = { concentrationPct: 58.7, liquidityUsd: 2600, totalUsd: 6300 };
    const actual = summaryAt(3700, 2600);
    expect(verifyExecution(expected, actual)).toEqual(verifyExecution(expected, actual));
  });
});