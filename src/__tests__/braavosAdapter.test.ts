/**
 * @file braavosAdapter.test.ts
 * @description Stage 2 — Braavos account adapter. Verified against the on-chain Braavos ABI
 *   (get_public_key / get_multisig_threshold / is_valid_signature). Import-only, no derivation,
 *   no deployment, fails closed on unsupported configurations.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BraavosAccountAdapter,
  BRAAVOS_ACCOUNT_CONFIG,
  BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA,
  BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA,
  isBraavosAccountSupported,
  isKnownBraavosClass,
} from "../wallet/account";
import { getPublicKey, generateSecretKey, canonicalizeSecret } from "../wallet/crypto";

const ADDRESS = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";
const pubKey = () => getPublicKey(canonicalizeSecret(generateSecretKey()));

describe("Braavos account configuration", () => {
  it("is verified on Sepolia and unsupported on Mainnet", () => {
    expect(BRAAVOS_ACCOUNT_CONFIG.sepolia.supported).toBe(true);
    expect(BRAAVOS_ACCOUNT_CONFIG.sepolia.accountClasses).toContain(BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA);
    expect(BRAAVOS_ACCOUNT_CONFIG.sepolia.accountClasses).toContain(BRAAVOS_BASE_ACCOUNT_CLASSHASH_SEPOLIA);
    expect(BRAAVOS_ACCOUNT_CONFIG.mainnet.supported).toBe(false);
    expect(isBraavosAccountSupported("sepolia")).toBe(true);
    expect(isBraavosAccountSupported("mainnet")).toBe(false);
  });

  it("recognizes the verified Braavos account class", () => {
    expect(isKnownBraavosClass(BRAAVOS_ACCOUNT_CLASSHASH_SEPOLIA, "sepolia")).toBe(true);
    expect(isKnownBraavosClass("0x123", "sepolia")).toBe(false);
  });
});

describe("BraavosAccountAdapter", () => {
  it("is import-only: address is NOT derivable and requires the existing address", () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    expect(adapter.addressDerivable).toBe(false);
    expect(adapter.address.toLowerCase()).toBe(ADDRESS.toLowerCase());
    expect(adapter.publicKey).toMatch(/^0x/);
  });

  it("rejects a malformed address", () => {
    expect(
      () => new BraavosAccountAdapter({ publicKey: pubKey(), address: "not-an-address", network: "sepolia" }),
    ).toThrow(/0x-prefixed hex/);
  });

  it("fails closed on an unsupported network", () => {
    expect(
      () => new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "mainnet" }),
    ).toThrow(/not verified on mainnet/i);
  });

  it("never deploys an imported Braavos account", () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    expect(() => adapter.deploy({} as never)).toThrow(/already-deployed/i);
    expect(() => adapter.waitForFinality({} as never, 0)).toThrow(/not applicable/i);
  });

  it("probeDeployment reports deployed for a nonzero class hash, not_deployed for none, unknown on RPC failure", async () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    expect(await adapter.probeDeployment({ getClassHashAt: async () => "0x123" } as never)).toBe("deployed");
    expect(
      await adapter.probeDeployment({
        getClassHashAt: async () => {
          throw new Error("Requested contract address is not deployed");
        },
      } as never),
    ).toBe("not_deployed");
    expect(
      await adapter.probeDeployment({
        getClassHashAt: async () => {
          throw new Error("502 Bad Gateway");
        },
      } as never),
    ).toBe("unknown");
  });

  it("verifyOwnership fails closed on multisig accounts (threshold > 1)", async () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    const provider = {
      getClassHashAt: async () => "0x123",
      callContract: async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_multisig_threshold") return ["0x2"];
        return ["0x1"];
      },
    } as never;
    const result = await adapter.verifyOwnership({} as never, provider);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/multisig/i);
  });

  it("verifyOwnership succeeds when get_public_key matches the imported key", async () => {
    const pk = pubKey();
    const adapter = new BraavosAccountAdapter({ publicKey: pk, address: ADDRESS, network: "sepolia" });
    const provider = {
      getClassHashAt: async () => "0x123",
      callContract: async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_multisig_threshold") return ["0x1"];
        if (entrypoint === "get_public_key") return ["0x" + BigInt(pk).toString(16)];
        return ["0x0"];
      },
    } as never;
    const result = await adapter.verifyOwnership({} as never, provider);
    expect(result.verified).toBe(true);
    expect(result.method).toBe("braavos-get_public_key");
  });

  it("verifyOwnership rejects when get_public_key does not match the imported key", async () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    const provider = {
      getClassHashAt: async () => "0x123",
      callContract: async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_multisig_threshold") return ["0x1"];
        if (entrypoint === "get_public_key") return ["0x1"];
        return ["0x0"];
      },
    } as never;
    const result = await adapter.verifyOwnership({} as never, provider);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/does not match the imported key/i);
  });

  it("verifyOwnership falls back to SRC-5 when the view entrypoints are absent", async () => {
    const adapter = new BraavosAccountAdapter({ publicKey: pubKey(), address: ADDRESS, network: "sepolia" });
    const provider = {
      getClassHashAt: async () => "0x123",
      callContract: vi.fn(async () => {
        throw new Error("Entrypoint not found");
      }),
    } as never;
    const result = await adapter.verifyOwnership({} as never, provider);
    // View calls reverted → SRC-5 fallback attempted → without a real account it cannot verify.
    expect(result.method).toBe("braavos-is_valid_signature");
    expect(result.verified).toBe(false);
  });
});