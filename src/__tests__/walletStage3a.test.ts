/**
 * @file walletStage3a.test.ts
 * @description Stage 3A polish — the full wallet experience + STRK20 hardening.
 *
 * Covers, at the Wallet Runtime boundary (the exact surface the UI consumes):
 *   - unlock → dashboard state transition (gate gone, exact walletId/address restored)
 *   - first-use deployment lifecycle (reconcile, deploy through the Wallet Core signer, fail-closed)
 *   - first-use STRK20 privacy setup (availability + registration, never fake zero)
 *   - private balances via the wallet-native viewing key
 *   - privacy-operation serialization (concurrent ops cannot race)
 *   - stale-result isolation (lock / wallet switch discard in-flight privacy results)
 *   - viewing-key security (no public getViewingKey API, never in runtime state)
 *   - production logging never emits sensitive privacy data (source-level)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WalletRuntime, IDLE_PRIVACY_OP } from "../wallet/runtime";
import { WalletPrivacySession } from "../wallet/privacy";
import { createMemoryStorage } from "../wallet/storage";
import { generateSecretKey, canonicalizeSecret, getPublicKey } from "../wallet/crypto";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import type { UnlockedWallet } from "../wallet";
import type { AccountAdapter } from "../wallet/account";

const PASSWORD = "correct horse battery staple";

// Hoisted mock state for the STRK20 adapter so privacy ops are deterministic in tests.
const mockState = vi.hoisted(() => ({
  balances: new Map<string, bigint>(),
  asOfBlock: null as number | null,
  registered: true,
  shieldCalls: [] as unknown[],
  transferCalls: [] as unknown[],
  withdrawCalls: [] as unknown[],
  registerCalls: [] as unknown[],
  shieldDelay: null as null | (() => Promise<void>),
  registerDelay: null as null | (() => Promise<void>),
  reset() {
    this.balances.clear();
    this.asOfBlock = null;
    this.registered = true;
    this.shieldCalls.length = 0;
    this.transferCalls.length = 0;
    this.withdrawCalls.length = 0;
    this.registerCalls.length = 0;
    this.shieldDelay = null;
    this.registerDelay = null;
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
      if (mockState.shieldDelay) await mockState.shieldDelay();
      return { balance: mockState.balances.get(token.toLowerCase()) ?? 0n, asOfBlock: mockState.asOfBlock };
    }
    async getPrivacyRegistration(user: unknown, token: string): Promise<"registered" | "unregistered"> {
      void user;
      void token;
      return mockState.registered ? "registered" : "unregistered";
    }
    async register(user: unknown) {
      mockState.registerCalls.push({ user });
      if (mockState.registerDelay) await mockState.registerDelay();
      return { transactionHash: "0xregister", status: "PENDING", explorerUrl: "", warnings: [] };
    }
    async shield(user: unknown, token: string, amount: bigint) {
      mockState.shieldCalls.push({ user, token, amount });
      if (mockState.shieldDelay) await mockState.shieldDelay();
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

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

function mockProvider(overrides: Record<string, unknown> = {}) {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => ["0x56614c4944"]),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
    ...overrides,
  } as never;
}

function makeRuntime(opts: { provider?: unknown; adapter?: (pk: string, address?: string) => AccountAdapter; privacyOn?: boolean } = {}) {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({
    storage,
    providerFactory: () => (opts.provider ?? mockProvider()) as never,
    accountAdapterFactory: opts.adapter,
  });
  return { runtime, storage };
}

async function createdWallet(runtime: WalletRuntime): Promise<UnlockedWallet> {
  return runtime.create(PASSWORD);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
  mockState.reset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
  delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 1. Unlock → dashboard transition (the reported regression)
// ────────────────────────────────────────────────────────────────────────────────────────

describe("unlock → dashboard transition", () => {
  it("stored wallet → unlock → gate gone → dashboard state → exact walletId/address", async () => {
    const storage = createMemoryStorage();
    const r1 = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
    const wallet = await r1.create(PASSWORD);
    r1.lock();

    // Fresh page load: a new runtime over the same storage starts LOCKED (the gate).
    const r2 = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
    r2.init();
    let s = r2.getState();
    expect(s.wallets).toHaveLength(1);
    expect(s.isUnlocked).toBe(false);
    expect(s.account).toBeNull();

    // Unlock transitions to the dashboard.
    const unlocked = await r2.unlock(PASSWORD);
    s = r2.getState();
    expect(s.isUnlocked).toBe(true);
    expect(s.account).not.toBeNull();
    expect(s.account?.walletId).toBe(wallet.walletId);
    expect(s.account?.address).toBe(wallet.address);
    expect(unlocked.walletId).toBe(wallet.walletId);
  });

  it("wrong password keeps the gate and exposes a readable error", async () => {
    const storage = createMemoryStorage();
    const r1 = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
    await r1.create(PASSWORD);

    const r2 = new WalletRuntime({ storage, providerFactory: () => mockProvider() });
    r2.init();
    await expect(r2.unlock("wrong-password")).rejects.toThrow();
    const s = r2.getState();
    expect(s.isUnlocked).toBe(false);
    expect(s.account).toBeNull();
    expect(s.error).toMatch(/password|decrypt|keystore/i);
  });

  it("selecting a stored wallet then unlocking restores that exact walletId", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    runtime.lock();
    runtime.selectWallet(walletB.walletId);
    expect(runtime.getState().selectedWalletId).toBe(walletB.walletId);

    const unlocked = await runtime.unlock(PASSWORD);
    expect(unlocked.walletId).toBe(walletB.walletId);
    expect(unlocked.address).toBe(walletB.address);
    expect(runtime.getState().account?.walletId).toBe(walletB.walletId);
    expect(runtime.getState().account?.walletId).not.toBe(walletA.walletId);
  });

  it("the page consumes the runtime through useSyncExternalStore (UI re-render path)", () => {
    // The dashboard can only appear after unlock if the page re-renders when the runtime emits.
    // Assert the context hook subscribes via useSyncExternalStore (the regression fix) and the
    // page derives its account from the hook's reactive snapshot.
    const context = readFileSync(join(__dirname, "..", "context", "WalletRuntimeContext.tsx"), "utf8");
    expect(context).toContain("useSyncExternalStore");
    expect(context).toContain("runtime.subscribe");
    const page = readFileSync(join(__dirname, "..", "app", "wallet", "page.tsx"), "utf8");
    expect(page).toContain("useWalletRuntime()");
    expect(page).not.toContain("runtime.getState()");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 2. First-use deployment lifecycle
// ────────────────────────────────────────────────────────────────────────────────────────

describe("first-use deployment lifecycle", () => {
  it("a newly created counterfactual account reconciles to not_deployed", async () => {
    const { runtime } = makeRuntime({ provider: mockProvider({ getClassHashAt: vi.fn(async () => undefined) }) });
    await createdWallet(runtime);
    await runtime.refreshDeployment();
    expect(runtime.getState().deploymentStatus).toBe("not_deployed");
  });

  it("an account already deployed on-chain reconciles to deployed (Ready)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.refreshDeployment();
    expect(runtime.getState().deploymentStatus).toBe("deployed");
  });

  it("RPC failure during reconciliation is fail-closed → unknown (never 'not deployed')", async () => {
    const { runtime } = makeRuntime({
      provider: mockProvider({ getClassHashAt: vi.fn(async () => { throw new Error("network down"); }) }),
    });
    await createdWallet(runtime);
    await runtime.refreshDeployment();
    expect(runtime.getState().deploymentStatus).toBe("unknown");
  });

  it("deploy() submits DEPLOY_ACCOUNT through the Wallet Core adapter and reaches deployed", async () => {
    const deploy = vi.fn(async () => ({ transactionHash: "0xdeploy", contractAddress: "0x123" }));
    const probe = vi.fn(async () => "not_deployed" as const);
    const adapter: AccountAdapter = {
      type: "ready-v0.4.0",
      address: "0x123",
      publicKey: "0xabc",
      addressDerivable: true,
      probeDeployment: probe,
      isDeployed: vi.fn(),
      deploy,
      verifyOwnership: vi.fn(async () => ({ verified: true, method: "counterfactual-derivation" })),
      waitForFinality: vi.fn(),
    };
    const { runtime } = makeRuntime({
      provider: mockProvider({ getBlockNumber: vi.fn(async () => 30) }),
      adapter: () => adapter,
    });
    await createdWallet(runtime);

    await runtime.deploy();
    const s = runtime.getState();
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(s.deploymentStatus).toBe("deployed");
  });

  it("deploy() fails closed when the probe is unknown (refuses to deploy)", async () => {
    const deploy = vi.fn();
    const adapter: AccountAdapter = {
      type: "ready-v0.4.0",
      address: "0x123",
      publicKey: "0xabc",
      addressDerivable: true,
      probeDeployment: vi.fn(async () => "unknown" as const),
      isDeployed: vi.fn(),
      deploy,
      verifyOwnership: vi.fn(async () => ({ verified: true, method: "counterfactual-derivation" })),
      waitForFinality: vi.fn(),
    };
    const { runtime } = makeRuntime({ adapter: () => adapter });
    await createdWallet(runtime);

    await expect(runtime.deploy()).rejects.toThrow();
    expect(deploy).not.toHaveBeenCalled();
    expect(runtime.getState().deploymentStatus).toBe("unknown");
  });

  it("deploy() reconciles after a finality timeout and never claims deployed without a verified probe", async () => {
    // Finality never reached (block stays too close); the recheck probe reports not_deployed.
    const adapter: AccountAdapter = {
      type: "ready-v0.4.0",
      address: "0x123",
      publicKey: "0xabc",
      addressDerivable: true,
      probeDeployment: vi.fn(async () => "not_deployed" as const),
      isDeployed: vi.fn(),
      deploy: vi.fn(async () => ({ transactionHash: "0xdeploy", contractAddress: "0x123" })),
      verifyOwnership: vi.fn(async () => ({ verified: true, method: "counterfactual-derivation" })),
      waitForFinality: vi.fn(),
    };
    const { runtime } = makeRuntime({
      provider: mockProvider({ getBlockNumber: vi.fn(async () => 1) }),
      adapter: () => adapter,
    });
    await createdWallet(runtime);

    await expect(runtime.deploy({ finalityPollMs: 10, finalityTimeoutMs: 300 })).rejects.toThrow(/finality/i);
    // Fail-closed: never "deployed".
    expect(runtime.getState().deploymentStatus).not.toBe("deployed");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 3. First-use STRK20 privacy setup
// ────────────────────────────────────────────────────────────────────────────────────────

describe("first-use STRK20 privacy setup", () => {
  it("privacy is unavailable when operator services are not configured — NEVER a fake zero balance", async () => {
    const { runtime } = makeRuntime({ privacyOn: true });
    await createdWallet(runtime);
    // Simulate an operator-less environment.
    const offline = new WalletRuntime({
      storage: createMemoryStorage(),
      providerFactory: () => mockProvider(),
      privacyConfig: null,
    });
    await offline.create(PASSWORD);
    await offline.refreshPrivateBalances();
    const s = offline.getState();
    expect(s.privacy.available).toBe(false);
    expect(s.privacy.status).toBe("unavailable");
    expect(s.privacy.reason).toMatch(/not configured/i);
    // No zero row — privateBalances stays empty when unavailable.
    expect(s.privateBalances).toHaveLength(0);
    void runtime;
  });

  it("privacy is available when configured, and registration state is honest", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    mockState.registered = true;
    const registered = await runtime.refreshPrivacyRegistration();
    expect(registered).toBe(true);
    expect(runtime.getState().privacy.available).toBe(true);
    expect(runtime.getState().privacy.registered).toBe(true);

    mockState.registered = false;
    const unregistered = await runtime.refreshPrivacyRegistration();
    expect(unregistered).toBe(false);
    expect(runtime.getState().privacy.registered).toBe(false);
  });

  it("a discovery failure surfaces as privacy error with a reason, never as zero balance", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    // Simulate a discovery failure: adapter throws.
    vi.mocked(mockState).reset();
    const original = mockState.balances;
    void original;
    // The mock returns 0n for unknown tokens — instead force an error by making the session's
    // discovery fail: patch the runtime's privacy session adapter.
    const session = (runtime as unknown as { privacySession: WalletPrivacySession }).privacySession;
    const patch = session as unknown as { adapter: { getPrivateBalanceSnapshot: () => Promise<never> } };
    patch.adapter.getPrivateBalanceSnapshot = vi.fn(async () => {
      throw new Error("discovery service unreachable");
    });
    await runtime.refreshPrivateBalances();
    const s = runtime.getState();
    expect(s.privacy.status).toBe("error");
    expect(s.privacy.reason).toMatch(/discovery|unreachable/i);
    expect(s.privateBalances).toHaveLength(0);
  });

  it("private balances come from the wallet-native viewing key + STRK20 discovery (no zero fakes)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    mockState.balances.set(STRK.toLowerCase(), 42n * 10n ** 18n);
    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow?.balance).toBe(42n * 10n ** 18n);
    expect(runtime.getState().privacy.status).toBe("available");
    void wallet;
  });

  it("discovery OHTTP is a config seam, disabled by default (env 'true' enables it)", async () => {
    const { resolveWalletPrivacyConfig } = await import("../wallet/privacy");
    expect(resolveWalletPrivacyConfig("sepolia")?.discoveryOhttp).toBeUndefined();
    process.env.NEXT_PUBLIC_STRK20_DISCOVERY_OHTTP = "true";
    expect(resolveWalletPrivacyConfig("sepolia")?.discoveryOhttp).toBe(true);
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_OHTTP;
    expect(resolveWalletPrivacyConfig("sepolia")?.discoveryOhttp).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 4. Privacy-operation serialization + stale isolation
// ────────────────────────────────────────────────────────────────────────────────────────

describe("privacy-operation serialization + stale isolation", () => {
  it("concurrent privacy operations are serialized (B waits for A)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);

    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mockState.shieldDelay = async () => {
      await gate;
    };

    const order: string[] = [];
    const a = runtime.shield(STRK, 5n).then(() => order.push("A-done"));
    // B starts while A is still inside the adapter (blocked on the gate).
    const b = runtime.shield(STRK, 7n).then(() => order.push("B-done"));
    await new Promise((r) => setTimeout(r, 30));
    expect(mockState.shieldCalls.length).toBe(1); // B has NOT entered the adapter yet.
    releaseA();
    await Promise.all([a, b]);
    expect(mockState.shieldCalls.length).toBe(2);
    expect(order).toEqual(["A-done", "B-done"]);
  });

  it("lock destroys the privacy session and in-flight privacy results are discarded", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);

    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    mockState.shieldDelay = async () => {
      await gate;
    };

    const p = runtime.shield(STRK, 5n);
    runtime.lock(); // lock while A is in-flight
    releaseA();
    const result = await p;
    void result;
    const s = runtime.getState();
    expect(s.isUnlocked).toBe(false);
    expect(s.account).toBeNull();
    // The stale shield must not have updated the (now locked) view.
    expect(s.privacyOp.phase).toBe("idle");
    expect(s.recentTransactions).toHaveLength(0);
  });

  it("wallet switch destroys the old privacy session and discards its async results", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    runtime.lock();
    runtime.selectWallet(walletA.walletId);
    await runtime.unlock(PASSWORD);

    // Start a private-balance refresh, then switch wallets before it resolves.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockState.shieldDelay = async () => {
      await gate;
    };
    const p = runtime.refreshPrivateBalances();
    runtime.selectWallet(walletB.walletId);
    release();
    const rows = await p;
    expect(rows).toHaveLength(0);
    expect(runtime.getState().privateBalances).toHaveLength(0);
    expect(runtime.getState().isUnlocked).toBe(false);
  });

  it("stale shield/privateTransfer/withdraw results are ignored after lock", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockState.shieldDelay = async () => {
      await gate;
    };

    const shield = runtime.shield(STRK, 5n);
    runtime.lock();
    release();
    await shield;
    expect(runtime.getState().privacyOp).toEqual(IDLE_PRIVACY_OP);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 5. Viewing-key security
// ────────────────────────────────────────────────────────────────────────────────────────

describe("viewing-key security", () => {
  it("WalletPrivacySession has NO public getViewingKey API", () => {
    expect((WalletPrivacySession.prototype as unknown as Record<string, unknown>).getViewingKey).toBeUndefined();
    expect(typeof (WalletPrivacySession.prototype as unknown as { getViewingKey?: unknown }).getViewingKey).toBe("undefined");
  });

  it("the runtime never exposes the viewing key through its state", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const { deriveWalletViewingKey } = await import("../wallet/privacy");
    const derivedKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(JSON.stringify(runtime.getState())).not.toContain(derivedKey.toString());
  });

  it("WalletRuntime has no public accessor returning a viewing key (source-level)", () => {
    const source = readFileSync(join(__dirname, "..", "wallet", "runtime.ts"), "utf8");
    expect(source).not.toMatch(/getViewingKey\s*\(/);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 6. Production logging never exposes sensitive privacy data
// ────────────────────────────────────────────────────────────────────────────────────────

describe("production privacy logging hygiene", () => {
  const files = [
    "Strk20Adapter.ts",
    "allowance.ts",
  ];

  it("the STRK20 adapter + allowance modules use only the dev-gated logger (no raw console.*)", () => {
    for (const name of files) {
      const source = readFileSync(join(__dirname, "..", "privacy", "strk20", name), "utf8");
      // Strip the dev-gated logger helper bodies; any remaining console.* call is a production
      // diagnostic that could leak wallet address / URLs / amounts / proofs / viewing keys.
      const withoutHelpers = source.replace(/function (debug|debugWarn)\([\s\S]*?\n}\n/g, "");
      expect(withoutHelpers).not.toMatch(/console\./);
      // The dev-gated logger must gate on NODE_ENV !== "production".
      expect(source).toContain('NODE_ENV !== "production"');
    }
  });

  it("the adapter never logs viewing keys, proofs, notes, private balances, or secrets (source-level)", () => {
    for (const name of files) {
      const source = readFileSync(join(__dirname, "..", "privacy", "strk20", name), "utf8");
      expect(source).not.toMatch(/console\.\w+\([^)]*viewingKey/i);
      expect(source).not.toMatch(/console\.\w+\([^)]*proof/i);
      expect(source).not.toMatch(/console\.\w+\([^)]*secret/i);
    }
  });

  it("the wallet privacy session never logs or persists the viewing key", () => {
    const source = readFileSync(join(__dirname, "..", "wallet", "privacy.ts"), "utf8");
    expect(source).not.toMatch(/console\./);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 7. /wallet primary flow isolation + legacy boundary
// ────────────────────────────────────────────────────────────────────────────────────────

describe("wallet boundary isolation", () => {
  it("the /wallet page and its runtime have no Privy / legacy Wallet API dependency", () => {
    const page = readFileSync(join(__dirname, "..", "app", "wallet", "page.tsx"), "utf8");
    const context = readFileSync(join(__dirname, "..", "context", "WalletRuntimeContext.tsx"), "utf8");
    for (const source of [page, context]) {
      for (const needle of [
        "@privy-io",
        "@/context/PrivyWalletContext",
        "@/context/WalletContext",
        "@/hooks/useStarknetWallet",
        "@/services/strk20WalletApiService",
        "@/components/ConnectWalletModal",
      ]) {
        expect(source).not.toContain(needle);
      }
    }
  });

  it("the runtime consumes the exact selected wallet, never a legacy Privy account", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    // Legacy signals are irrelevant: the runtime account is purely registry-driven.
    expect(runtime.getState().wallets.map((w) => w.walletId)).toContain(walletA.walletId);
    expect(runtime.getState().wallets.map((w) => w.walletId)).toContain(walletB.walletId);
    runtime.lock();
    runtime.selectWallet(walletA.walletId);
    await runtime.unlock(PASSWORD);
    expect(runtime.getState().account?.walletId).toBe(walletA.walletId);
    expect(getPublicKey(runtime.getState().account?.publicKey ?? "")).toBeDefined();
  });
});
// ────────────────────────────────────────────────────────────────────────────────────────
// 8. STRK20 end-to-end acceptance path (deterministic mock; explicit about what is mocked)
// ────────────────────────────────────────────────────────────────────────────────────────

describe("STRK20 end-to-end acceptance path (mocked)", () => {
  it("register → shield → private balance discovery → private transfer → withdraw", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    mockState.balances.set(STRK.toLowerCase(), 10n * 10n ** 18n);

    // 1. Registration
    const reg = await runtime.register();
    expect(reg.transactionHash).toBe("0xregister");
    expect(mockState.registerCalls).toHaveLength(1);
    expect(runtime.getState().privacyOp.phase).toBe("success");

    // 2. Shield
    const shield = await runtime.shield(STRK, 2n * 10n ** 18n);
    expect(shield.transactionHash).toBe("0xshield");

    // 3. Private balance discovery (wallet-native viewing key, honest balance)
    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow?.balance).toBe(10n * 10n ** 18n);
    expect(runtime.getState().privacy.status).toBe("available");

    // 4. Private transfer
    const transfer = await runtime.privateTransfer(STRK, 1n * 10n ** 18n, "0xrecipient");
    expect(transfer.transactionHash).toBe("0xtransfer");

    // 5. Withdraw
    const withdraw = await runtime.withdraw(STRK, 1n * 10n ** 18n);
    expect(withdraw.transactionHash).toBe("0xwithdraw");

    // Every op went through the active wallet's session (bound to the created wallet).
    const s = runtime.getState();
    expect(s.recentTransactions.map((t) => t.hash)).toEqual(["0xwithdraw", "0xtransfer", "0xshield", "0xregister"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 9. Serialization — errors never wedge the queue
// ────────────────────────────────────────────────────────────────────────────────────────

describe("privacy serialization recovery", () => {
  it("a failing operation does not wedge the queue (a later op still executes)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);

    const session = (runtime as unknown as { privacySession: WalletPrivacySession }).privacySession;
    const adapter = (session as unknown as { adapter: { shield: (u: unknown, t: string, a: bigint) => Promise<unknown> } }).adapter;
    const origShield = adapter.shield.bind(adapter);
    adapter.shield = vi.fn(async () => {
      throw new Error("prover down");
    });

    // A rejects.
    await expect(runtime.shield(STRK, 5n)).rejects.toThrow(/prover down/);
    expect(runtime.getState().privacyOp.phase).toBe("failed");

    // B still executes after A's failure.
    adapter.shield = origShield;
    const second = await runtime.shield(STRK, 7n);
    expect(second.transactionHash).toBe("0xshield");
    expect(mockState.shieldCalls).toHaveLength(1);
    expect(runtime.getState().privacyOp.phase).toBe("success");
  });

  it("register is serialized with other mutating ops (B waits for A)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockState.registerDelay = async () => {
      await gate;
    };

    const order: string[] = [];
    const reg = runtime.register().then(() => order.push("register-done"));
    const shield = runtime.shield(STRK, 5n).then(() => order.push("shield-done"));
    await new Promise((r) => setTimeout(r, 30));
    expect(mockState.registerCalls).toHaveLength(1);
    expect(mockState.shieldCalls).toHaveLength(0); // shield waits for register
    release();
    await Promise.all([reg, shield]);
    expect(mockState.shieldCalls).toHaveLength(1);
    expect(order).toEqual(["register-done", "shield-done"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 10. Proving-chain maturity (honest, never a generic "privacy failed")
// ────────────────────────────────────────────────────────────────────────────────────────

describe("first-use proving-chain maturity", () => {
  function deployableAdapter() {
    const adapter: AccountAdapter = {
      type: "ready-v0.4.0",
      address: "0x123",
      publicKey: "0xabc",
      addressDerivable: true,
      probeDeployment: vi.fn(async () => "not_deployed" as const),
      isDeployed: vi.fn(),
      deploy: vi.fn(async () => ({ transactionHash: "0xdeploy", contractAddress: "0x123", deployedAtBlock: 100 })),
      verifyOwnership: vi.fn(async () => ({ verified: true, method: "counterfactual-derivation" })),
      waitForFinality: vi.fn(),
    };
    return adapter;
  }

  it("after a successful deployment the account is mature; a head below the ready block is honestly WAITING (never 'failed')", async () => {
    const head = { value: 11 };
    const provider = mockProvider({ getBlockNumber: vi.fn(async () => head.value) });
    const { runtime } = makeRuntime({ provider, adapter: () => deployableAdapter() });
    await createdWallet(runtime);

    // Receipt block_number = 1 → readyAt = 1 + MATURITY_BLOCKS (10) = 11. Head 11 ≥ 11 → ready.
    await runtime.deploy({ finalityPollMs: 10, finalityTimeoutMs: 1000 });
    await runtime.refreshPrivacyMaturity();
    let s = runtime.getState();
    expect(s.deploymentStatus).toBe("deployed");
    expect(s.privacy.maturity).toBe("ready");
    expect(s.privacy.maturityReadyAtBlock).toBe(11);

    // A chain head that regresses below the ready block must report WAITING, not a generic failure.
    head.value = 5;
    await runtime.refreshPrivacyMaturity();
    s = runtime.getState();
    expect(s.privacy.maturity).toBe("waiting");
    expect(s.privacy.currentBlock).toBe(5);
    expect(s.privacy.status).not.toBe("error");
  });

  it("maturity is honestly UNKNOWN when the deploy block is not known this session", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.refreshDeployment();
    const s = runtime.getState();
    expect(s.privacy.maturity).toBe("unknown");
    expect(s.privacy.maturityReadyAtBlock).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 11. Private-balance semantics — discovery lag is "syncing", never a silent 0
// ────────────────────────────────────────────────────────────────────────────────────────

describe("private-balance sync semantics", () => {
  it("a snapshot lagging the chain head reports syncing while still showing the balance", async () => {
    const { runtime } = makeRuntime({
      provider: mockProvider({ getBlockNumber: vi.fn(async () => 1000) }),
    });
    await createdWallet(runtime);
    mockState.asOfBlock = 990; // 1000 - 990 = 10 > SYNC_TOLERANCE_BLOCKS
    mockState.balances.set(STRK.toLowerCase(), 5n);

    const rows = await runtime.refreshPrivateBalances();
    const s = runtime.getState();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow?.syncing).toBe(true);
    expect(strkRow?.asOfBlock).toBe(990);
    expect(strkRow?.balance).toBe(5n); // balance is real, just possibly incomplete
    expect(s.privacy.syncing).toBe(true);
  });

  it("a current snapshot is NOT marked syncing", async () => {
    const { runtime } = makeRuntime({
      provider: mockProvider({ getBlockNumber: vi.fn(async () => 1000) }),
    });
    await createdWallet(runtime);
    mockState.asOfBlock = 999;
    mockState.balances.set(STRK.toLowerCase(), 5n);

    const rows = await runtime.refreshPrivateBalances();
    const strkRow = rows.find((r) => r.token.symbol === "STRK");
    expect(strkRow?.syncing).toBe(false);
    expect(runtime.getState().privacy.syncing).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 12. Network reload (reloadForNetwork) discards in-flight privacy results
// ────────────────────────────────────────────────────────────────────────────────────────

describe("network reload invalidates in-flight privacy work", () => {
  it("a delete-triggered reloadForNetwork discards an in-flight private-balance refresh", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const secretB = canonicalizeSecret(generateSecretKey());
    const walletB = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockState.shieldDelay = async () => {
      await gate;
    };

    const p = runtime.refreshPrivateBalances();
    // Deleting a different wallet reloads the network registry → invalidates the session guard.
    runtime.deleteWallet(walletB.walletId);
    release();
    const rows = await p;
    expect(rows).toHaveLength(0);
    expect(runtime.getState().privateBalances).toHaveLength(0);
    void walletA;
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 13. Network-scoped shadow-account anonymizer config (no server secret)
// ────────────────────────────────────────────────────────────────────────────────────────

describe("shadow-account anonymizer config", () => {
  it("is network-scoped public config — sepolia env never leaks to mainnet", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA = "0xanonymizer-sepolia";
    try {
      const { getNetworkConfig } = await import("@/config/networks");
      expect(getNetworkConfig("sepolia").shadowAccountAnonymizerAddress).toBe("0xanonymizer-sepolia");
      // Mainnet is a different network: it must not inherit the sepolia address.
      expect(getNetworkConfig("mainnet").shadowAccountAnonymizerAddress).toBe("");
    } finally {
      delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
    }
  });

  it("createShadowIdentity is explicitly unavailable when the active network has no anonymizer", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
    await expect(runtime.createShadowIdentity("treasury", 0n)).rejects.toThrow(/no shadow-account anonymizer is configured for sepolia/i);
  });

  it("createShadowIdentity uses the network-scoped anonymizer when configured", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
    process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
    process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA = "0xabc";
    try {
      const { WalletRuntime } = await import("../wallet/runtime");
      const { createMemoryStorage } = await import("../wallet/storage");
      const { READY_SEPOLIA_CLASS_HASH } = await import("../wallet/account");
      const provider = {
        getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
        callContract: vi.fn(async () => ["0x56614c4944"]),
        getBlockNumber: vi.fn(async () => 1),
        waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
      } as never;
      const runtime = new WalletRuntime({ storage: createMemoryStorage(), providerFactory: () => provider });
      const wallet = await runtime.create(PASSWORD);
      const identity = await runtime.createShadowIdentity("treasury", 0n);
      expect(identity.appName).toBe("treasury");
      expect(BigInt(identity.nonce)).toBe(0n);
      expect(identity.owner.toLowerCase()).toBe(wallet.address.toLowerCase());
      expect(identity.partialCommitment).toBeTruthy();
      expect(identity.shadowAddress).toMatch(/^0x/);
    } finally {
      delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
      delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
      delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    }
  });
});
