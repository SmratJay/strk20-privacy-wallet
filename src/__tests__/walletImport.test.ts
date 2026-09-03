/**
 * @file walletImport.test.ts
 * @description Stage 2 — import existing Ready/Braavos wallets into Wallet Core: ownership
 *   verification, address preservation, keystore persistence (no plaintext), lock/unlock
 *   recovery, multi-wallet coexistence, and STRK20 signer consumption.
 */

import { describe, it, expect, vi } from "vitest";
import { canonicalizeSecret, generateSecretKey, getPublicKey } from "../wallet/crypto";
import { createMemoryStorage, readWalletKeystore, readWalletRegistry, walletIdFor } from "../wallet/storage";
import {
  createWallet,
  importWallet,
  listWallets,
  lockWallet,
  unlockWallet,
  READY_SEPOLIA_CLASS_HASH,
} from "../wallet/index";
import { buildStrk20User } from "../privacy/identity";
import type { PrivyStrk20User } from "../privacy/adapter";

const PASSWORD = "correct horse battery staple";
const VALID_SRC5 = ["0x56614c4944"]; // SRC-5 VALID

function mockProvider(opts: {
  classHashAt?: () => Promise<string>;
  callContract?: (call?: any) => Promise<string[]>;
} = {}) {
  return {
    getClassHashAt: vi.fn(opts.classHashAt ?? (async () => READY_SEPOLIA_CLASS_HASH)),
    callContract: vi.fn(opts.callContract ?? (async () => VALID_SRC5)),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(),
  } as never;
}

describe("Ready import", () => {
  it("imports a valid key + existing deployed account, preserving the address", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const pubKey = getPublicKey(secret);

    const result = await importWallet({
      network: "sepolia",
      accountType: "ready-v0.4.0",
      secret,
      password: PASSWORD,
      address: undefined, // derived
      storage,
      provider: mockProvider({ classHashAt: async () => READY_SEPOLIA_CLASS_HASH }),
    });

    expect(result.accountKind).toBe("existing");
    expect(result.ownership?.verified).toBe(true);
    expect(result.wallet.publicKey.toLowerCase()).toBe(pubKey.toLowerCase());
    // The imported address is the counterfactual derivation — preserved, not re-created.
    expect(result.wallet.address).toMatch(/^0x/);
    expect(result.wallet.walletId).toBe(walletIdFor(result.wallet.address));
  });

  it("imports an undeployed counterfactual Ready account explicitly", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const provider = mockProvider({
      classHashAt: async () => {
        throw new Error("Requested contract address is not deployed");
      },
    });

    const result = await importWallet({
      network: "sepolia",
      accountType: "ready-v0.4.0",
      secret,
      password: PASSWORD,
      storage,
      provider,
    });

    expect(result.accountKind).toBe("new-counterfactual");
    expect(result.ownership?.method).toBe("counterfactual-derivation");
    expect(result.ownership?.verified).toBe(true);
  });

  it("rejects a provided address that does not match the derived account", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const other = walletIdFor("0x1111111111111111111111111111111111111111111111111111111111111111");

    await expect(
      importWallet({
        network: "sepolia",
        accountType: "ready-v0.4.0",
        secret,
        password: PASSWORD,
        address: other,
        storage,
        provider: mockProvider(),
      }),
    ).rejects.toThrow(/does not match the account derived/i);
  });

  it("import → lock → unlock restores the same address and public key", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const imported = await importWallet({
      network: "sepolia",
      accountType: "ready-v0.4.0",
      secret,
      password: PASSWORD,
      storage,
      provider: mockProvider(),
    });

    lockWallet(imported.wallet);
    expect(imported.wallet.secret).toBe("");

    const reloaded = await unlockWallet({
      network: "sepolia",
      password: PASSWORD,
      walletId: imported.wallet.walletId,
      storage,
    });
    expect(reloaded.address).toBe(imported.wallet.address);
    expect(reloaded.publicKey).toBe(imported.wallet.publicKey);
    expect(reloaded.secret).toBe(secret);
  });
});

