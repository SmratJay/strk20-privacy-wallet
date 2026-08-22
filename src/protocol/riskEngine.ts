/**
 * @file src/protocol/riskEngine.ts
 * @description PEL Canonical Risk Engine (Whitepaper Sections 7, 8, 11)
 *
 * THE SINGLE SOURCE OF TRUTH for all financial, margin, PnL, funding, solvency,
 * and liquidation risk calculations across PEL Perpetuals.
 *
 * Standard Units:
 *   - Currency: integer cents ($1.00 = 100 cents) -> PRICE_SCALE = 100n
 *   - Quantity: satoshis (1 BTC = 100,000,000 sats) -> QTY_SCALE = 100_000_000n
 *   - Basis Points: 1 bp = 1/10,000 -> BPS_SCALE = 10,000n
 *
 * Zero floating-point arithmetic. Floor division used universally for conservative safety.
 */

import {
  PRICE_SCALE,
  QTY_SCALE,
  BPS_SCALE,
  mulFixed,
  divFixed,
  absFixed,
  minFixed,
  maxFixed,
  calcNotionalCents,
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  isLiquidatable,
  calcImpliedLeverageBps,
  calcFundingCentsPerInterval,
  calcTakerFeeCents,
  validateLeverage,
  validatePriceDeviation,
  centsToUsd,
  usdToCents,
  satsToTokens,
  tokensToSats,
} from './fixedPoint';
import { BTC_PERP_CONFIG, MarketConfig } from './types';

export interface PositionRiskAssessment {
  notionalCents: bigint;
  equityCents: bigint;
  pnlCents: bigint;
  fundingCents: bigint;
  feesCents: bigint;
  maintenanceMarginCents: bigint;
  initialMarginCents: bigint;
  impliedLeverageBps: bigint;
  isSolvent: boolean;
  isLiquidatable: boolean;
  healthRatioBps: bigint;
}

export interface BadDebtWaterfall {
  lockedMarginCents: bigint;
  userPayoutCents: bigint;
  keeperBountyCents: bigint;
  insuranceCreditCents: bigint;
  badDebtDeficitCents: bigint;
}

export class RiskEngine {
  /**
   * Calculate position notional value in cents
   */
  static getNotional(quantitySats: bigint, markPriceCents: bigint): bigint {
    return calcNotionalCents(BigInt(quantitySats), BigInt(markPriceCents));
  }

  /**
   * Calculate signed linear PnL in cents
   */
  static getPnl(
    side: 'LONG' | 'SHORT',
    quantitySats: bigint,
    entryPriceCents: bigint,
    markPriceCents: bigint
  ): bigint {
    return calcPnlCents(side, BigInt(quantitySats), BigInt(entryPriceCents), BigInt(markPriceCents));
  }

  /**
   * Calculate exact position equity in cents
   */
  static getEquity(
    marginCents: bigint,
    pnlCents: bigint,
    fundingCents: bigint = 0n,
    feesCents: bigint = 0n
  ): bigint {
    return calcEquityCents(BigInt(marginCents), BigInt(pnlCents), BigInt(fundingCents), BigInt(feesCents));
  }

  /**
   * Calculate maintenance margin requirement in cents
   */
  static getMaintenanceMargin(
    quantitySats: bigint,
    markPriceCents: bigint,
    maintMarginBps: bigint | number = BTC_PERP_CONFIG.maintenanceMarginBps
  ): bigint {
    return calcMaintMarginCents(BigInt(quantitySats), BigInt(markPriceCents), BigInt(maintMarginBps));
  }

  /**
   * Calculate initial margin requirement in cents
   */
  static getInitialMargin(
    quantitySats: bigint,
    entryPriceCents: bigint,
    initialMarginBps: bigint | number = BTC_PERP_CONFIG.initialMarginBps
  ): bigint {
    const notional = calcNotionalCents(BigInt(quantitySats), BigInt(entryPriceCents));
    return mulFixed(notional, BigInt(initialMarginBps), BPS_SCALE);
  }

  /**
   * Calculate periodic funding payment in cents
   */
  static getFundingPayment(
    quantitySats: bigint,
    markPriceCents: bigint,
    fundingRateBpsHr: bigint | number = BTC_PERP_CONFIG.fundingRateBpsHr,
    intervalsElapsed: bigint | number = 1n
  ): { fundingCents: bigint; isLongPays: boolean } {
    const rateBig = BigInt(fundingRateBpsHr);
    const intervalsBig = BigInt(intervalsElapsed);
    const isLongPays = rateBig >= 0n;
    const absRate = absFixed(rateBig);
    const notional = calcNotionalCents(BigInt(quantitySats), BigInt(markPriceCents));
    const singleInterval = mulFixed(notional, absRate, BPS_SCALE);
    const fundingCents = singleInterval * intervalsBig;
    return { fundingCents, isLongPays };
  }

  /**
   * Calculate taker fee in cents
   */
  static getTakerFee(
    quantitySats: bigint,
    priceCents: bigint,
    takerFeeBps: bigint | number = BTC_PERP_CONFIG.takerFeeBps
  ): bigint {
    return calcTakerFeeCents(BigInt(quantitySats), BigInt(priceCents), BigInt(takerFeeBps));
  }

