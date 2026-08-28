import { describe, it, expect } from 'vitest';
import { computeMetrics } from '@/services/launchService';
import { parseTokenAmount, formatTokenAmount } from '@/utils/formatters';

const ONE = 10n ** 18n;

function makeCurve(over: Partial<any> = {}) {
  return {
    virtualBase: 15n * ONE,
    virtualToken: 1073000000000000000000000000n,
    baseReserve: 10n * ONE,
    tokenReserve: 5n * 10n ** 23n,
    graduationTarget: 50n * ONE,
    graduated: false,
    feeBps: 100n,
    priceBase: 25n * ONE,
    priceToken: 1073000000000000000000000000n - 5n * 10n ** 23n,
    ...over,
  };
}

const metadata = {
  name: 'HAMSTR',
  symbol: 'HAMSTR',
  decimals: 18,
  totalSupply: 1073000000000000000000000000n,
};

describe('computeMetrics', () => {
  it('computes price, market cap, liquidity and graduation from on-chain curve state', () => {
    const m = computeMetrics(makeCurve(), metadata, 'mainnet');
    expect(m.price).toBeGreaterThan(0);
    expect(m.priceUsd).toBeGreaterThan(0);
    expect(m.liquidity).toBeCloseTo(10, 5);
    expect(m.graduationPct).toBeCloseTo(20, 5); // 10/50
    expect(m.graduated).toBe(false);
  });

  it('reports graduation at 100% when graduated', () => {
    const m = computeMetrics(makeCurve({ graduated: true, baseReserve: 60n * ONE }), metadata, 'mainnet');
    expect(m.graduated).toBe(true);
    expect(m.graduationPct).toBe(100);
  });

  it('never divides by zero when price is undefined', () => {
    const m = computeMetrics(makeCurve({ priceBase: 0n, priceToken: 0n }), metadata, 'mainnet');
    expect(m.price).toBe(0);
    expect(m.marketCap).toBe(0);
    expect(Number.isFinite(m.price)).toBe(true);
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