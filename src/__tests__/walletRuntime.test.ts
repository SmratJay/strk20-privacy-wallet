/**
 * @file walletRuntime.test.ts
 * @description Stage 2.5 — Wallet Core application runtime: create/import/unlock/lock/select/
 *   delete/network/send, deterministic from Orrange's own registry, no Privy, and the legacy
 *   no-walletId unlock path is never used.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage, walletIdFor } from "../wallet/storage";
import { generateSecretKey, canonicalizeSecret, getPublicKey } from "../wallet/crypto";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import type { UnlockedWallet } from "../wallet";

const PASSWORD = "correct horse battery staple";
const VALID_SRC5 = ["0x56614c4944"];

function mockProvider() {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => VALID_SRC5),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  } as never;
}

function makeRuntime() {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
  return { runtime, storage };
}

async function createdWallet(runtime: WalletRuntime): Promise<UnlockedWallet> {
  const wallet = await runtime.create(PASSWORD);
  return wallet;
}

describe("runtime lifecycle", () => {
  it("starts with no wallets and no session (locked)", () => {
    const { runtime } = makeRuntime();
    const s = runtime.getState();
    expect(s.wallets).toHaveLength(0);
    expect(s.session).toBeNull();
    expect(s.selectedWalletId).toBeNull();
  });

  it("create → session unlocked + wallet registered + selected", async () => {
    const { runtime, storage } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const s = runtime.getState();
    expect(s.session?.walletId).toBe(wallet.walletId);
    expect(s.wallets).toHaveLength(1);
    expect(s.selectedWalletId).toBe(wallet.walletId);
    expect(readWalletId(storage)).toContain(wallet.walletId);
  });

  it("import Ready → same derived address appears as the session", async () => {
    const { runtime } = makeRuntime();
    const secret = canonicalizeSecret(generateSecretKey());
    const wallet = await runtime.import({ accountType: "ready-v0.4.0", secret, password: PASSWORD });
    expect(getPublicKey(secret).toLowerCase()).toBe(wallet.publicKey.toLowerCase());
    expect(runtime.getState().session?.walletId).toBe(wallet.walletId);
  });

  it("import Braavos (ownership verified) → same address appears", async () => {
    const secret = canonicalizeSecret(generateSecretKey());
    const pubKey = getPublicKey(secret);
    const address = "0x5d08a4e9188429da4e993c9bf25aafe5cd491ee2b501505d4d059f0c938f82d";
    const provider = {
      getClassHashAt: vi.fn(async () => "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a"),
      callContract: vi.fn(async (call: any) => {
        if (call?.entrypoint === "get_multisig_threshold") return ["0x1"];
        if (call?.entrypoint === "get_public_key") return ["0x" + BigInt(pubKey).toString(16)];
        return VALID_SRC5;
      }),
      getBlockNumber: vi.fn(async () => 1),
      waitForTransaction: vi.fn(async () => ({})),
    } as never;
    const storage = createMemoryStorage();
    const braavosRuntime = new WalletRuntime({ storage, providerFactory: () => provider });
    const wallet = await braavosRuntime.import({
      accountType: "braavos-v1.2.0",
      secret,
      password: PASSWORD,
      address,
    });
    expect(wallet.address.toLowerCase()).toBe(address.toLowerCase());
    expect(braavosRuntime.getState().session?.walletId).toBe(wallet.walletId);
  });

  it("multiple wallets: selecting walletId + unlock loads the exact wallet", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    expect(runtime.getState().wallets).toHaveLength(2);

    runtime.lock();
    runtime.selectWallet(walletB.walletId);
    expect(runtime.getState().selectedWalletId).toBe(walletB.walletId);
    expect(runtime.getState().session).toBeNull();

    const unlocked = await runtime.unlock(PASSWORD);
    expect(unlocked.walletId).toBe(walletB.walletId);
    expect(unlocked.address).toBe(walletB.address);
  });

  it("refresh/re-init returns to locked with stored wallets (no persisted session)", async () => {
    const { runtime, storage } = makeRuntime();
    await createdWallet(runtime);
    // Simulate a page reload: a brand-new runtime over the same storage.
    const reloaded = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
    const s = reloaded.getState();
    expect(s.wallets).toHaveLength(1);
    expect(s.session).toBeNull();
  });

  it("lock → signing unavailable; unlock → exact wallet restored", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    runtime.lock();
    expect(runtime.getState().session).toBeNull();
    await expect(runtime.send({ contractAddress: "0x1", entrypoint: "noop", calldata: [] } as never)).rejects.toThrow(/locked/i);

    const restored = await runtime.unlock(PASSWORD);
    expect(restored.walletId).toBe(wallet.walletId);
    // Signing works again.
    const session = runtime.getState().session!;
    (session.account as any).execute = vi.fn(async () => ({ transaction_hash: "0xtx" }));
    const result = await runtime.send({ contractAddress: "0x1", entrypoint: "noop", calldata: [] } as never);
    expect(result.transactionHash).toBe("0xtx");
  });

  it("send uses the Wallet Core local-signer account", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const session = runtime.getState().session!;
    const execute = vi.fn(async () => ({ transaction_hash: "0xtxlocal" }));
    (session.account as any).execute = execute;
    (wallet.account as any).execute = execute;

    const call = {
      contractAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      entrypoint: "transfer",
      calldata: ["0x1", "0x2", "0x0", "0x3"],
    } as never;
    const result = await runtime.send(call);
    expect(result.transactionHash).toBe("0xtxlocal");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("unsupported network stays disabled", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    runtime.setNetwork("mainnet");
    const s = runtime.getState();
    expect(s.network).toBe("sepolia");
    expect(s.error).toMatch(/not enabled/i);
  });

  it("delete removes the selected wallet and returns to locked/empty state", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    runtime.deleteWallet(wallet.walletId);
    const s = runtime.getState();
    expect(s.wallets).toHaveLength(0);
    expect(s.session).toBeNull();
    expect(s.selectedWalletId).toBeNull();
  });
});

function readWalletId(storage: ReturnType<typeof createMemoryStorage>): string {
  const raw = storage.getItem("orrange_wallet_v2_registry_sepolia");
  return raw ?? "";
}

describe("runtime authority + Privy isolation", () => {
  it("Privy state is not a source for the runtime (no legacy no-walletId unlock)", async () => {
    // The runtime only ever unlocks by exact walletId; the legacy primary path is unused. Prove it
    // by creating two wallets and confirming unlock resolves the SELECTED one regardless of which
    // wallet was created last.
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    runtime.lock();
    runtime.selectWallet(walletA.walletId);
    const a = await runtime.unlock(PASSWORD);
    expect(a.walletId).toBe(walletA.walletId);

    runtime.lock();
    runtime.selectWallet(walletB.walletId);
    const b = await runtime.unlock(PASSWORD);
    expect(b.walletId).toBe(walletB.walletId);
    expect(b.walletId).not.toBe(a.walletId);
  });

  it("the new runtime source files never import Privy or legacy Wallet API connection code", () => {
    const files = [
      join(__dirname, "..", "wallet", "runtime.ts"),
      join(__dirname, "..", "context", "WalletRuntimeContext.tsx"),
    ];
    const forbidden = [
      "@privy-io",
      "@/context/PrivyWalletContext",
      "@/hooks/useStarknetWallet",
      "@/services/strk20WalletApiService",
      "@/components/ConnectWalletModal",
      "get-starknet",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect(source, `${file} must not import ${needle}`).not.toContain(needle);
      }
    }
  });

  it("the runtime never uses the legacy no-walletId unlock path (source-level)", () => {
    const source = readFileSync(join(__dirname, "..", "wallet", "runtime.ts"), "utf8");
    // The only unlockWallet call site in the runtime always passes the exact walletId.
    const callSite = source.match(/unlockWallet\(\{\s*network:\s*this\.state\.network,\s*walletId,/);
    expect(callSite).not.toBeNull();
    // It never calls the legacy two-argument form without a walletId.
    expect(source).not.toMatch(/unlockWallet\(\{\s*network:\s*[^}]*?password:[\s\S]*?\}\)\s*(?!,)/);
  });

  it("a logged-in Privy session cannot replace the runtime wallet (no coupling)", () => {
    // The runtime is constructed purely from Orrange's own registry; it has no dependency on
    // Privy contexts or the legacy external-wallet hooks.
    const source = readFileSync(join(__dirname, "..", "wallet", "runtime.ts"), "utf8");
    expect(source).not.toContain("@privy-io");
    expect(source).not.toContain("usePrivyWallet");
    expect(source).not.toContain("useStarknetWallet");
    expect(source).not.toContain("PrivyWalletContext");
  });
});

void walletIdFor;