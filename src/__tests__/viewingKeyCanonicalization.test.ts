/**
 * @file viewingKeyCanonicalization.test.ts
 * @description STRK20 viewing-key canonicalization. The privacy pool accepts only canonical
 * STARK-curve private scalars in `[1, MAX_VIEWING_KEY]` where `MAX_VIEWING_KEY = floor(n/2)`
 * and `n` is the STARK curve order (vendored SDK `interfaces.js` / `validation.js`). A raw
 * Poseidon-derived scalar in `(n/2, n)` is rejected on-chain with `PRIVATE_KEY_NOT_CANONICAL`.
 * The canonical reduction reflects `k -> n - k` (same derived public-key x-coordinate).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ec, hash } from "starknet";
import {
  canonicalizeViewingKey,
  deriveViewingKeyFromSignature,
  loadOrCreateViewingKey,
  readCachedViewingKey,
  writeCachedViewingKey,
} from "../privacy/privy/viewingKeyStore";

const DOMAIN = "PEL_STRK20_VIEWING_KEY_V1";
const domain = hash.starknetKeccak(DOMAIN);
const N = ec.starkCurve.CURVE.n;
const MAX_VIEWING_KEY = N / 2n;

/** Raw (pre-canonicalization) derivation, mirroring deriveViewingKeyFromSignature inputs. */
function rawDerived(r: bigint, s: bigint): bigint {
  const pre = BigInt(hash.computePoseidonHash(r, s));
  return BigInt(hash.computePoseidonHash(pre, domain));
}

function publicKeyX(key: bigint): string {
  return ec.starkCurve.getStarkKey("0x" + key.toString(16));
}

describe("canonicalizeViewingKey", () => {
  it("reflects a derived raw value above the STARK half-order into [1, MAX_VIEWING_KEY]", () => {
    // Deterministic out-of-range signature: raw lands in (n/2, n).
    const r = 1n;
    const s = 2n;
    const raw = rawDerived(r, s);
    expect(raw).toBeGreaterThan(MAX_VIEWING_KEY);
    expect(raw).toBeLessThan(N);

    const canonical = canonicalizeViewingKey(raw);
    expect(canonical).toBe(N - raw);
    expect(canonical).toBeGreaterThanOrEqual(1n);
    expect(canonical).toBeLessThanOrEqual(MAX_VIEWING_KEY);

    // Same on-chain public-key x-coordinate (k and n - k negate y only).
    expect(publicKeyX(canonical)).toBe(publicKeyX(raw));
  });

  it("derives a canonical key from the deterministic signature end-to-end", () => {
    const key = deriveViewingKeyFromSignature(1n, 2n);
    expect(key).toBeGreaterThanOrEqual(1n);
    expect(key).toBeLessThanOrEqual(MAX_VIEWING_KEY);
    expect(key).toBe(N - rawDerived(1n, 2n));
  });

  it("does not alter a raw value already in the canonical range", () => {
    // Deterministic in-range signature.
    const r = 1n;
    const s = 1n;
    const raw = rawDerived(r, s);
    expect(raw).toBeGreaterThanOrEqual(1n);
    expect(raw).toBeLessThanOrEqual(MAX_VIEWING_KEY);

    expect(canonicalizeViewingKey(raw)).toBe(raw);
    expect(deriveViewingKeyFromSignature(r, s)).toBe(raw);
  });

  it("keeps the identity element out of the protocol (maps multiples of n to 1)", () => {
    expect(canonicalizeViewingKey(0n)).toBe(1n);
    expect(canonicalizeViewingKey(N)).toBe(1n);
    expect(canonicalizeViewingKey(2n * N)).toBe(1n);
  });
});

describe("loadOrCreateViewingKey cache migration", () => {
  const USER_ID = "user-cache-migration";
  const WALLET_ID = "wallet-cache-migration";
  const STORAGE_KEY = `pel_privy_viewing_key_v1_${USER_ID}`;

  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal(
      "localStorage",
      {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a stale non-canonical cached key and rewrites the cache", async () => {
    const badKey = N - 12345n; // in (n/2, n) — non-canonical
    await writeCachedViewingKey(USER_ID, badKey);

    const client = { signHash: vi.fn(async () => "0x00") };
    const resolved = await loadOrCreateViewingKey(USER_ID, WALLET_ID, client as never);

    // Signing must not happen again — the cached key is re-derived canonically.
    expect(client.signHash).not.toHaveBeenCalled();
    expect(resolved).toBe(N - badKey);
    expect(resolved).toBeGreaterThanOrEqual(1n);
    expect(resolved).toBeLessThanOrEqual(MAX_VIEWING_KEY);

    // Cache was rewritten with the canonical value.
    const recached = await readCachedViewingKey(USER_ID);
    expect(recached).toBe(N - badKey);
  });

  it("leaves a canonical cached key untouched", async () => {
    const goodKey = 12345n; // in [1, n/2]
    await writeCachedViewingKey(USER_ID, goodKey);

    const client = { signHash: vi.fn(async () => "0x00") };
    const resolved = await loadOrCreateViewingKey(USER_ID, WALLET_ID, client as never);

    expect(client.signHash).not.toHaveBeenCalled();
    expect(resolved).toBe(goodKey);
    const recached = await readCachedViewingKey(USER_ID);
    expect(recached).toBe(goodKey);
  });
});