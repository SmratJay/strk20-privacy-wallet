import { describe, it, expect } from 'vitest';
import { computeMetrics } from '@/services/launchService';
import { parseTokenAmount, formatTokenAmount } from '@/utils/formatters';

const ONE = 10n ** 18n;

function makeCurve(over: Partial<any> = {}) {
  return {
    virtualBase: 30n * ONE,
    virtualToken: 1000000000000000000000000000n,
    baseReserve: 10n * ONE,
    tokenReserve: 5n * 10n ** 23n,
    graduationTarget: 120n * ONE,
    graduated: false,
    feeBps: 100n,
    creatorFeeBps: 25n,
    protocolFeeBps: 25n,
    maxTradeBps: 1000n,
    priceBase: 40n * ONE,
    priceToken: 1000000000000000000000000000n - 5n * 10n ** 23n,
    ...over,
  };
}

const metadata = {
  name: 'HAMSTR',
  symbol: 'HAMSTR',
  decimals: 18,
  totalSupply: 1000000000000000000000000000n,
};

describe('computeMetrics', () => {
  it('computes price, market cap, liquidity and graduation from on-chain curve state', () => {
    const m = computeMetrics(makeCurve(), metadata, 'mainnet');
    expect(m.price).toBeGreaterThan(0);
    expect(m.priceUsd).toBeGreaterThan(0);
    expect(m.liquidity).toBeCloseTo(10, 5);
    expect(m.graduationPct).toBeCloseTo(8.3333333, 5); // 10/120
    expect(m.graduated).toBe(false);
  });

  it('reports graduation at 100% when graduated', () => {
    const m = computeMetrics(makeCurve({ graduated: true, baseReserve: 120n * ONE }), metadata, 'mainnet');
    expect(m.graduated).toBe(true);
    expect(m.graduationPct).toBe(100);
  });

  it('never divides by zero when price is undefined', () => {
    const m = computeMetrics(makeCurve({ priceBase: 0n, priceToken: 0n }), metadata, 'mainnet');
    expect(m.price).toBe(0);
    expect(m.marketCap).toBe(0);
    expect(Number.isFinite(m.price)).toBe(true);
  });

  it('market cap is unit-correct: priceUsd × human-readable supply (not raw 1e18)', () => {
    const curve = makeCurve();
    // tokenReserve = 5e23 raw → 500,000 tokens at 18 dp
    const humanCirculating = Number(curve.tokenReserve) / 10 ** 18;
    const priceUsd = (Number(curve.priceBase) / Number(curve.priceToken)) * 0.35;
    const m = computeMetrics(curve, metadata, 'mainnet', 0n);
    expect(m.marketCap).toBeCloseTo(priceUsd * humanCirculating, 8);
    // Regression: must NOT be price × raw smallest-unit supply (previously ~1e19).
    expect(m.marketCap).toBeLessThan(1_000_000);
    expect(m.marketCap).toBeLessThan((Number(curve.priceBase) / Number(curve.priceToken)) * Number(curve.tokenReserve));
  });

  it('volume is cumulative traded volume, never current liquidity/reserves', () => {
    const m = computeMetrics(makeCurve(), metadata, 'mainnet', 12345n * ONE);
    expect(m.volume).toBeCloseTo(12345, 5);
    // Changing the reserve must NOT change volume.
    const m2 = computeMetrics(makeCurve({ baseReserve: 999n * ONE }), metadata, 'mainnet', 12345n * ONE);
    expect(m2.volume).toBeCloseTo(12345, 5);
    // Zero events → zero volume, even when the curve holds reserves.
    const m3 = computeMetrics(makeCurve({ baseReserve: 30n * ONE }), metadata, 'mainnet', 0n);
    expect(m3.volume).toBe(0);
  });
});

describe('parseTokenAmount / formatTokenAmount round trip', () => {
  it('parses a decimal string to base units and back', () => {
    const parsed = parseTokenAmount('12.5', 18);
    expect(parsed).toBe(12500000000000000000n);
    expect(formatTokenAmount(parsed, 18, 4)).toBe('12.5');
  });

  it('clamps fractional precision to the token decimals', () => {
    const parsed = parseTokenAmount('0.000000000000000000001', 18); // 1 wei beyond precision
    expect(parsed).toBe(0n);
  });
});