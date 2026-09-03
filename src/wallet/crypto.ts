import { ec } from "starknet";

/**
 * Wallet Core — key management.
 *
 * Self-custodial Starknet key primitives. The signing secret is generated locally with the
 * STARK curve (via starknet.js / @scure/starknet) and NEVER leaves the wallet core except as an
 * explicit user-initiated export (see `walletCore.exportSecret`). Nothing here touches Privy,
 * any API route, or localStorage.
 */

/** STARK curve order `n`. A canonical private key must be in `[1, n)`. */
const CURVE_ORDER = ec.starkCurve.CURVE.n;

/** Upper bound for a canonical key (`floor(n / 2)`). Mirrors the STRK20 viewing-key rule. */
export const MAX_SECRET = CURVE_ORDER / 2n;

/**
 * Generate a new random STARK signing key.
 *
 * Uses the curve's CSPRNG (`@scure/starknet` → `@noble/curves` `randomPrivateKey`). Returns a
 * normalized `0x`-prefixed hex scalar in the canonical range `[1, n/2]`. Re-rolls on the
 * astronomically-unlikely non-canonical draw rather than returning a key the account contract
 * would reject.
 */
export function generateSecretKey(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const raw = ec.starkCurve.utils.randomPrivateKey();
    const secret = toHexString(raw);
    try {
      return canonicalizeSecret(secret);
    } catch {
      // Non-canonical draw; re-roll.
    }
  }
  throw new Error("Could not generate a canonical STARK signing key.");
}

/**
 * Canonicalize a secret to `[1, n/2]` (the STARK-curve scalar range accepted by account
 * contracts). A scalar in the upper half `(n/2, n)` reflects to `n - k`, which derives the SAME
 * public-key x-coordinate (the curve is symmetric about the x-axis). `0` maps to `1`.
 *
 * Throws when the input is not a valid scalar (< n).
 */
export function canonicalizeSecret(secret: string): string {
  const scalar = parseSecret(secret);
  let key = scalar % CURVE_ORDER;
  if (key === 0n) key = 1n;
  if (key > MAX_SECRET) key = CURVE_ORDER - key;
  return "0x" + key.toString(16);
}

/** Parse a `0x`/decimal secret into a BigInt scalar, validating the hex shape. Throws if invalid. */
export function parseSecret(secret: string): bigint {
  const raw = String(secret);
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new Error("Signing secret must be a 0x-prefixed hex scalar.");
  }
  const scalar = BigInt(raw);
  if (scalar <= 0n) throw new Error("Signing secret must be positive.");
  if (scalar >= CURVE_ORDER) throw new Error("Signing secret must be below the STARK curve order.");
  return scalar;
}

/** Derive the STARK public key (x-coordinate) for a secret. Deterministic. */
export function getPublicKey(secret: string): string {
  return normalizeHex(ec.starkCurve.getStarkKey("0x" + parseSecret(secret).toString(16)));
}

/**
 * Verify a signature over a message hash against an x-coordinate public key — the same
 * relationship the account contract checks on-chain (`get_stark_key` recovers the signer from
 * the signature and compares the x-coordinate to the stored owner). Tries both recovery bits.
 */
export function verifySignature(
  msgHash: string,
  signature: [string, string] | string[],
  publicKey: string,
): boolean {
  const sig = new ec.starkCurve.Signature(BigInt(signature[0]), BigInt(signature[1]));
  const expected = normalizeHex(publicKey);
  // Key recovery requires a left-padded 32-byte message hash WITHOUT the 0x prefix.
  const padded = msgHash.replace(/^0x/i, "").padStart(64, "0");
  for (const recovery of [0, 1] as const) {
    try {
      const point = sig.addRecoveryBit(recovery).recoverPublicKey(padded);
      const x = "0x" + point.toAffine().x.toString(16);
      if (normalizeHex(x) === expected) return true;
    } catch {
      // Invalid for this recovery bit; try the other.
    }
  }
  return false;
}

function toHexString(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return "0x" + out;
}

export function normalizeHex(value: string): string {
  return /^0x/i.test(value) ? value.toLowerCase() : "0x" + BigInt(value).toString(16);
}