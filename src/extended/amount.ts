/**
 * @file src/extended/amount.ts
 * @description Exact decimal arithmetic for Extended order amounts.
 *
 * Extended order settlement signs integer "Stark" quantities:
 *   base_amount    = round(syntheticQty * syntheticResolution)
 *   quote_amount   = round(syntheticQty * price * collateralResolution)
 *   fee_amount     = round((takerFee + builderFee) * notional * collateralResolution)
 *
 * Rounding follows the official SDK: BUY rounds UP, SELL rounds DOWN, fees always UP.
 * All decimal math is done over BigInt mantissas so no floating-point drift can corrupt
 * a signed message.
 */

export type RoundingMode = 'UP' | 'DOWN';

interface ParsedDecimal {
  mantissa: bigint; // signed
  scale: number; // number of decimal places (>= 0)
}

function parseDecimal(input: string | number): ParsedDecimal {
  const raw = typeof input === 'number' ? input.toString() : input.trim();
  const neg = raw.startsWith('-');
  const unsigned = neg ? raw.slice(1) : raw;
  const [intPart, fracPart = ''] = unsigned.split('.');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    throw new Error(`Invalid decimal: "${raw}"`);
  }
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0';
  let mantissa = BigInt(digits);
  if (neg) mantissa = -mantissa;
  return { mantissa, scale: fracPart.length };
}

function formatDecimal({ mantissa, scale }: ParsedDecimal): string {
  const neg = mantissa < 0n;
  const abs = neg ? -mantissa : mantissa;
  let digits = abs.toString();
  if (scale > 0) {
    if (digits.length <= scale) {
      digits = digits.padStart(scale + 1, '0');
    }
    const intPart = digits.slice(0, digits.length - scale) || '0';
    let fracPart = digits.slice(digits.length - scale);
    // Normalise by stripping trailing fractional zeros (matches Decimal semantics).
    fracPart = fracPart.replace(/0+$/, '');
    return (neg ? '-' : '') + intPart + (fracPart ? '.' + fracPart : '');
  }
  return (neg ? '-' : '') + digits;
}

/** Exact multiplication of two decimal strings. */
export function mulDec(a: string | number, b: string | number): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  return formatDecimal({ mantissa: pa.mantissa * pb.mantissa, scale: pa.scale + pb.scale });
}

/** Exact multiplication of a decimal string by an integer (returns a decimal string). */
export function mulDecInt(a: string | number, b: number | bigint): string {
  const pa = parseDecimal(a);
  return formatDecimal({ mantissa: pa.mantissa * BigInt(b), scale: pa.scale });
}

/** Add two decimal strings exactly. */
export function addDec(a: string | number, b: string | number): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const am = pa.mantissa * 10n ** BigInt(scale - pa.scale);
  const bm = pb.mantissa * 10n ** BigInt(scale - pb.scale);
  return formatDecimal({ mantissa: am + bm, scale });
}

/**
 * Round a decimal string to a BigInt integer.
 *   - 'UP'   → round away from zero (Python decimal.ROUND_UP)
 *   - 'DOWN' → round toward zero (Python decimal.ROUND_DOWN)
 */
export function roundToInt(value: string, mode: RoundingMode): bigint {
  const p = parseDecimal(value);
  const divisor = 10n ** BigInt(p.scale);
  const quotient = p.mantissa / divisor;
  const remainder = p.mantissa % divisor;
  if (mode === 'UP' && remainder !== 0n) {
    return p.mantissa >= 0n ? quotient + 1n : quotient - 1n;
  }
  return quotient;
}
