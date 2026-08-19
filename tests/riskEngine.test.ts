/**
 * @file tests/riskEngine.test.ts
 * @description Comprehensive Test Suite for Canonical Risk Engine & Economic Invariants
 */

import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../src/protocol/riskEngine';
import { tokensToSats, usdToCents } from '../src/protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../src/protocol/types';

describe('PEL Canonical Risk Engine (Phase 8 & 10)', () => {
  const BTC_PRICE_CENTS = 9_500_000n; // $95,000.00
  const MARGIN_CENTS    = 100_000n;   // $1,000.00
  // 10x leverage -> 0.10526315 BTC -> 10,526,315 sats ($10,000 notional)
  const QTY_SATS        = 10_526_315n;

  it('calculates deterministic notional without precision drift', () => {
    const notional = RiskEngine.getNotional(QTY_SATS, BTC_PRICE_CENTS);
    // 10,526,315 * 9,500,000 / 1e8 = 999,999.925 -> floor 999,999 cents (~$10,000)
    expect(notional).toBe(999999n);
  });

  it('calculates exact linear signed PnL for LONG and SHORT', () => {
    const upPrice = 10_000_000n; // $100,000.00 (+5.26%)
    const longPnl = RiskEngine.getPnl('LONG', QTY_SATS, BTC_PRICE_CENTS, upPrice);
    const shortPnl = RiskEngine.getPnl('SHORT', QTY_SATS, BTC_PRICE_CENTS, upPrice);

    expect(longPnl).toBeGreaterThan(0n);
    expect(shortPnl).toBeLessThan(0n);
    expect(longPnl + shortPnl).toBe(0n); // Antisymmetry
  });

  it('evaluates position solvency: returns isSolvent=true for healthy position', () => {
    const assessment = RiskEngine.evaluatePosition(
      'LONG',
      QTY_SATS,
      BTC_PRICE_CENTS,
      MARGIN_CENTS,
      0n,
      0n,
      BTC_PRICE_CENTS
    );

    expect(assessment.isSolvent).toBe(true);
    expect(assessment.isLiquidatable).toBe(false);
    expect(assessment.equityCents).toBe(MARGIN_CENTS);
    expect(assessment.healthRatioBps).toBeGreaterThan(10000n);
  });

  it('evaluates position solvency: returns isLiquidatable=true when equity <= Mmaint', () => {
    // Price drops 12% to $83,600 -> loss = $1,200 > $1,000 margin -> equity < 0
    const crashPrice = (BTC_PRICE_CENTS * 88n) / 100n;
    const assessment = RiskEngine.evaluatePosition(
      'LONG',
      QTY_SATS,
      BTC_PRICE_CENTS,
      MARGIN_CENTS,
      0n,
      0n,
      crashPrice
    );

    expect(assessment.isSolvent).toBe(false);
    expect(assessment.isLiquidatable).toBe(true);
    expect(assessment.equityCents).toBeLessThan(0n);
  });

  it('evaluates funding payment and economic direction correctly', () => {
    const { fundingCents, isLongPays } = RiskEngine.getFundingPayment(
      QTY_SATS,
      BTC_PRICE_CENTS,
      120n, // positive rate
      1n
    );

    expect(isLongPays).toBe(true);
    expect(fundingCents).toBeGreaterThan(0n);
    // Negative rate -> SHORT pays LONG
    const shortPays = RiskEngine.getFundingPayment(QTY_SATS, BTC_PRICE_CENTS, -120n, 1n);
    expect(shortPays.isLongPays).toBe(false);
    expect(shortPays.fundingCents).toBe(fundingCents);
  });

  it('Bad Debt Waterfall: allocates 2% keeper bounty and remainder to insurance', () => {
    const crashPrice = (BTC_PRICE_CENTS * 88n) / 100n;
    const pnl = RiskEngine.getPnl('LONG', QTY_SATS, BTC_PRICE_CENTS, crashPrice);
    const waterfall = RiskEngine.getBadDebtWaterfall(MARGIN_CENTS, pnl, 0n, 0n, 200n);

    expect(waterfall.userPayoutCents).toBe(0n);
    expect(waterfall.keeperBountyCents).toBe(2000n); // 2% of $1000 = $20.00 (2000 cents)
    expect(waterfall.insuranceCreditCents).toBe(98000n); // 98% of $1000 = $980.00 (98000 cents)
    expect(waterfall.keeperBountyCents + waterfall.insuranceCreditCents).toBe(MARGIN_CENTS);
    expect(waterfall.badDebtDeficitCents).toBeGreaterThan(0n);
  });

  it('computes exact theoretical liquidation price', () => {
    const liqPriceLong = RiskEngine.getLiquidationPriceCents(BTC_PRICE_CENTS, 'LONG', 10, 200n);
    const liqPriceShort = RiskEngine.getLiquidationPriceCents(BTC_PRICE_CENTS, 'SHORT', 10, 200n);

    expect(liqPriceLong).toBeLessThan(BTC_PRICE_CENTS);
    expect(liqPriceShort).toBeGreaterThan(BTC_PRICE_CENTS);
  });
});
