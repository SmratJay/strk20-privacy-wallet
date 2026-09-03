/**
 * @file privateIdentity.test.ts
 * @description Stage 2 — PrivateIdentity wallet primitive: deterministic SDK commitment, no
 *   viewing-key leakage, retire lifecycle, dedupe by (owner, purpose).
 */

import { describe, it, expect } from "vitest";
import {
  createPrivateIdentity,
  retirePrivateIdentity,
  listPrivateIdentities,
  derivePrivateIdentityCommitments,
  privateIdentityId,
  normalizePurpose,
  type PrivateIdentityStorage,
} from "../privacy/identity";

const OWNER = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";
const VIEWING_KEY = 12345678901234567890n;
const ANONYMIZER = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

function memoryStorage(): PrivateIdentityStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
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
    const a = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: VIEWING_KEY,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    });
    const b = await createPrivateIdentity({
      owner: OWNER,
      purpose: "treasury",
      chain: "sepolia",
      viewingKey: 999n,
      anonymizerAddress: ANONYMIZER,
      poolContractAddress: POOL,
    });
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