  /**
   * Full comprehensive risk assessment of a position against current market mark price
   */
  static evaluatePosition(
    side: 'LONG' | 'SHORT',
    quantitySats: bigint,
    entryPriceCents: bigint,
    marginCents: bigint,
    fundingCents: bigint = 0n,
    feesCents: bigint = 0n,
    markPriceCents: bigint = entryPriceCents,
    config: MarketConfig = BTC_PERP_CONFIG
  ): PositionRiskAssessment {
    const q = BigInt(quantitySats);
    const entry = BigInt(entryPriceCents);
    const margin = BigInt(marginCents);
    const funding = BigInt(fundingCents);
    const fees = BigInt(feesCents);
    const mark = BigInt(markPriceCents);

    const notionalCents = calcNotionalCents(q, mark);
    const pnlCents = calcPnlCents(side, q, entry, mark);
    const equityCents = calcEquityCents(margin, pnlCents, funding, fees);
    const maintenanceMarginCents = calcMaintMarginCents(q, mark, BigInt(config.maintenanceMarginBps));
    const initialMarginCents = mulFixed(notionalCents, BigInt(config.initialMarginBps), BPS_SCALE);
    const impliedLeverageBps = calcImpliedLeverageBps(q, mark, margin);

    const isLiquidatableBool = isLiquidatable(
      margin,
      pnlCents,
      funding,
      fees,
      q,
      mark,
      BigInt(config.maintenanceMarginBps)
    );

    const isSolvent = !isLiquidatableBool;
    const healthRatioBps = maintenanceMarginCents > 0n
      ? divFixed(equityCents * BPS_SCALE, maintenanceMarginCents)
      : BPS_SCALE;

    return {
      notionalCents,
      equityCents,
      pnlCents,
      fundingCents,
      feesCents,
      maintenanceMarginCents,
      initialMarginCents,
      impliedLeverageBps,
      isSolvent,
      isLiquidatable: isLiquidatableBool,
      healthRatioBps,
    };
  }

  /**
   * Authoritative liquidation waterfall matching Cairo PELPerpsCore & PELLiquidityVault
   */
  static getLiquidationSettlement(
    lockedMarginCents: bigint,
    pnlCents: bigint,
    fundingCents: bigint = 0n,
    feesCents: bigint = 0n,
    keeperBountyBps: bigint | number = 200n
  ): {
    seizedCollateralCents: bigint;
    badDebtCents: bigint;
    traderLossCents: bigint;
    keeperBountyCents: bigint;
    lpShareCents: bigint;
    insuranceShareCents: bigint;
    treasuryShareCents: bigint;
  } {
    const margin = BigInt(lockedMarginCents);
    const equity = calcEquityCents(margin, BigInt(pnlCents), BigInt(fundingCents), BigInt(feesCents));
    const seizedCollateralCents = equity > 0n ? equity : 0n;
    const badDebtCents = equity < 0n ? -equity : 0n;
    const traderLossCents = margin > seizedCollateralCents ? margin - seizedCollateralCents : 0n;
    const rawBounty = (seizedCollateralCents * BigInt(keeperBountyBps)) / 10000n;
    const keeperBountyCents = rawBounty > 50000n ? 50000n : rawBounty;
    const netSeized = seizedCollateralCents >= keeperBountyCents ? seizedCollateralCents - keeperBountyCents : 0n;
    const lpRemnant = (netSeized * 7000n) / 10000n;
    const insuranceShareCents = (netSeized * 2000n) / 10000n;
    const treasuryShareCents = netSeized - lpRemnant - insuranceShareCents;
    const lpShareCents = traderLossCents + lpRemnant;

    return {
      seizedCollateralCents,
      badDebtCents,
      traderLossCents,
      keeperBountyCents,
      lpShareCents,
      insuranceShareCents,
      treasuryShareCents,
    };
  }

  /**
   * Calculate bad debt distribution & settlement waterfall
   */
  static getBadDebtWaterfall(
    lockedMarginCents: bigint,
    pnlCents: bigint,
    fundingCents: bigint = 0n,
    feesCents: bigint = 0n,
    keeperBountyBps: bigint | number = 200n
  ): BadDebtWaterfall {
    const margin = BigInt(lockedMarginCents);
    const pnl = BigInt(pnlCents);
    const funding = BigInt(fundingCents);
    const fees = BigInt(feesCents);
    const bountyBps = BigInt(keeperBountyBps);

    const equity = calcEquityCents(margin, pnl, funding, fees);

    if (equity > 0n) {
      const userPayoutCents = minFixed(equity, margin + maxFixed(0n, pnl));
      const loss = margin > userPayoutCents ? margin - userPayoutCents : 0n;
      return {
        lockedMarginCents: margin,
        userPayoutCents,
        keeperBountyCents: 0n,
        insuranceCreditCents: loss,
        badDebtDeficitCents: 0n,
      };
    } else {
      const keeperBountyCents = (margin * bountyBps) / BPS_SCALE;
      const remainingCollateral = margin > keeperBountyCents ? margin - keeperBountyCents : 0n;
      const badDebtDeficitCents = absFixed(equity);

      return {
        lockedMarginCents: margin,
        userPayoutCents: 0n,
        keeperBountyCents,
        insuranceCreditCents: remainingCollateral,
        badDebtDeficitCents,
      };
    }
  }

  /**
   * Theoretical liquidation price formula
   */
  static getLiquidationPriceCents(
    entryPriceCents: bigint,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintMarginBps: bigint | number = BTC_PERP_CONFIG.maintenanceMarginBps
  ): bigint {
    const entry = BigInt(entryPriceCents);
    const maintBps = BigInt(maintMarginBps);
    const marginFractionBps = BigInt(Math.floor((1 / leverage) * 10000));
    if (side === 'LONG') {
      const factorBps = BPS_SCALE - marginFractionBps + maintBps;
      return (entry * factorBps) / BPS_SCALE;
    } else {
      const factorBps = BPS_SCALE + marginFractionBps - maintBps;
      return (entry * factorBps) / BPS_SCALE;
    }
  }
}
