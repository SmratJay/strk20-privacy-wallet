import { describe, it, expect } from 'vitest';
import { parseAmountExact, isZeroAmount } from '@/ai/amount';

describe('parseAmountExact', () => {
  it('parses exact full-balance values with bigint (no float)', () => {
    const r = parseAmountExact('1000', 18);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1000n * 10n ** 18n);
  });

  it('parses one smallest unit above/below boundaries exactly', () => {
    expect(parseAmountExact('1000.000000000000000001', 18)).toEqual({ ok: true, value: 1000n * 10n ** 18n + 1n });
    expect(parseAmountExact('1000', 18)).toEqual({ ok: true, value: 1000n * 10n ** 18n });
  });

  it('handles huge bigint balances without precision loss', () => {
    const huge = '123456789012345678901234567890.123456';
    const r = parseAmountExact(huge, 18);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // value must be exactly integer * 10^18 + fraction
      expect(r.value).toBe(123456789012345678901234567890n * 10n ** 18n + 123456000000000000n);
    }
  });

  it('parses tiny decimal amounts exactly', () => {
    expect(parseAmountExact('0.000001', 18)).toEqual({ ok: true, value: 1000000000000n });
    expect(parseAmountExact('0.000001', 6)).toEqual({ ok: true, value: 1n });
  });

  it('rejects excessive decimal precision (over token decimals) rather than rounding', () => {
    expect(parseAmountExact('1.0000000000000000001', 18).ok).toBe(false); // 19 dp
    expect(parseAmountExact('0.1234567', 6).ok).toBe(false); // 7 dp > 6
    expect(parseAmountExact('0.123456', 6)).toEqual({ ok: true, value: 123456n });
  });

  it('rejects zero only via isZeroAmount; parse returns 0n for "0"', () => {
    expect(parseAmountExact('0', 18)).toEqual({ ok: true, value: 0n });
    expect(parseAmountExact('0.00', 18)).toEqual({ ok: true, value: 0n });
    expect(isZeroAmount('0')).toBe(true);
    expect(isZeroAmount('0.000')).toBe(true);
    expect(isZeroAmount('0.0001')).toBe(false);
    expect(isZeroAmount('150')).toBe(false);
  });

  it('rejects negative, scientific notation, NaN/Infinity and malformed inputs', () => {
    for (const bad of ['-5', '1e5', '1E5', 'NaN', 'Infinity', '-Infinity', '1,000', '.5', '5.', '1.5.5', '  ', 'abc', '']) {
      const r = parseAmountExact(bad, 18);
      expect(r.ok, `amount ${JSON.stringify(bad)} should be rejected`).toBe(false);
    }
  });

  it('rejects invalid decimals counts', () => {
    expect(parseAmountExact('1', -1).ok).toBe(false);
    expect(parseAmountExact('1', 39).ok).toBe(false);
  });
});