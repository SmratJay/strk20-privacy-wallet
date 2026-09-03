/**
 * @file privateIdentity.test.ts
 * @description Stage 2 — PrivateIdentity (REAL STRK20 shadow-account model): deterministic SDK
 *   commitment + shadow address, appName/nonce semantics, no viewing-key leakage, retire
 *   lifecycle, dedupe by (owner, chain, appName, nonce), tamper-consistency validation.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createPrivateIdentity,
  retirePrivateIdentity,
  listPrivateIdentities,
  findPrivateIdentity,
  deriveShadowIdentity,
  validatePrivateIdentity,
  normalizeAppName,
  validateShadowNonce,
  createMemoryPrivateIdentityStorage,
  createBrowserPrivateIdentityStorage,
  PRIVATE_IDENTITY_STORE_PREFIX,
  type PrivateIdentity,
  type PrivateIdentityStorage,
} from "../privacy/identity";
import { shadowAddressFromCommitment } from "../privacy/strk20";

const OWNER = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";
const OTHER_OWNER = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";
const VIEWING_KEY = 12345678901234567890n;
const ANONYMIZER = "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const memoryStorage = () => createMemoryPrivateIdentityStorage();

function identityKey(chain: string, owner: string): string {
  return `${PRIVATE_IDENTITY_STORE_PREFIX}_${chain}_${owner.toLowerCase()}`;
}

describe("shadow identity derivation", () => {
  it("is deterministic for the same owner + appName + nonce (verified via the SDK)", async () => {
    const a = await deriveShadowIdentity({
      owner: OWNER,
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
      appName: "orrange",
      nonce: 0n,
    });
    const b = await deriveShadowIdentity({
      owner: OWNER,
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
      appName: "orrange",
      nonce: 0n,
    });
    expect(a.partialCommitment).toBe(b.partialCommitment);
    expect(a.commitment).toBe(b.commitment);
    expect(a.shadowAddress).toBe(b.shadowAddress);
    expect(BigInt(a.commitment)).toBeGreaterThan(0n);
  });

  it("a NEW nonce yields a NEW commitment + shadow address (fresh, unlinkable identity)", async () => {
    const base = { owner: OWNER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL, appName: "orrange" } as const;
    const n0 = await deriveShadowIdentity({ ...base, nonce: 0n });
    const n1 = await deriveShadowIdentity({ ...base, nonce: 1n });
    expect(n0.commitment).not.toBe(n1.commitment);
    expect(n0.shadowAddress).not.toBe(n1.shadowAddress);
  });

  it("a different appName yields a different shadow identity", async () => {
    const base = { owner: OWNER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL, nonce: 0n } as const;
    const a = await deriveShadowIdentity({ ...base, appName: "orrange" });
    const b = await deriveShadowIdentity({ ...base, appName: "other-dapp" });
    expect(a.commitment).not.toBe(b.commitment);
  });

  it("changes when the viewing key changes (identity is keyed by the viewing key)", async () => {
    const base = { owner: OWNER, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL, appName: "orrange", nonce: 0n } as const;
    const a = await deriveShadowIdentity({ ...base, viewingKey: 1n });
    const b = await deriveShadowIdentity({ ...base, viewingKey: 2n });
    expect(a.partialCommitment).not.toBe(b.partialCommitment);
  });

  it("the shadow address is consistent with the commitment + anonymizer", async () => {
    const d = await deriveShadowIdentity({
      owner: OWNER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL, appName: "orrange", nonce: 0n,
    });
    expect(d.shadowAddress).toBe(
      shadowAddressFromCommitment(BigInt(d.commitment), BigInt(ANONYMIZER)),
    );
  });
});

describe("appName / nonce validation", () => {
  it("rejects an empty or over-long appName", () => {
    expect(() => normalizeAppName("")).toThrow(/required/);
    expect(() => normalizeAppName("x".repeat(32))).toThrow(/short string/);
  });

  it("accepts a valid Cairo short string appName", () => {
    expect(normalizeAppName("  orrange  ")).toBe("orrange");
  });

  it("rejects a negative nonce", () => {
    expect(() => validateShadowNonce(-1n)).toThrow(/non-negative/);
    expect(validateShadowNonce(0n)).toBe(0n);
    expect(validateShadowNonce(7n)).toBe(7n);
  });
});

describe("identity record", () => {
  it("persists only PUBLIC values — never the viewing key", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER,
      chain: "sepolia",
      appName: "orrange",
      nonce: 0n,
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    expect(identity.commitment).toBe(identity.id);
    const raw = storage.getItem(identityKey("sepolia", OWNER)) ?? "";
    expect(raw).not.toContain(VIEWING_KEY.toString());
    expect(raw).not.toContain("viewingKey");
    expect(raw).not.toContain("secret");
    expect(validatePrivateIdentity(identity)).toBeNull();
  });

  it("stores appName, nonce, commitment and shadowAddress", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER, chain: "sepolia", appName: "orrange", nonce: 3n,
      viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL,
    }, storage);
    expect(identity.appName).toBe("orrange");
    expect(BigInt(identity.nonce)).toBe(3n);
    expect(identity.shadowAddress).toMatch(/^0x/);
    expect(BigInt(identity.shadowAddress)).toBeGreaterThan(0n);
  });

  it("dedupes by (owner, chain, appName, nonce); a new nonce is a NEW identity", async () => {
    const storage = memoryStorage();
    const base = { owner: OWNER, chain: "sepolia", viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL, appName: "orrange" } as const;
    const n0a = await createPrivateIdentity({ ...base, nonce: 0n }, storage);
    const n0b = await createPrivateIdentity({ ...base, nonce: 0n }, storage); // replaces
    const n1 = await createPrivateIdentity({ ...base, nonce: 1n }, storage);
    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(2);
    expect(listPrivateIdentities(storage, "sepolia", OWNER).filter((i) => BigInt(i.nonce) === 0n)).toHaveLength(1);
    expect(n0b.shadowAddress).not.toBe(n1.shadowAddress);
    void n0a;
  });

  it("findPrivateIdentity resolves by (appName, nonce); null when absent", async () => {
    const storage = memoryStorage();
    await createPrivateIdentity({
      owner: OWNER, chain: "sepolia", appName: "orrange", nonce: 0n,
      viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL,
    }, storage);
    expect(findPrivateIdentity(storage, "sepolia", OWNER, "orrange", 0n)?.appName).toBe("orrange");
    expect(findPrivateIdentity(storage, "sepolia", OWNER, "orrange", 9n)).toBeNull();
  });

  it("is wallet + network scoped (no cross-wallet / cross-network reuse)", async () => {
    const storage = memoryStorage();
    await createPrivateIdentity({
      owner: OWNER, chain: "sepolia", appName: "orrange", nonce: 0n,
      viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL,
    }, storage);
    // Different owner on the same chain, and same owner on a different chain → nothing.
    expect(listPrivateIdentities(storage, "sepolia", OTHER_OWNER)).toHaveLength(0);
    expect(listPrivateIdentities(storage, "mainnet", OWNER)).toHaveLength(0);
  });

  it("retire changes status but never the on-chain shadow identity", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER, chain: "sepolia", appName: "orrange", nonce: 0n,
      viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL,
    }, storage);
    const retired = retirePrivateIdentity(storage, "sepolia", OWNER, identity.id);
    expect(retired.status).toBe("retired");
    expect(retired.commitment).toBe(identity.commitment);
    expect(retired.shadowAddress).toBe(identity.shadowAddress);
  });
});

describe("record validation (tamper-consistency)", () => {
  it("rejects a tampered shadowAddress that does not match commitment + anonymizer", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER, chain: "sepolia", appName: "orrange", nonce: 0n,
      viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, poolContractAddress: POOL,
    }, storage);
    const tampered: PrivateIdentity = { ...identity, shadowAddress: "0x1" };
    expect(validatePrivateIdentity(tampered)).toMatch(/shadowAddress/);
  });

  it("rejects a record carrying secret material", () => {
    const storage = memoryStorage();
    const record = {
      id: "0x1", owner: OWNER, chain: "sepolia", appName: "orrange", nonce: "0x0",
      anonymizerAddress: ANONYMIZER, partialCommitment: "0x2", commitment: "0x1",
      shadowAddress: "0x3", status: "active", createdAt: 1, viewingKey: "0xdeadbeef",
    } as unknown as PrivateIdentity;
    expect(validatePrivateIdentity(record)).toMatch(/viewingKey/);
    void storage;
  });

  it("rejects a malformed record", () => {
    expect(validatePrivateIdentity(null)).toBe("record is not an object");
    expect(validatePrivateIdentity({})).toMatch(/missing field/);
  });
});

describe("browser storage helper", () => {
  it("is safe when localStorage is unavailable", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
    const storage = createBrowserPrivateIdentityStorage();
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBeNull();
    storage.removeItem("k");
    if (original !== undefined) Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });
});

void vi;