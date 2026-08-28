/**
 * @file src/extended/crypto.ts
 * @description Starknet cryptographic primitives for the Extended Exchange integration.
 *
 * These functions are a TypeScript port of Extended's official Python SDK signing layer
 * (`fast_stark_crypto` → `x10xchange/rust-crypto-lib-base`). Every primitive below is
 * verified against the official Rust test vectors (see src/__tests__/extendedCrypto.test.ts):
 *   - StarkNetDomain / Order selectors
 *   - Poseidon-based domain + order message hashing (SNIP-12 style, "Perpetuals" domain)
 *   - StarkEx L2 key derivation from an Ethereum signature (grindKey over `r`)
 *   - Stark-curve ECDSA sign + pedersen hash
 *
 * No secrets are stored here — private keys are passed in per-call and never persisted.
 */

import { ec, hash } from 'starknet';

const curve = ec.starkCurve;

/** The Starknet field prime (Fp). */
export const FIELD_PRIME: bigint = curve.Fp251.ORDER;

/** ASCII short-string encoding used by Cairo `cairo_short_string_to_felt` (≤ 31 bytes). */
export function encodeShortString(str: string): bigint {
  const bytes = Buffer.from(str, 'ascii');
  if (bytes.length > 31) throw new Error(`Short string exceeds 31 bytes: "${str}"`);
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

/** Starknet `get_selector_from_name` (keccak256 masked to 250 bits) → bigint. */
export function selector(name: string): bigint {
  return BigInt(hash.getSelectorFromName(name));
}

/** Standard Starknet Poseidon hash over an array of field elements. */
export function poseidonHashMany(values: bigint[]): bigint {
  return curve.poseidonHashMany(values);
}

/** Starknet pedersen hash of two field elements. */
export function pedersen(a: bigint, b: bigint): bigint {
  return BigInt(curve.pedersen(a, b));
}

/** Normalise a signed i64 into a field element (wraps negatives mod the field prime). */
export function toFelt(v: bigint): bigint {
  if (v >= 0n) return v;
  return ((v % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
}

/** Derive the L2 Stark private key from an Ethereum ECDSA signature (hex, `0x` + 65 bytes). */
export function privateKeyFromEthSignature(ethSignature: string): string {
  // ethSigToPrivate returns a hex string WITHOUT the 0x prefix.
  return curve.ethSigToPrivate(ethSignature);
}

/** Derive the Stark public key (x-coordinate) from a private key (hex). */
export function starkKeyOf(privateKeyHex: string): string {
  return curve.getStarkKey(privateKeyHex);
}

/** Stark-curve ECDSA sign. Returns `{ r, s }` as 0x-prefixed hex, matching the API. */
export function starkSign(msgHash: bigint, privateKeyHex: string): { r: string; s: string } {
  const sig = curve.sign('0x' + msgHash.toString(16), privateKeyHex);
  return { r: '0x' + sig.r.toString(16), s: '0x' + sig.s.toString(16) };
}

// ─── Domain + message hashing (SNIP-12 "Perpetuals" domain) ─────────────────────

const MESSAGE_FELT = encodeShortString('StarkNet Message');

const DOMAIN_SELECTOR = selector(
  '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
);

const ORDER_SELECTOR = selector(
  '"Order"("position_id":"felt","base_asset_id":"AssetId","base_amount":"i64","quote_asset_id":"AssetId","quote_amount":"i64","fee_asset_id":"AssetId","fee_amount":"u64","expiration":"Timestamp","salt":"felt")"PositionId"("value":"u32")"AssetId"("value":"felt")"Timestamp"("seconds":"u64")',
);

const WITHDRAWAL_SELECTOR = selector(
  '"WithdrawArgs"("recipient":"ContractAddress","position_id":"PositionId","collateral_id":"AssetId","amount":"u64","expiration":"Timestamp","salt":"felt")"PositionId"("value":"u32")"AssetId"("value":"felt")"Timestamp"("seconds":"u64")',
);

export interface ExtendedStarknetDomain {
  name: string;
  version: string;
  chainId: string;
  revision: number;
}

/** Hash the StarkNet domain separator ("Perpetuals" / "v0" / chainId / revision). */
export function domainHash(domain: ExtendedStarknetDomain): bigint {
  return poseidonHashMany([
    DOMAIN_SELECTOR,
    encodeShortString(domain.name),
    encodeShortString(domain.version),
    encodeShortString(domain.chainId),
    BigInt(domain.revision),
  ]);
}

export interface OrderMessageParams {
  positionId: bigint | number;
  baseAssetId: bigint | string | number;
  baseAmount: bigint; // signed i64, already in Stark units
  quoteAssetId: bigint | string | number;
  quoteAmount: bigint; // signed i64, already in Stark units
  feeAssetId: bigint | string | number;
  feeAmount: bigint; // u64
  expiration: bigint; // settlement expiration in epoch seconds
  salt: bigint; // nonce
}

/** Hash the `Order` struct (SNIP-12 struct hash). */
export function orderHash(params: OrderMessageParams): bigint {
  return poseidonHashMany([
    ORDER_SELECTOR,
    BigInt(params.positionId),
    BigInt(params.baseAssetId),
    toFelt(params.baseAmount),
    BigInt(params.quoteAssetId),
    toFelt(params.quoteAmount),
    BigInt(params.feeAssetId),
    BigInt(params.feeAmount),
    BigInt(params.expiration),
    BigInt(params.salt),
  ]);
}

/**
 * Compute the full off-chain message hash for an order:
 * poseidon("StarkNet Message", domainHash, publicKey, orderHash).
 */
export function orderMessageHash(
  params: OrderMessageParams,
  userPublicKey: bigint | string,
  domain: ExtendedStarknetDomain,
): bigint {
  return poseidonHashMany([
    MESSAGE_FELT,
    domainHash(domain),
    BigInt(userPublicKey),
    orderHash(params),
  ]);
}

export interface WithdrawalMessageParams {
  recipient: bigint | string; // Starknet recipient address (felt)
  positionId: bigint | number;
  collateralId: bigint | string | number;
  amount: bigint; // u64, already in Stark units
  expiration: bigint; // settlement expiration in epoch seconds
  salt: bigint; // nonce
}

/** Hash the `WithdrawArgs` struct (SNIP-12 struct hash) — verified against the Rust reference. */
export function withdrawalArgsHash(params: WithdrawalMessageParams): bigint {
  return poseidonHashMany([
    WITHDRAWAL_SELECTOR,
    BigInt(params.recipient),
    BigInt(params.positionId),
    BigInt(params.collateralId),
    BigInt(params.amount),
    BigInt(params.expiration),
    BigInt(params.salt),
  ]);
}

/**
 * Compute the full off-chain message hash for a withdrawal:
 * poseidon("StarkNet Message", domainHash, publicKey, withdrawalHash).
 */
export function withdrawalMessageHash(
  params: WithdrawalMessageParams,
  userPublicKey: bigint | string,
  domain: ExtendedStarknetDomain,
): bigint {
  return poseidonHashMany([
    MESSAGE_FELT,
    domainHash(domain),
    BigInt(userPublicKey),
    withdrawalArgsHash(params),
  ]);
}
