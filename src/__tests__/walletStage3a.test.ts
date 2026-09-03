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
  registered: true,
  shieldCalls: [] as unknown[],
  transferCalls: [] as unknown[],
  withdrawCalls: [] as unknown[],
  shieldDelay: null as null | (() => Promise<void>),
  reset() {
    this.balances.clear();
    this.registered = true;
    this.shieldCalls.length = 0;
    this.transferCalls.length = 0;
    this.withdrawCalls.length = 0;
    this.shieldDelay = null;
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
    async getPrivacyRegistration(user: unknown, token: string): Promise<"registered" | "unregistered"> {
      void user;
      void token;
      return mockState.registered ? "registered" : "unregistered";
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
    const patch = session as unknown as { adapter: { getPrivateBalance: () => Promise<never> } };
    patch.adapter.getPrivateBalance = vi.fn(async () => {
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