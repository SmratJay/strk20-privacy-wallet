/**
 * @file src/protocol/fixedPoint.ts
 * @description PEL Canonical Fixed-Point Math Library
 *
 * Rules (documented, deterministic, identical to Cairo implementation):
 * - ALL divisions floor (never pay out more than earned)
 * - NO floating-point in any protocol-critical calculation
 * - Inputs and outputs are always bigint
 * - PRICE_SCALE  = 100  (cents: $1 = 100n)
 * - QTY_SCALE    = 1e8  (sats:  1 BTC = 100_000_000n)
 * - BPS_SCALE    = 10000 (1.0 = 10000n)
 * - RATE_SCALE   = 1e8  (funding rate: 0.0001 = 10000n)
 */

import { QTY_SCALE, BPS_SCALE } from './types';

// ─── Low-Level Primitives ─────────────────────────────────────────────────────

/** Integer multiply then floor-divide by scale. */
export function mulFixed(a: bigint, b: bigint, scale: bigint): bigint {
  if (scale === 0n) throw new Error('FIXEDPOINT: scale cannot be zero');
  return (a * b) / scale;
}

/** Integer floor-divide. */
export function divFixed(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('FIXEDPOINT: division by zero');
  return a / b;
}

export function absFixed(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function minFixed(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxFixed(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

// ─── Position Math ────────────────────────────────────────────────────────────

/**
 * Notional value in cents.
 * notionalCents = (quantitySats * priceCents) / 1e8
 */
export function calcNotionalCents(quantitySats: bigint, priceCents: bigint): bigint {
  return mulFixed(quantitySats, priceCents, QTY_SCALE);
}

/**
 * Signed PnL in cents.
 * LONG:  PnL = q * (markPrice - entryPrice)
 * SHORT: PnL = q * (entryPrice - markPrice)
 * Result can be negative.
 */
export function calcPnlCents(
  side: 'LONG' | 'SHORT',
  quantitySats: bigint,
  entryPriceCents: bigint,
  markPriceCents: bigint,
): bigint {
  const diff = side === 'LONG'
    ? markPriceCents - entryPriceCents
    : entryPriceCents - markPriceCents;
  return mulFixed(quantitySats, diff, QTY_SCALE);
}

/**
 * Equity in cents.
 * E = margin + signedPnL - funding - fees
 * Can be negative (bad-debt territory).
 */
export function calcEquityCents(
  marginCents: bigint,
  pnlCents: bigint,
  fundingCents: bigint,
  feesCents: bigint,
): bigint {
  return marginCents + pnlCents - fundingCents - feesCents;
}

/**
 * Maintenance margin requirement in cents.
 * M_maint = notionalCents * maint_margin_bps / 10000
 */
export function calcMaintMarginCents(
  quantitySats: bigint,
  markPriceCents: bigint,
  maintenanceMarginBps: bigint,
): bigint {
  const notional = calcNotionalCents(quantitySats, markPriceCents);
  return mulFixed(notional, maintenanceMarginBps, BPS_SCALE);
}

/**
 * Is position liquidatable?
 * LIQUIDATABLE iff equity_cents <= maint_margin_cents
 */
export function isLiquidatable(
  marginCents: bigint,
  pnlCents: bigint,
  fundingCents: bigint,
  feesCents: bigint,
  quantitySats: bigint,
  markPriceCents: bigint,
  maintenanceMarginBps: bigint,
): boolean {
  const equity = calcEquityCents(marginCents, pnlCents, fundingCents, feesCents);
  const maint  = calcMaintMarginCents(quantitySats, markPriceCents, maintenanceMarginBps);
  return equity <= maint;
}

/**
 * Implied leverage in bps (e.g. 10x = 100_000n in bps*10, or 10n * 10_000n).
 * leverageBps = notionalCents * BPS_SCALE / marginCents
 * 10x leverage → 100_000n (i.e. bps * 10 ... divide by 10_000 to get the ratio)
 * We store as: notional / margin * 10000 so that 10.0x = 100_000n
 */
export function calcImpliedLeverageBps(
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
): bigint {
  if (marginCents === 0n) return 0n;
  const notional = calcNotionalCents(quantitySats, entryPriceCents);
  return mulFixed(notional, BPS_SCALE, marginCents);
}

/**
 * Funding payment in cents for one accrual interval.
 * F = (quantitySats * markPriceCents / 1e8) * fundingRateBpsHr / 10000
 *
 * Sign convention (returned value ≥ 0, caller decides direction):
 *   If fundingRateBpsHr > 0: LONG pays SHORT → add to LONG's fundingCents
 *   If fundingRateBpsHr < 0: SHORT pays LONG → add to SHORT's fundingCents
 */
export function calcFundingCentsPerInterval(
  quantitySats: bigint,
  markPriceCents: bigint,
  fundingRateBpsHr: bigint,  // signed: positive = longs pay, negative = shorts pay
  intervalsElapsed: bigint = 1n,
): bigint {
  const notional = calcNotionalCents(quantitySats, markPriceCents);
  const rawFunding = mulFixed(notional, absFixed(fundingRateBpsHr), BPS_SCALE);
  return rawFunding * intervalsElapsed;
}

/**
 * Taker fee in cents.
 * fee = notionalCents * takerFeeBps / 10000
 */
export function calcTakerFeeCents(
  quantitySats: bigint,
  priceCents: bigint,
  takerFeeBps: bigint,
): bigint {
  const notional = calcNotionalCents(quantitySats, priceCents);
  return mulFixed(notional, takerFeeBps, BPS_SCALE);
}

/**
 * Validate leverage within bounds.
 * Returns { isValid, leverageBps }
 */
export function validateLeverage(
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
  maxLeverage: number,
): { isValid: boolean; leverageBps: bigint } {
  const leverageBps = calcImpliedLeverageBps(quantitySats, entryPriceCents, marginCents);
  const maxLeverageBps = BigInt(maxLeverage) * BPS_SCALE;
  const minLeverageBps = 9_500n; // 0.95x minimum (avoids rounding edge cases)
  const isValid = leverageBps >= minLeverageBps && leverageBps <= maxLeverageBps + 500n;
  return { isValid, leverageBps };
}

/**
 * Validate execution price deviation from oracle.
 * |execPrice - oraclePrice| / oraclePrice <= maxDeviationBps / 10000
 */
export function validatePriceDeviation(
  execPriceCents: bigint,
  oraclePriceCents: bigint,
  maxDeviationBps: bigint,
): boolean {
  if (oraclePriceCents === 0n) return false;
  const diff = absFixed(execPriceCents - oraclePriceCents);
  const deviationBps = mulFixed(diff, BPS_SCALE, oraclePriceCents);
  return deviationBps <= maxDeviationBps;
}

// ─── Unit Converters (for display only — never use in protocol math) ──────────

export function centsToUsd(cents: bigint): number {
  return Number(cents) / 100;
}

export function usdToCents(usd: number): bigint {
  return BigInt(Math.floor(usd * 100));
}

export function satsToTokens(sats: bigint): number {
  return Number(sats) / 100_000_000;
}

export function tokensToSats(tokens: number): bigint {
  return BigInt(Math.floor(tokens * 100_000_000));
}
