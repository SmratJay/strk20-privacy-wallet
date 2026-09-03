/**
 * @file privateIdentity.test.ts
 * @description Stage 2 — PrivateIdentity wallet primitive: deterministic SDK commitment, no
 *   viewing-key leakage, retire lifecycle, dedupe by (owner, purpose).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createPrivateIdentity,
  retirePrivateIdentity,
  listPrivateIdentities,
  derivePrivateIdentityCommitments,
  privateIdentityId,
  normalizePurpose,
  validatePrivateIdentity,
  createMemoryPrivateIdentityStorage,
  createBrowserPrivateIdentityStorage,
  PRIVATE_IDENTITY_STORE_PREFIX,
  type PrivateIdentity,
  type PrivateIdentityStorage,
} from "../privacy/identity";

const OWNER = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";
const OTHER_OWNER = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";
const VIEWING_KEY = 12345678901234567890n;
const ANONYMIZER = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

const memoryStorage = () => createMemoryPrivateIdentityStorage();

function identityKey(chain: string, owner: string): string {
  return `${PRIVATE_IDENTITY_STORE_PREFIX}_${chain}_${owner.toLowerCase()}`;
}

describe("identity derivation", () => {
  it("is deterministic for the same inputs (verified against the SDK)", async () => {
    const a = await derivePrivateIdentityCommitments({
      owner: OWNER,
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
      dappName: "orrange",
    });
    const b = await derivePrivateIdentityCommitments({
      owner: OWNER,
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
      dappName: "orrange",
    });
    expect(a.partialCommitment).toBe(b.partialCommitment);
    expect(a.commitmentNonce0).toBe(b.commitmentNonce0);
    expect(BigInt(a.partialCommitment)).toBeGreaterThan(0n);
  });

  it("changes when the viewing key changes (identity is keyed by the viewing key)", async () => {
    const a = await derivePrivateIdentityCommitments({
      owner: OWNER,
      viewingKey: 1n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    });
    const b = await derivePrivateIdentityCommitments({
      owner: OWNER,
      viewingKey: 2n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    });
    expect(a.partialCommitment).not.toBe(b.partialCommitment);
  });
});

describe("identity record", () => {
  it("persists only PUBLIC commitment values — never the viewing key", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
      dappName: "orrange",
    }, storage);

    expect(identity.status).toBe("active");
    expect(identity.partialCommitment).toMatch(/^\d+$/);
    expect(identity.commitmentNonce0).toMatch(/^\d+$/);

    // Serialized record must not contain the viewing key in any form.
    const raw = JSON.stringify(listPrivateIdentities(storage, "sepolia", OWNER));
    expect(raw).not.toContain(String(VIEWING_KEY));
    expect(raw).not.toContain("viewingKey");
  });

  it("has a stable public id independent of the viewing key", async () => {
    const storage = memoryStorage();
    const a = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    const b = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: 999n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    // Same (owner, purpose) → same id; creation dedupes (only the latest is kept).
    expect(a.id).toBe(b.id);
    expect(privateIdentityId(OWNER, "treasury")).toBe(a.id);
  });

  it("can be retired", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER,
      purpose: "launchpad",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);

    const retired = retirePrivateIdentity(storage, "sepolia", OWNER, identity.id);
    expect(retired.status).toBe("retired");
    expect(listPrivateIdentities(storage, "sepolia", OWNER)[0].status).toBe("retired");
  });

  it("normalizes and validates purpose", () => {
    expect(normalizePurpose("  Treasury  ")).toBe("treasury");
    expect(() => normalizePurpose("")).toThrow(/required/i);
    expect(() => normalizePurpose("x".repeat(65))).toThrow(/too long/i);
  });
});

describe("persistent identity storage (FIX 2)", () => {
  it("identity survives a fresh storage instance backed by the same store", async () => {
    const backing = new Map<string, string>();
    const storageA = createMemoryPrivateIdentityStorage(backing);
    const identity = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storageA);

    // Simulate a page reload: a brand-new storage instance over the same backing store.
    const storageB = createMemoryPrivateIdentityStorage(backing);
    const reloaded = listPrivateIdentities(storageB, "sepolia", OWNER);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(identity.id);
    expect(reloaded[0].commitmentNonce0).toBe(identity.commitmentNonce0);
  });

  it("createBrowserPrivateIdentityStorage persists across instances via localStorage", async () => {
    const fakeLocalStorage = memoryStorage();
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    vi.stubGlobal("localStorage", fakeLocalStorage);
    try {
      const storageA = createBrowserPrivateIdentityStorage();
      const identity = await createPrivateIdentity({
        owner: OWNER,
        purpose: "launchpad",
        chain: "sepolia",
        viewingKey: VIEWING_KEY,
        anonymizerAddress: ANONYMIZER,
        poolContractAddress: POOL,
      }, storageA);

      const storageB = createBrowserPrivateIdentityStorage();
      const reloaded = listPrivateIdentities(storageB, "sepolia", OWNER);
      expect(reloaded.map((i) => i.id)).toContain(identity.id);
    } finally {
      vi.unstubAllGlobals();
      void original;
    }
  });

  it("different wallets do not share an identity namespace", async () => {
    const storage = memoryStorage();
    await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    await createPrivateIdentity({
      owner: OTHER_OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);

    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(1);
    expect(listPrivateIdentities(storage, "sepolia", OTHER_OWNER)).toHaveLength(1);
    // The two owners live under distinct storage keys.
    expect(identityKey("sepolia", OWNER)).not.toBe(identityKey("sepolia", OTHER_OWNER));
  });
});

describe("identity record integrity (optional hardening)", () => {
  function validRecord(over: Record<string, unknown> = {}): PrivateIdentity {
    return {
      id: privateIdentityId(OWNER, "treasury"),
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      partialCommitment: "1",
      commitmentNonce0: "2",
      status: "active",
      createdAt: 123,
      ...over,
    };
  }

  it("rejects stored records that carry a viewingKey field", async () => {
    const storage = memoryStorage();
    storage.setItem(
      identityKey("sepolia", OWNER),
      JSON.stringify([{ ...validRecord(), viewingKey: "0xdeadbeef" }]),
    );
    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(0);
  });

  it("rejects stored records whose id does not match owner + purpose", async () => {
    const storage = memoryStorage();
    storage.setItem(identityKey("sepolia", OWNER), JSON.stringify([{ ...validRecord(), id: "0x0" }]));
    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(0);
  });

  it("validatePrivateIdentity accepts a well-formed record and explains failures", () => {
    expect(validatePrivateIdentity(validRecord())).toBeNull();
    expect(validatePrivateIdentity(validRecord({ viewingKey: "0x1" }))).toMatch(/viewingKey/i);
    expect(validatePrivateIdentity(validRecord({ status: "bogus" }))).toMatch(/status/i);
    expect(validatePrivateIdentity(null)).toMatch(/not an object/);
  });

  it("drops a record whose owner does not match the query namespace (FIX 4)", async () => {
    const storage = memoryStorage();
    // A record that belongs to OTHER_OWNER sits under OWNER's storage key (tampered/corrupt).
    storage.setItem(
      identityKey("sepolia", OWNER),
      JSON.stringify([
        {
          id: privateIdentityId(OTHER_OWNER, "treasury"),
          owner: OTHER_OWNER,
          purpose: "treasury",
          chain: "sepolia",
          partialCommitment: "1",
          commitmentNonce0: "2",
          status: "active",
          createdAt: 1,
        },
      ]),
    );
    // It must not be surfaced under OWNER's namespace (owner ≠ query owner).
    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(0);
    // It is also not reachable under OTHER_OWNER's namespace (it was stored in the wrong key).
    expect(listPrivateIdentities(storage, "sepolia", OTHER_OWNER)).toHaveLength(0);
  });

  it("drops a record whose chain does not match the query chain (FIX 4)", async () => {
    const storage = memoryStorage();
    storage.setItem(
      identityKey("sepolia", OWNER),
      JSON.stringify([
        {
          id: privateIdentityId(OWNER, "treasury"),
          owner: OWNER,
          purpose: "treasury",
          chain: "mainnet",
          partialCommitment: "1",
          commitmentNonce0: "2",
          status: "active",
          createdAt: 1,
        },
      ]),
    );
    expect(listPrivateIdentities(storage, "sepolia", OWNER)).toHaveLength(0);
  });

  it("accepts a valid owner + chain record (FIX 4)", async () => {
    const storage = memoryStorage();
    storage.setItem(
      identityKey("sepolia", OWNER),
      JSON.stringify([validRecord()]),
    );
    const listed = listPrivateIdentities(storage, "sepolia", OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(privateIdentityId(OWNER, "treasury"));
  });
});

describe("identity dedupe semantics (FIX 5)", () => {
  it("re-creating (owner, purpose) replaces the record; commitment reflects the latest viewing key", async () => {
    const storage = memoryStorage();
    const first = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: 1n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    const second = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: 2n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);

    const listed = listPrivateIdentities(storage, "sepolia", OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(first.id);
    // The commitment is re-derived from the newest viewing key — no stale record remains.
    expect(listed[0].commitmentNonce0).toBe(second.commitmentNonce0);
    expect(listed[0].commitmentNonce0).not.toBe(first.commitmentNonce0);
  });

  it("a retired identity is cleanly replaced (no ambiguous duplicates) on re-create", async () => {
    const storage = memoryStorage();
    const identity = await createPrivateIdentity({
      owner: OWNER,
      purpose: "launchpad",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);
    retirePrivateIdentity(storage, "sepolia", OWNER, identity.id);

    const recreated = await createPrivateIdentity({
      owner: OWNER,
      purpose: "launchpad",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    }, storage);

    const listed = listPrivateIdentities(storage, "sepolia", OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("active");
    expect(listed[0].id).toBe(recreated.id);
  });
});