describe("Braavos import", () => {
  it("imports a valid deployed Braavos account (get_public_key matches)", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const pubKey = getPublicKey(secret);
    const address = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";

    const provider = mockProvider({
      classHashAt: async () => "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a",
      callContract: async (call: any) => {
        if (call?.entrypoint === "get_multisig_threshold") return ["0x1"];
        if (call?.entrypoint === "get_public_key") return ["0x" + BigInt(pubKey).toString(16)];
        return VALID_SRC5;
      },
    });

    const result = await importWallet({
      network: "sepolia",
      accountType: "braavos-v1.2.0",
      secret,
      password: PASSWORD,
      address,
      storage,
      provider,
    });

    expect(result.accountKind).toBe("existing");
    expect(result.ownership?.verified).toBe(true);
    expect(result.ownership?.method).toBe("braavos-get_public_key");
    expect(result.wallet.address.toLowerCase()).toBe(address.toLowerCase());
  });

  it("rejects a wrong key for an existing Braavos account", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const wrongPubKey = getPublicKey(canonicalizeSecret(generateSecretKey()));
    const address = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";

    const provider = mockProvider({
      classHashAt: async () => "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a",
      callContract: async (call: any) => {
        if (call?.entrypoint === "get_multisig_threshold") return ["0x1"];
        if (call?.entrypoint === "get_public_key") return ["0x" + BigInt(wrongPubKey).toString(16)];
        return VALID_SRC5;
      },
    });

    await expect(
      importWallet({
        network: "sepolia",
        accountType: "braavos-v1.2.0",
        secret,
        password: PASSWORD,
        address,
        storage,
        provider,
      }),
    ).rejects.toThrow(/does not match the imported key/i);
  });

  it("fails closed when the Braavos account is not deployed", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const address = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";

    const provider = mockProvider({
      classHashAt: async () => {
        throw new Error("Requested contract address is not deployed");
      },
    });

    await expect(
      importWallet({
        network: "sepolia",
        accountType: "braavos-v1.2.0",
        secret,
        password: PASSWORD,
        address,
        storage,
        provider,
      }),
    ).rejects.toThrow(/already-deployed account/i);
  });

  it("fails closed on an unsupported network (no verified Braavos config)", async () => {
    const storage = createMemoryStorage();
    await expect(
      importWallet({
        network: "mainnet",
        accountType: "braavos-v1.2.0",
        secret: canonicalizeSecret(generateSecretKey()),
        password: PASSWORD,
        address: "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d",
        storage,
        provider: mockProvider(),
      }),
    ).rejects.toThrow(/not verified on mainnet/i);
  });
});

describe("import security + storage", () => {
  it("never persists the raw imported key", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const result = await importWallet({
      network: "sepolia",
      accountType: "ready-v0.4.0",
      secret,
      password: PASSWORD,
      storage,
      provider: mockProvider(),
    });

    const keystoreJson = readWalletKeystore(storage, result.wallet.walletId)!;
    expect(keystoreJson).not.toContain(secret);
    const registry = readWalletRegistry(storage, "sepolia");
    expect(JSON.stringify(registry)).not.toContain(secret);
  });

  it("two wallets coexist without overwriting each other", async () => {
    const storage = createMemoryStorage();
    const walletA = await createWallet({ network: "sepolia", password: PASSWORD, storage });
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = (
      await importWallet({
        network: "sepolia",
        accountType: "ready-v0.4.0",
        secret: secretB,
        password: PASSWORD,
        storage,
        provider: mockProvider(),
      })
    ).wallet;

    expect(walletA.walletId).not.toBe(walletB.walletId);
    const wallets = listWallets({ network: "sepolia", storage });
    expect(wallets).toHaveLength(2);

    // Unlock A → still A; Unlock B → still B.
    const a = await unlockWallet({ network: "sepolia", password: PASSWORD, walletId: walletA.walletId, storage });
    const b = await unlockWallet({ network: "sepolia", password: PASSWORD, walletId: walletB.walletId, storage });
    expect(a.address).toBe(walletA.address);
    expect(b.address).toBe(walletB.address);
    expect(a.secret).not.toBe(b.secret);
  });
});

describe("STRK20 signer consumption (PART J)", () => {
  it("an imported wallet's signer is consumable by the STRK20 adapter user type", async () => {
    const storage = createMemoryStorage();
    const secret = canonicalizeSecret(generateSecretKey());
    const imported = await importWallet({
      network: "sepolia",
      accountType: "ready-v0.4.0",
      secret,
      password: PASSWORD,
      storage,
      provider: mockProvider(),
    });

    const viewingKey = 12345678901234567890n;
    const user: PrivyStrk20User = buildStrk20User(imported.wallet, viewingKey);
    expect(user.address).toBe(imported.wallet.address);
    expect(user.account.signer).toBe(imported.wallet.account.signer);
    expect(user.viewingKey).toBe(viewingKey);

    // The wallet's local signer signs independently (no Privy, no server).
    const sig = await user.account.signMessage({
      types: {
        StarkNetDomain: [{ name: "name", type: "felt" }],
        Message: [{ name: "message", type: "felt" }],
      },
      primaryType: "Message",
      domain: { name: "STRK20" },
      message: { message: 1 },
    } as never);
    expect(sig).toBeDefined();
  });
});