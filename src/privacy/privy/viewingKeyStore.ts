import { ec, hash } from "starknet";
import type { PrivySigningClient } from "./types";
import { normalizePrivySignature } from "./signing";

const DOMAIN = "PEL_STRK20_VIEWING_KEY_V1";
const STORE_PREFIX = "pel_privy_viewing_key_v1";

function storageKey(userId: string): string {
  return `${STORE_PREFIX}_${userId.toLowerCase()}`;
}

export function viewingKeyChallenge(): string {
  return "0x" + hash.starknetKeccak(DOMAIN).toString(16);
}

/**
 * Canonicalize a STRK20 viewing key to the scalar range accepted by the privacy pool.
 *
 * The pool requires a canonical STARK-curve private scalar: `1 <= k <= MAX_VIEWING_KEY`, where
 * `MAX_VIEWING_KEY = floor(n / 2)` and `n` is the STARK curve order (vendored SDK
 * `interfaces.js`: `MAX_VIEWING_KEY = ec.starkCurve.CURVE.n / 2n`; `validation.js`
 * `assertViewingKey` enforces `[1, MAX_VIEWING_KEY]`). A key in the upper half `(n/2, n)` is
 * rejected on-chain with `PRIVATE_KEY_NOT_CANONICAL`.
 *
 * A Poseidon hash output is a field element in `[0, p)` with `p ≈ n`, so ~half of all derived
 * keys land above `n/2`. The canonical reduction is `k' = n - k` when `k > n/2`: because the
 * curve is symmetric about the x-axis, `k` and `n - k` derive the SAME public-key x-coordinate,
 * so the on-chain identity is unchanged while the scalar becomes acceptable. `0` (a multiple of
 * `n`) maps to `1`. The derivation inputs are untouched, so the same signature still yields the
 * same (now canonical) key on every device.
 */
export function canonicalizeViewingKey(k: bigint): bigint {
  const n = ec.starkCurve.CURVE.n;
  const max = n / 2n;
  let key = k % n;
  if (key === 0n) key = 1n;
  if (key > max) key = n - key;
  return key;
}

export function deriveViewingKeyFromSignature(r: string | bigint, s: string | bigint): bigint {
  const pre = BigInt(hash.computePoseidonHash(BigInt(r), BigInt(s)));
  const domain = hash.starknetKeccak(DOMAIN);
  const k = BigInt(hash.computePoseidonHash(pre, domain));
  return canonicalizeViewingKey(k);
}

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("VIEWING_KEY: WebCrypto unavailable; cannot persist viewing key.");
  }
  return crypto.subtle;
}

async function deriveKey(userId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await subtle().digest("SHA-256", enc.encode(`${DOMAIN}:${userId.toLowerCase()}`));
  return subtle().importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function cacheAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

export async function readCachedViewingKey(userId: string): Promise<bigint | null> {
  if (!cacheAvailable()) return null;
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw) as { encrypted?: boolean; iv?: string; ciphertext?: string };
    if (!outer.encrypted || !outer.iv || !outer.ciphertext) return null;
    const key = await deriveKey(userId);
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(outer.iv) }, key, fromB64(outer.ciphertext));
    return BigInt(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function writeCachedViewingKey(userId: string, viewingKey: bigint): Promise<void> {
  if (!cacheAvailable()) return;
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(viewingKey.toString()),
  );
  localStorage.setItem(
    storageKey(userId),
    JSON.stringify({ encrypted: true, iv: toB64(iv), ciphertext: toB64(ciphertext) }),
  );
}

/**
 * Resolve the user's STRK20 viewing key. Deterministic and recoverable across devices:
 * it is derived from a Privy `rawSign` over a fixed challenge, so re-login reproduces the
 * same scalar. The derived scalar is cached (AES-GCM) to avoid re-signing each session.
 */
export async function loadOrCreateViewingKey(
  userId: string,
  walletId: string,
  client: PrivySigningClient,
): Promise<bigint> {
  const cached = await readCachedViewingKey(userId);
  if (cached !== null) {
    // Canonicalize on read too: a stale non-canonical key could have been cached before
    // canonicalization existed. Reflection preserves the derived public-key x-coordinate and
    // the pool rejects non-canonical keys at registration, so such an account has no on-chain
    // state yet — rewriting the cache is safe. In-range (canonical) keys are returned unchanged.
    const canonical = canonicalizeViewingKey(cached);
    if (canonical !== cached) {
      await writeCachedViewingKey(userId, canonical);
    }
    return canonical;
  }

  const challenge = viewingKeyChallenge();
  const raw = await client.signHash(walletId, challenge);
  const [r, s] = normalizePrivySignature(raw);
  const viewingKey = deriveViewingKeyFromSignature(r, s);

  await writeCachedViewingKey(userId, viewingKey);
  return viewingKey;
}
