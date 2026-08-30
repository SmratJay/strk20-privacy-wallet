/**
 * @file src/ai/address.ts
 * @description Strict Starknet address canonicalization for executable proposals.
 *
 * Reuses the repository's `starknet` package (`validateAndParseAddress` + `num.toHex`),
 * which already enforce valid hex and the felt range. On top of that, executable
 * asset/recipient addresses must be:
 *   - 0x/0X prefixed (no bare decimal felts)
 *   - non-zero
 *   - not trivially short (< 2^32) — real contract addresses are large
 * Returns a canonical lowercase hex (leading zeros stripped), so policy comparisons and
 * the position lookup always agree.
 */
import { num, validateAndParseAddress } from 'starknet';

/** A real contract address is never below 2^32. */
const MIN_ADDRESS_VALUE = 2n ** 32n;
/** Starknet felt (and thus contract address) range ceiling: 2^251. */
const FELT_MAX = 2n ** 251n;

export type CanonicalizeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function canonicalizeAddress(input: string): CanonicalizeResult {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, error: 'address is empty' };
  }
  const trimmed = input.trim();
  if (!/^0[xX][0-9a-f]+$/i.test(trimmed)) {
    return { ok: false, error: 'address must be 0x-prefixed hex (no bare decimal values)' };
  }
  const hexBody = trimmed.slice(2);
  if (hexBody.length === 0 || hexBody.length > 64) {
    return { ok: false, error: 'address hex length out of range' };
  }
  let canonical: string;
  try {
    canonical = num.toHex(validateAndParseAddress(trimmed)).toLowerCase();
  } catch {
    return { ok: false, error: 'address failed Starknet validation' };
  }
  let value: bigint;
  try {
    value = BigInt(canonical);
  } catch {
    return { ok: false, error: 'address not a valid bigint' };
  }
  if (value === 0n) return { ok: false, error: 'zero address is not allowed' };
  if (value < MIN_ADDRESS_VALUE) return { ok: false, error: 'address is too short to be a real contract' };
  if (value >= FELT_MAX) return { ok: false, error: 'address exceeds the Starknet felt range' };
  return { ok: true, value: canonical };
}