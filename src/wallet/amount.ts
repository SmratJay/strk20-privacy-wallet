/**
 * Wallet Core — exact decimal amount parsing.
 *
 * Financial amounts must NEVER be parsed via `Number(amount) * 10 ** decimals` (float math
 * loses precision on large values). This module converts a user-facing decimal string into
 * integer base units using exact integer arithmetic only.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d*))?$/;

/**
 * Parse a non-negative decimal string into integer base units for a token with `decimals`
 * decimal places. Exact integer math — no floating point.
 *
 * Rules:
 *  - empty / whitespace-only / negative / malformed input throws.
 *  - more fractional digits than `decimals` throws (refuses to silently round).
 *
 * Examples:
 *  parseAmountToBase("0.001", 18) → 1_000_000_000_000_000n
 *  parseAmountToBase("1", 6)      → 1_000_000n
 *  parseAmountToBase("0.1", 18)   → 100_000_000_000_000_000n
 */
export function parseAmountToBase(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 256) {
    throw new Error(`Invalid token decimals: ${decimals}.`);
  }
  const raw = (amount ?? "").trim();
  const match = DECIMAL_RE.exec(raw);
  if (!match) {
    throw new Error(`Invalid amount: "${amount}". Use a non-negative decimal number.`);
  }
  const integer = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(
      `Amount "${amount}" has more than ${decimals} decimal places. Refusing to round silently.`,
    );
  }
  const whole = BigInt(integer);
  const scale = 10n ** BigInt(decimals);
  const paddedFraction = fraction.padEnd(decimals, "0");
  const fractional = paddedFraction === "" ? 0n : BigInt(paddedFraction);
  return whole * scale + fractional;
}