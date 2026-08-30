import { describe, it, expect } from 'vitest';
import { canonicalizeAddress } from '@/ai/address';

const VALID = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const VALID_CANON = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

describe('canonicalizeAddress', () => {
  it('accepts a valid full-length Starknet address and canonicalizes (leading zero stripped)', () => {
    const r = canonicalizeAddress(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(VALID_CANON);
  });

  it('canonicalizes mixed-case hex and an uppercase 0X prefix', () => {
    const r = canonicalizeAddress(`0X${VALID.slice(2).toUpperCase()}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(VALID_CANON);
  });

  it('rejects short addresses (not real contract addresses)', () => {
    expect(canonicalizeAddress('0x1234').ok).toBe(false);
    expect(canonicalizeAddress('0x1').ok).toBe(false);
  });

  it('rejects > 64 hex chars, but accepts 64 hex chars whose VALUE is in felt range', () => {
    expect(canonicalizeAddress('0x' + 'a'.repeat(65)).ok).toBe(false);
    // 64 hex chars with a small value (STRK, leading zero) is a real address.
    expect(canonicalizeAddress(VALID).ok).toBe(true);
    // 64 hex chars with a value >= 2^251 are still rejected.
    expect(canonicalizeAddress('0x9' + '0'.repeat(63)).ok).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(canonicalizeAddress('0xzzzz').ok).toBe(false);
    expect(canonicalizeAddress('0x12g').ok).toBe(false);
  });

  it('rejects a missing 0x prefix (bare decimal)', () => {
    expect(canonicalizeAddress('1234').ok).toBe(false);
    expect(canonicalizeAddress('4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d').ok).toBe(false);
  });

  it('rejects the zero address and values at/above the felt range', () => {
    expect(canonicalizeAddress('0x0').ok).toBe(false);
    expect(canonicalizeAddress('0x00').ok).toBe(false);
    // 2^251 as hex -> above felt range
    expect(canonicalizeAddress('0x8000000000000000000000000000000000000000000000000000000000000000').ok).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(canonicalizeAddress('').ok).toBe(false);
    expect(canonicalizeAddress('   ').ok).toBe(false);
    expect(canonicalizeAddress('0x').ok).toBe(false);
  });
});