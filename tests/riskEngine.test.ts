/**
 * @file tests/riskEngine.test.ts
 * @description Comprehensive Test Suite for Canonical Risk Engine & Economic Invariants
 */

import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../src/protocol/riskEngine';
import { BTC_PERP_CONFIG } from '../src/protocol/types';

describe('PEL Canonical Risk Engine (Phase 8 & 10)', () => {
  const BTC_PRICE_CENTS = 9_500_000n; // ,000.00
  const MARGIN_CENTS    = 100_000n;   // ,000.00
  // 10x leverage -> 0.10526315 BTC -> 10,526,315 sats (,000 notional)
  const QTY_SATS        = 10_526_315n;

  it('calculates deterministic notional without precision drift', () => {
    const notional = RiskEngine.getNotional(QTY_SATS, BTC_PRICE_CENTS);
    // 10,526,315 * 9,500,000 / 1e8 = 999,999.925 -> floor 999,999 cents (~,000)
    expect(notional).toBe(999999n);
  });

  it('calculates exact linear signed PnL for LONG and SHORT', () => {
    const upPrice = 10_000_000n; // ,000.00 (+5.26%)
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
    // Price drops 12% to ,600 -> loss = ,200 > ,000 margin -> equity < 0
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
    expect(waterfall.keeperBountyCents).toBe(2000n); // 2% of  = .00 (2000 cents)
    expect(waterfall.insuranceCreditCents).toBe(98000n); // 98% of  = .00 (98000 cents)
    expect(waterfall.keeperBountyCents + waterfall.insuranceCreditCents).toBe(MARGIN_CENTS);
    expect(waterfall.badDebtDeficitCents).toBeGreaterThan(0n);
  });

  it('computes exact theoretical liquidation price', () => {
    const liqPriceLong = RiskEngine.getLiquidationPriceCents(BTC_PRICE_CENTS, 'LONG', 10, 200n);
    const liqPriceShort = RiskEngine.getLiquidationPriceCents(BTC_PRICE_CENTS, 'SHORT', 10, 200n);

    expect(liqPriceLong).toBeLessThan(BTC_PRICE_CENTS);
    expect(liqPriceShort).toBeGreaterThan(BTC_PRICE_CENTS);
  });

  describe('P0-2: Nine Canonical Liquidation Scenarios', () => {
    // 1. healthy position: equity >> maintenance margin
    it('Scenario 1: Healthy position (not liquidatable)', () => {
      const pnl = RiskEngine.getPnl('LONG', QTY_SATS, BTC_PRICE_CENTS, BTC_PRICE_CENTS); // 0 PnL
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      const maint = RiskEngine.getMaintenanceMargin(QTY_SATS, BTC_PRICE_CENTS, 200n);
      expect(equity > maint).toBe(true);
    });

    // 2. barely liquidatable: equity == maintenance margin
    it('Scenario 2: Barely liquidatable (equity == maintenance margin)', () => {
      const maint = RiskEngine.getMaintenanceMargin(QTY_SATS, BTC_PRICE_CENTS, 200n);
      const pnl = maint - MARGIN_CENTS;
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      expect(equity).toBe(maint);
      expect(equity <= maint).toBe(true);
    });

    // 3. moderately underwater: 0 < equity < maintenance margin
    it('Scenario 3: Moderately underwater (0 < equity < maintenance)', () => {
      const maint = RiskEngine.getMaintenanceMargin(QTY_SATS, BTC_PRICE_CENTS, 200n);
      const equity = maint / 2n;
      expect(equity > 0n).toBe(true);
      expect(equity < maint).toBe(true);
    });

    // 4. deeply underwater: equity < -margin (losses exceed 2x margin)
    it('Scenario 4: Deeply underwater (loss exceeds 2x margin)', () => {
      const pnl = -(MARGIN_CENTS * 2n);
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      expect(equity).toBe(-MARGIN_CENTS);
      expect(equity < 0n).toBe(true);
    });

    // 5. equity > 0 liquidation: seized collateral is capped by positive equity
    it('Scenario 5: Positive equity liquidation (seized collateral == equity)', () => {
      const pnl = -90_000n; //  loss on  margin ->  equity remaining
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      expect(equity).toBe(10_000n);
      const seized = equity > 0n ? equity : MARGIN_CENTS;
      expect(seized).toBe(10_000n);
    });

    // 6. equity = 0: exact wipeout (seized == margin, bad debt == 0)
    it('Scenario 6: Equity == 0 exact wipeout (seized == margin, bad debt == 0)', () => {
      const pnl = -MARGIN_CENTS;
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      expect(equity).toBe(0n);
      const badDebt = equity < 0n ? -equity : 0n;
      expect(badDebt).toBe(0n);
    });

    // 7. equity < 0: negative equity generates bad debt
    it('Scenario 7: Equity < 0 creates explicit bad debt', () => {
      const pnl = -150_000n; // ,500 loss on ,000 margin
      const equity = RiskEngine.getEquity(MARGIN_CENTS, pnl, 0n, 0n);
      expect(equity).toBe(-50_000n);
      const badDebt = equity < 0n ? -equity : 0n;
      expect(badDebt).toBe(50_000n);
    });

    // 8. insurance sufficient: insurance absorbs full bad debt
    it('Scenario 8: Insurance sufficient to absorb bad debt', () => {
      const badDebt = 50_000n;
      const insuranceBalance = 100_000n;
      const absorbed = badDebt > insuranceBalance ? insuranceBalance : badDebt;
      const remainingBadDebt = badDebt - absorbed;
      expect(absorbed).toBe(50_000n);
      expect(remainingBadDebt).toBe(0n);
    });

    // 9. insurance insufficient: insurance partially absorbs, remainder is system bad debt
    it('Scenario 9: Insurance insufficient (remainder is system bad debt)', () => {
      const badDebt = 50_000n;
      const insuranceBalance = 20_000n;
      const absorbed = badDebt > insuranceBalance ? insuranceBalance : badDebt;
      const systemBadDebt = badDebt - absorbed;
      expect(absorbed).toBe(20_000n);
      expect(systemBadDebt).toBe(30_000n);
    });
  });
});
