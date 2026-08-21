/**
 * @file src/protocol/canonical.ts
 * @description CANONICAL encoding + public-input layout for the PEL Groth16 protocol.
 *
 * This is the single source of truth for how BN254 values become Starknet state.
 * No ad-hoc modulo operations elsewhere — everything goes through here.
 *
 * ── Field boundary ──────────────────────────────────────────────────────────
 * BN254 scalar field:  r = 21888242871839275222246405745257275088548364400416034343698204186575808495617  (~2^254)
 * Starknet field:      p = 3618502788666131213697322783095070105623107215331596699973092056135872020481  (~2^252, felt252)
 *
 * BN254 elements CAN exceed felt252 (r > p). A Poseidon commitment/nullifier is uniform
 * in [0, r), so ~75% of them are >= p and CANNOT be stored as a single felt252.
 *
 * ── Canonical representation (collision-safe) ────────────────────────────────
 * - commitment / nullifier / payout-commitment  →  u256  (exact 254-bit value, no reduction)
 * - market id / oracle price / payout amount / side / keeper  →  felt252 (already < p)
 *
 * u256 splits a BN254 element into { low: bits 0..127, high: bits 128..255 } — deterministic,
 * injective, and identical across Circom/TS/Garaga/Cairo/storage/indexer/tests.
 */

import { uint256 } from 'starknet';

export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const STARKNET_P =
  3618502788666131213697322783095070105623107215331596699973092056135872020481n;

const U128_MASK = (1n << 128n) - 1n;

/** Exact BN254 element -> u256 (collision-safe; no modulo). */
export function bn254ToU256(x: bigint): { low: bigint; high: bigint } {
  if (x < 0n || x >= BN254_R) throw new Error(`canonical: ${x} out of BN254 range`);
  return { low: x & U128_MASK, high: x >> 128n };
}

/** Inverse of bn254ToU256. */
export function u256ToBn254(low: bigint, high: bigint): bigint {
  return (high << 128n) | low;
}

/** Reduce a small (already < p) value to a felt252, asserting it actually fits. */
export function toFelt252(x: bigint): bigint {
  if (x < 0n) throw new Error('canonical: negative value cannot be a felt252');
  if (x >= STARKNET_P) throw new Error(`canonical: ${x} exceeds felt252 — use u256`);
  return x;
}

/** u256 -> starknet.js uint256 struct. */
export function bn254ToUint256(x: bigint): ReturnType<typeof uint256.bnToUint256> {
  return uint256.bnToUint256(x);
}

// ── Protocol constants ───────────────────────────────────────────────────────
export const MARKET_ID = BigInt('0x' + Buffer.from('BTC-PERP').toString('hex'));
export const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
export const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
export const PAYOUT_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_V2').toString('hex'));

// ── Public input layouts (MUST match the Circom `component main { public [...] }`) ──
// These are the public signals, in order, produced by snarkjs and returned by the
// Garaga verifier's `verify_groth16_proof_bn254` as `Span<u256>`.
//
// Each entry: [ name, on-chain type ]  where type is 'u256' (BN254 field) or 'felt' (small).
export const PUBLIC_INPUT_LAYOUTS = {
  OPEN: [
    ['commitment', 'u256'],
    ['marginNullifier', 'u256'],
    ['marketId', 'felt'],
  ],
  UPDATE: [
    ['oldCommitment', 'u256'],
    ['newCommitment', 'u256'],
    ['oldNullifier', 'u256'],
    ['marketId', 'felt'],
  ],
  FUND: [
    ['oldCommitment', 'u256'],
    ['newCommitment', 'u256'],
    ['oldNullifier', 'u256'],
    ['marketId', 'felt'],
    ['oraclePrice', 'felt'],
    ['fundingRateBpsHr', 'felt'],
    ['intervalsElapsed', 'felt'],
  ],
  CLOSE: [
    ['commitment', 'u256'],
    ['finalNullifier', 'u256'],
    ['payoutCommitment', 'u256'],
    ['payoutAmount', 'felt'],
    ['marketId', 'felt'],
    ['oraclePrice', 'felt'],
  ],
  LIQUIDATE: [
    ['positionCommitment', 'u256'],
    ['positionNullifier', 'u256'],
    ['marketId', 'felt'],
    ['oraclePrice', 'felt'],
    ['keeper', 'felt'],
  ],
} as const;

export type ProofType = keyof typeof PUBLIC_INPUT_LAYOUTS;

export function publicInputCount(type: ProofType): number {
  return PUBLIC_INPUT_LAYOUTS[type].length;
}
