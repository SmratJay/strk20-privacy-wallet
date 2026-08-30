import { describe, it, expect } from 'vitest';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const ETH = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';

const PRICES: Record<string, number> = {
  [STRK]: 0.4,
  [ETH]: 2700,
  [USDC]: 1,
};

describe('buildPortfolioSummary', () => {
  it('computes USD values, allocation percentages and liquidity', () => {
    const rows: PrivateBalanceRow[] = [
      { token: STRK, balance: 500n * 10n ** 18n }, // 500 STRK * 0.4 = $200
      { token: USDC, balance: 800n * 10n ** 6n }, // 800 USDC = $800
    ];
    const s = buildPortfolioSummary(rows, PRICES, {}, 1234);
    expect(s.totalUsd).toBeCloseTo(1000, 5);
    expect(s.liquidityUsd).toBeCloseTo(1000, 5); // both liquid
    expect(s.liquidPct).toBe(100);
    expect(s.topAsset?.symbol).toBe('USDC');
    expect(s.topAsset?.pct).toBeCloseTo(80, 5);
    const strk = s.positions.find((p) => p.symbol === 'STRK');
    expect(strk?.usdValue).toBeCloseTo(200, 5);
    expect(strk?.pct).toBeCloseTo(20, 5);
    expect(strk?.balanceBase).toBe((500n * 10n ** 18n).toString());
  });

  it('skips zero balances and unknown tokens fall back to sane defaults', () => {
    const rows: PrivateBalanceRow[] = [
      { token: STRK, balance: 0n },
      { token: '0x0000000000000000000000000000000000000000000000000000000000000abc', balance: 123n },
    ];
    const s = buildPortfolioSummary(rows, { '0x...abc': 2 }, {}, 1);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].symbol).toMatch(/^0x/);
    expect(s.positions[0].decimals).toBe(18);
    expect(s.positions[0].liquid).toBe(false);
  });

  it('marks STRK/ETH/USDC as liquid', () => {
    const rows: PrivateBalanceRow[] = [
      { token: STRK, balance: 10n * 10n ** 18n },
      { token: ETH, balance: 1n * 10n ** 18n },
      { token: USDC, balance: 100n * 10n ** 6n },
    ];
    const s = buildPortfolioSummary(rows, PRICES, {}, 1);
    expect(s.positions.every((p) => p.liquid)).toBe(true);
  });

  it('reports an empty treasury cleanly', () => {
    const s = buildPortfolioSummary([], {}, {}, 1);
    expect(s.totalUsd).toBe(0);
    expect(s.liquidityUsd).toBe(0);
    expect(s.topAsset).toBeNull();
    expect(s.positions).toEqual([]);
  });
});