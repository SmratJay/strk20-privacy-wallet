/**
 * @file walletRegistry.test.ts
 * @description Stage 2 — multi-wallet storage registry: walletId+network scoping, coexistence,
 *   legacy migration, per-wallet removal (never clobbering another wallet).
 */

import { describe, it, expect } from "vitest";
import {
  createMemoryStorage,
  walletIdFor,
  scopedWalletIdFor,
  readWalletRegistry,
  readWalletKeystore,
  writeWalletKeystore,
  upsertWalletRegistryEntry,
  removeWalletRegistryEntry,
  clearWalletById,
  migrateLegacyWallet,
  writePublicState,
  writeKeystore,
  type WalletRegistryEntry,
} from "../wallet/storage";
import { createWallet, importWallet, generateSecretKey, canonicalizeSecret } from "../wallet/index";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";

const PASSWORD = "correct horse battery staple";

const provider = {
  getClassHashAt: async () => READY_SEPOLIA_CLASS_HASH,
  callContract: async () => ["0x56614c4944"],
  getBlockNumber: async () => 1,
  waitForTransaction: async () => ({}),
} as never;

function entry(over: Partial<WalletRegistryEntry> = {}): WalletRegistryEntry {
  return {
    walletId: "0x1",
    accountType: "ready-v0.4.0",
    address: "0x1",
    publicKey: "0x2",
    network: "sepolia",
    deploymentStatus: "unknown",
    createdAt: 1,
    source: "created",
    ...over,
  };
}

describe("wallet identity", () => {
  it("normalizes addresses to a canonical wallet id", () => {
    expect(walletIdFor("0x0abc")).toBe("0xabc");
    expect(walletIdFor("0X0000ABC")).toBe("0xabc");
  });
});

describe("registry scoping", () => {
  it("stores entries per network and never overwrites another wallet", () => {
    const storage = createMemoryStorage();
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xaaa", address: "0xaaa" }));
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xbbb", address: "0xbbb" }));
    upsertWalletRegistryEntry(storage, "mainnet", entry({ walletId: "0xaaa", address: "0xaaa" }));

    const sepolia = readWalletRegistry(storage, "sepolia");
    const mainnet = readWalletRegistry(storage, "mainnet");
    expect(sepolia).toHaveLength(2);
    expect(mainnet).toHaveLength(1);
    // Updating an existing wallet id replaces in place, never duplicates.
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xaaa", address: "0xaaa", deploymentStatus: "deployed" }));
    expect(readWalletRegistry(storage, "sepolia")).toHaveLength(2);
  });

  it("removeWalletRegistryEntry only removes the target wallet", () => {
    const storage = createMemoryStorage();
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xaaa" }));
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xbbb" }));
    removeWalletRegistryEntry(storage, "sepolia", "0xaaa");
    const remaining = readWalletRegistry(storage, "sepolia");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].walletId).toBe("0xbbb");
  });

  it("clearWalletById removes entry + keystore without touching other wallets", () => {
    const storage = createMemoryStorage();
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xaaa" }));
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId: "0xbbb" }));
    storage.setItem("orrange_wallet_v2_keystore_sepolia_0xaaa", "{}");
    storage.setItem("orrange_wallet_v2_keystore_sepolia_0xbbb", "{}");

    clearWalletById(storage, "sepolia", "0xaaa");

    expect(readWalletRegistry(storage, "sepolia")).toHaveLength(1);
    expect(readWalletKeystore(storage, "sepolia", "0xaaa")).toBeNull();
    expect(readWalletKeystore(storage, "sepolia", "0xbbb")).not.toBeNull();
  });

  it("same walletId on two networks produces independent keystore records", () => {
    const storage = createMemoryStorage();
    const walletId = walletIdFor("0xabc");
    // Identical account address on two networks → identical walletId, but isolated keystores.
    writeWalletKeystore(storage, "sepolia", walletId, '{"network":"sepolia"}');
    writeWalletKeystore(storage, "mainnet", walletId, '{"network":"mainnet"}');

    expect(readWalletKeystore(storage, "sepolia", walletId)).toBe('{"network":"sepolia"}');
    expect(readWalletKeystore(storage, "mainnet", walletId)).toBe('{"network":"mainnet"}');
    // Cross-network reads never leak into each other.
    expect(storage.getItem("orrange_wallet_v2_keystore_sepolia_" + walletId)).not.toBe(
      storage.getItem("orrange_wallet_v2_keystore_mainnet_" + walletId),
    );
  });

  it("clearing one network's wallet leaves the other network's wallet untouched", () => {
    const storage = createMemoryStorage();
    const walletId = walletIdFor("0xabc");
    writeWalletKeystore(storage, "sepolia", walletId, '{"network":"sepolia"}');
    writeWalletKeystore(storage, "mainnet", walletId, '{"network":"mainnet"}');
    upsertWalletRegistryEntry(storage, "sepolia", entry({ walletId, network: "sepolia" }));
    upsertWalletRegistryEntry(storage, "mainnet", entry({ walletId, network: "mainnet" }));

    clearWalletById(storage, "sepolia", walletId);

    expect(readWalletKeystore(storage, "sepolia", walletId)).toBeNull();
    expect(readWalletKeystore(storage, "mainnet", walletId)).not.toBeNull();
    expect(readWalletRegistry(storage, "mainnet")).toHaveLength(1);
  });
});

describe("legacy migration", () => {
  it("migrates a Stage 1 wallet into the registry once, preserving its keystore", () => {
    const storage = createMemoryStorage();
    writePublicState(storage, "sepolia", {
      accountType: "ready-v0.4.0",
      address: "0xabc",
      publicKey: "0xdef",
      network: "sepolia",
      deploymentStatus: "unknown",
      createdAt: 123,
    });
    writeKeystore(storage, "sepolia", '{"version":1}');

    const migrated = migrateLegacyWallet(storage, "sepolia");
    expect(migrated).not.toBeNull();
    expect(migrated?.walletId).toBe(walletIdFor("0xabc"));
    expect(readWalletRegistry(storage, "sepolia")).toHaveLength(1);
    // The legacy keystore was copied to the network-scoped walletId keystore.
    expect(readWalletKeystore(storage, "sepolia", walletIdFor("0xabc"))).toBe('{"version":1}');
    // Migration is idempotent.
    expect(migrateLegacyWallet(storage, "sepolia")).not.toBeNull();
    expect(readWalletRegistry(storage, "sepolia")).toHaveLength(1);
  });
});

describe("create/import registry integration", () => {
  it("createWallet and importWallet each register a distinct wallet", async () => {
    const storage = createMemoryStorage();
    const created = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const imported = (
      await importWallet({
        network: "sepolia",
        accountType: "ready-v0.4.0",
        secret: canonicalizeSecret(generateSecretKey()),
        password: PASSWORD,
        storage,
        provider,
      })
    ).wallet;

    expect(created.walletId).not.toBe(imported.walletId);
    expect(readWalletRegistry(storage, "sepolia")).toHaveLength(2);
    expect(readWalletKeystore(storage, "sepolia", created.walletId)).not.toBeNull();
    expect(readWalletKeystore(storage, "sepolia", imported.walletId)).not.toBeNull();
  });
});