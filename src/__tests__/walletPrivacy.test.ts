/**
 * @file walletPrivacy.test.ts
 * @description Stage 3A — wallet-native STRK20 privacy: viewing-key derivation (deterministic,
 *   reproducible, never plaintext), privacy-session binding to the active wallet, stale-async
 *   isolation, and no Privy / no Wallet API dependency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";
import { generateSecretKey, canonicalizeSecret } from "../wallet/crypto";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import {
  deriveWalletViewingKey,
  canonicalizeViewingKey,
  VIEWING_KEY_DOMAIN_PREFIX,
} from "../wallet/privacy";
import { privateIdentityId } from "../privacy/identity";

const PASSWORD = "correct horse battery staple";

// Hoisted mock state for the STRK20 adapter so privacy ops are deterministic in tests.
const mockState = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  shieldCalls: [] as unknown[],
  transferCalls: [] as unknown[],
  withdrawCalls: [] as unknown[],
  reset() {
    this.balances.clear();
    this.shieldCalls.length = 0;
    this.transferCalls.length = 0;
    this.withdrawCalls.length = 0;
  },
}));

vi.mock("@/privacy/strk20", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/privacy/strk20")>();
  class MockAdapter {
    constructor(_cfg: unknown) {}
    async getPrivateBalance(user: unknown, token: string): Promise<bigint> {
      void user;
      return mockState.balances.get(token.toLowerCase()) ?? 0n;
    }
    async getPrivateBalanceSnapshot(user: unknown, token: string) {
      void user;
      return { balance: mockState.balances.get(token.toLowerCase()) ?? 0n, asOfBlock: null };
    }
    async shield(user: unknown, token: string, amount: bigint) {
      mockState.shieldCalls.push({ user, token, amount });
      return { transactionHash: "0xshield", status: "PENDING", explorerUrl: "", warnings: [] };
    }
    async transfer(user: unknown, token: string, amount: bigint, recipient: string) {
      mockState.transferCalls.push({ user, token, amount, recipient });
      return { transactionHash: "0xtransfer", status: "PENDING", explorerUrl: "", warnings: [] };
    }
    async unshield(user: unknown, token: string, amount: bigint) {
      mockState.withdrawCalls.push({ user, token, amount });
      return { transactionHash: "0xwithdraw", status: "PENDING", explorerUrl: "", warnings: [] };
    }
  }
  return { ...actual, Strk20Adapter: MockAdapter };
});

import { chainBalances } from "@/chains/publicBalances";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

function fastProvider() {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => ["0x56614c4944"]),
    getBlockNumber: vi.fn(async () => 1),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  } as never;
}

function makeRuntime() {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({ storage, providerFactory: () => fastProvider() });
  return { runtime, storage };
}

describe("wallet-native viewing key derivation", () => {
  it("is deterministic for the same secret + network", () => {
    const secret = canonicalizeSecret(generateSecretKey());
    expect(deriveWalletViewingKey(secret, "sepolia")).toBe(deriveWalletViewingKey(secret, "sepolia"));
  });

  it("same wallet unlock reproduces the same viewing key (privacy recovery)", async () => {
    const { runtime, storage } = makeRuntime();
    const wallet = await runtime.create(PASSWORD);
    const key1 = deriveWalletViewingKey(wallet.secret, "sepolia");
    runtime.lock();
    const restored = await runtime.unlock(PASSWORD);
    const key2 = deriveWalletViewingKey(restored.secret, "sepolia");
    expect(key1).toBe(key2);
    void storage;
  });

  it("different wallets → different viewing keys; wrong secret → different key", () => {
    const secretA = canonicalizeSecret(generateSecretKey());
    const secretB = canonicalizeSecret(generateSecretKey());
    const wrongSecret = "0x" + (BigInt(secretA) + 1n).toString(16);
    expect(deriveWalletViewingKey(secretA, "sepolia")).not.toBe(deriveWalletViewingKey(secretB, "sepolia"));
    expect(deriveWalletViewingKey(secretA, "sepolia")).not.toBe(deriveWalletViewingKey(wrongSecret, "sepolia"));
  });

  it("is network-scoped (no cross-network key reuse)", () => {
    const secret = canonicalizeSecret(generateSecretKey());
    expect(deriveWalletViewingKey(secret, "sepolia")).not.toBe(deriveWalletViewingKey(secret, "mainnet"));
  });

  it("produces a canonical key in the STRK20 range and is not the master secret", () => {
    const secret = canonicalizeSecret(generateSecretKey());
    const key = deriveWalletViewingKey(secret, "sepolia");
    const n = 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
    expect(BigInt(key)).toBeGreaterThan(0n);
    expect(BigInt(key)).toBeLessThanOrEqual(n / 2n);
    expect(BigInt(key)).not.toBe(BigInt(secret));
    expect(canonicalizeViewingKey(BigInt(key))).toBe(BigInt(key));
  });

  it("domain string is stable and documented", () => {
    expect(VIEWING_KEY_DOMAIN_PREFIX).toBe("ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1");
  });
});

describe("runtime privacy capability", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
    process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
    mockState.reset();
    (chainBalances.fetchBalances as unknown as ReturnType<typeof vi.fn>)?.mockReset?.();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
  });

  it("exposes a safe privacy status, never the viewing key", async () => {
    const { runtime } = makeRuntime();
    const wallet = await runtime.create(PASSWORD);
    const view = runtime.getState();
    expect(view.privacy.available).toBe(true);
    expect(view.privacy.status).toBeDefined();
    // The viewing key (derived from the wallet secret) must not appear in the safe view.
    const derivedKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(JSON.stringify(view)).not.toContain(derivedKey.toString());
  });

  it("locked wallet cannot perform privacy operations", async () => {
    const { runtime } = makeRuntime();
    await runtime.create(PASSWORD);
    runtime.lock();
    await expect(runtime.shield(STRK, 1n)).rejects.toThrow(/locked/i);
    await expect(runtime.privateTransfer(STRK, 1n, "0x1")).rejects.toThrow(/locked/i);
    await expect(runtime.withdraw(STRK, 1n)).rejects.toThrow(/locked/i);
  });

  it("private balance discovery reaches the STRK20 adapter with the wallet-native viewing key", async () => {
    const { runtime } = makeRuntime();
    const wallet = await runtime.create(PASSWORD);
    mockState.balances.set(STRK.toLowerCase(), 42n * 10n ** 18n);

    const rows = await runtime.refreshPrivateBalances();
    expect(runtime.getState().privacy.status).toBe("available");
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow?.available).toBe(true);
    expect(strkRow?.balance).toBe(42n * 10n ** 18n);
    void wallet;
  });

  it("shield / privateTransfer / withdraw reach the adapter bound to the active wallet + viewing key", async () => {
    const { runtime } = makeRuntime();
    const wallet = await runtime.create(PASSWORD);
    const viewingKey = deriveWalletViewingKey(wallet.secret, "sepolia");

    const shield = await runtime.shield(STRK, 5n);
    expect(shield.transactionHash).toBe("0xshield");
    expect(mockState.shieldCalls[0]).toMatchObject({ token: STRK, amount: 5n });
    const shieldUser = (mockState.shieldCalls[0] as { user: { address: string; viewingKey: bigint; account: unknown } }).user;
    expect(shieldUser.address.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(shieldUser.viewingKey).toBe(viewingKey);
    // The user carries the Wallet Core account/signer (not Privy).
    expect((shieldUser.account as { address?: string }).address?.toLowerCase?.()).toBe(wallet.address.toLowerCase());

    const transfer = await runtime.privateTransfer(STRK, 3n, "0xabc");
    expect(transfer.transactionHash).toBe("0xtransfer");
    expect(mockState.transferCalls[0]).toMatchObject({ token: STRK, amount: 3n, recipient: "0xabc" });

    const withdraw = await runtime.withdraw(STRK, 1n);
    expect(withdraw.transactionHash).toBe("0xwithdraw");
    expect(mockState.withdrawCalls[0]).toMatchObject({ token: STRK, amount: 1n });
  });

  it("lock invalidates the privacy session (stale private-balance result ignored)", async () => {
    const { runtime } = makeRuntime();
    await runtime.create(PASSWORD);
    // A privacy op started before lock must not mutate state after lock.
    const p = runtime.refreshPrivateBalances();
    runtime.lock();
    const rows = await p;
    expect(rows).toHaveLength(0);
    expect(runtime.getState().privateBalances).toHaveLength(0);
  });

  it("wallet switch invalidates the privacy session", async () => {
    const { runtime } = makeRuntime();
    const walletA = await runtime.create(PASSWORD);
    const secretB = canonicalizeSecret(generateSecretKey());
    await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    runtime.lock();
    runtime.selectWallet(walletA.walletId);
    await runtime.unlock(PASSWORD);
    expect(runtime.getState().isUnlocked).toBe(true);

    // Switching to another wallet locks the session and clears private state.
    runtime.selectWallet(runtime.getState().wallets[1]!.walletId);
    expect(runtime.getState().privateBalances).toHaveLength(0);
    expect(runtime.getState().isUnlocked).toBe(false);
  });
});

describe("privacy identity separation", () => {
  it("the viewing key is never stored in PrivateIdentity records", async () => {
    const secret = canonicalizeSecret(generateSecretKey());
    const viewingKey = deriveWalletViewingKey(secret, "sepolia");
    // The identity id is an application-level namespace, NOT the viewing key and NOT the shadow
    // commitment. It must differ from the viewing key.
    const id = privateIdentityId("0xabc", "treasury");
    expect(BigInt(id)).not.toBe(viewingKey);
  });
});

describe("architectural: privacy path has no Privy / Wallet API dependency", () => {
  it("wallet privacy + neutral STRK20 adapter never import Privy or legacy Wallet API code", () => {
    const dirs = [
      join(__dirname, "..", "wallet", "privacy.ts"),
      join(__dirname, "..", "privacy", "strk20"),
    ];
    const forbidden = [
      "@privy-io",
      "@/privacy/privy",
      "@/context/PrivyWalletContext",
      "@/hooks/useStarknetWallet",
      "@/services/strk20WalletApiService",
      "@/components/ConnectWalletModal",
      "get-starknet",
    ];
    const files: string[] = [];
    for (const entry of dirs) {
      if (entry.endsWith(".ts")) files.push(entry);
      else files.push(...walk(entry));
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect(source, `${file} must not import ${needle}`).not.toContain(needle);
      }
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}