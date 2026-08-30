/**
 * @file src/ai/amount.ts
 * @description Exact decimal→base-unit parsing for financial policy decisions.
 *
 * Policy-critical comparisons MUST use bigint base units, never floating point. This parser
 * rejects malformed or over-precision amounts instead of silently rounding:
 *   - negative numbers, scientific notation (`1e5`), NaN/Infinity, commas, bare ".",
 *     multiple dots, and empty strings all fail
 *   - a fractional part longer than `decimals` fails (no silent truncation)
 * Returns an exact bigint in the token's smallest unit.
 */
export type AmountParseResult = { ok: true; value: bigint } | { ok: false; error: string };

const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** True when a plain decimal string represents exactly zero (no Number() involved). */
export function isZeroAmount(amount: string): boolean {
  if (!PLAIN_DECIMAL.test(amount)) return false;
  const compact = amount.replace(/\./g, '').replace(/^0+/, '');
  return compact === '';
}

/**
 * Parse a human-readable decimal string into exact base units for `decimals` (0..38).
 * Conservative: any extra fractional precision is rejected, not truncated.
 */
export function parseAmountExact(amount: string, decimals: number): AmountParseResult {
  if (typeof amount !== 'string') return { ok: false, error: 'amount must be a string' };
  const trimmed = amount.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    return { ok: false, error: 'invalid decimals' };
  }
  if (!PLAIN_DECIMAL.test(trimmed)) {
    return { ok: false, error: 'amount must be a plain non-negative decimal (no signs, exponents, commas, NaN/Infinity)' };
  }
  const m = PLAIN_DECIMAL.exec(trimmed)!;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (frac.length > decimals) {
    return { ok: false, error: `amount has more than ${decimals} decimal places` };
  }
  const divisor = 10n ** BigInt(decimals);
  const wholeUnits = BigInt(whole) * divisor;
  const fracUnits = frac.length > 0 ? BigInt(frac.padEnd(decimals, '0')) : 0n;
  return { ok: true, value: wholeUnits + fracUnits };
}