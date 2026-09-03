/**
 * @file privateExecution.test.ts
 * @description Phase 1 — Wallet Core private execution primitive. Behavior-first coverage of the
 *   `PrivateExecutor` domain layer + `WalletRuntime.executePrivate` surface:
 *   intent validation, unlocked-wallet + privacy-session requirements, stale rejection, the
 *   official SDK path (withdraw → privacy_invoke → surplus), wallet/network-scoped shadow
 *   identity selection, success/revert/failure lifecycle, serialization, and no-secret exposure.
 *
 *   The vendored STRK20 SDK is STUBBED (like strk20AdapterHardening.test.ts) so no real prover,
 *   discovery, or network is touched; the executor, session, and adapter code are real. The
 *   wallet account is patched after creation (the established repo pattern) because starknet.js
 *   replaces a plain-object provider with a real RpcProvider in `new Account(...)`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const PROBE = "0x05a6e9d2e6c1b3f4a8d7e6f5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5";
const ANONYMIZER = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

// The network config module reads the anonymizer env var at MODULE LOAD (NETWORKS is a module
// constant), so it must be set before any import executes. vi.hoisted runs first.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA =
    "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
});

// Hoisted state so the SDK stub can record which private-transfer ops were built and how the
// account executed them.
const sdkState = vi.hoisted(() => ({
  opsLog: [] as string[],
  buildOpts: [] as Record<string, unknown>[],
  invokeCalls: [] as { contractAddress: string; entrypoint: string; calldata: unknown[] }[],
  withdrawCalls: [] as unknown[],
  createCalls: 0,
  privateBalance: 500n,
  /** Overrides the shadow commitment values the SDK stub returns for identity derivation. */
  partialCommitment: 111n,
  commitmentNonce0: 222n,
  /** When set, builder.execute awaits this gate (used to force in-flight overlap). */
  executeGate: null as Promise<void> | null,
  /** When true, builder.execute throws (used to exercise the failed lifecycle). */
  failExecute: false,
  activeExecutions: 0,
  maxConcurrentExecutions: 0,
  reset() {
    this.opsLog.length = 0;
    this.buildOpts.length = 0;
    this.invokeCalls.length = 0;
    this.withdrawCalls.length = 0;
    this.createCalls = 0;
    this.privateBalance = 500n;
    this.partialCommitment = 111n;
    this.commitmentNonce0 = 222n;
    this.executeGate = null;
    this.failExecute = false;
    this.activeExecutions = 0;
    this.maxConcurrentExecutions = 0;
  },
}));

vi.mock("@starkware-libs/starknet-privacy-sdk", () => {
  const makeTokenOps = () => ({
    deposit: () => {
      sdkState.opsLog.push("deposit");
      return makeTokenOps();
    },
    withdraw: (...args: unknown[]) => {
      sdkState.opsLog.push("withdraw");
      sdkState.withdrawCalls.push(args);
      return makeTokenOps();
    },
    transfer: () => {
      sdkState.opsLog.push("transfer");
      return makeTokenOps();
    },
    inputs: () => {
      sdkState.opsLog.push("inputs");
      return makeTokenOps();
    },
    surplusTo: () => {
      sdkState.opsLog.push("surplusTo");
      return makeTokenOps();
    },
  });
  const makeBuilder = (opts: Record<string, unknown>) => {
    sdkState.buildOpts.push({ ...opts });
    const shadowBuilder = {
      partialCommitment: async () => sdkState.partialCommitment,
      commitment: async () => sdkState.commitmentNonce0,
      invoke: () => {
        sdkState.opsLog.push("shadowInvoke");
        return builder;
      },
    };
    const builder = {
      with: (_token: string, opFn: (t: unknown) => void) => {
        opFn(makeTokenOps());
        return builder;
      },
      register: () => {
        sdkState.opsLog.push("register");
        return builder;
      },
      surplusTo: () => {
        sdkState.opsLog.push("surplusTo");
        return builder;
      },
      invoke: (callBuilder: (args: { openNotes: { noteId: bigint }[]; withdrawals: unknown[]; poolAddress: bigint }) => unknown) => {
        sdkState.opsLog.push("invoke");
        const call = callBuilder({ openNotes: [], withdrawals: [], poolAddress: 0n }) as {
          contractAddress: string;
          entrypoint: string;
          calldata: unknown[];
        };
        sdkState.invokeCalls.push({
          contractAddress: call.contractAddress,
          entrypoint: call.entrypoint,
          calldata: call.calldata,
        });
        return builder;
      },
      shadowAccounts: () => shadowBuilder,
      simulate: async () => ({
        callAndProof: {
          call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: [] },
          proof: { proofFacts: ["0x1"], data: "0xdead" },
        },
        warnings: [],
      }),
      execute: async () => {
        sdkState.activeExecutions++;
        sdkState.maxConcurrentExecutions = Math.max(sdkState.maxConcurrentExecutions, sdkState.activeExecutions);
        if (sdkState.executeGate) await sdkState.executeGate;
        sdkState.activeExecutions--;
        if (sdkState.failExecute) throw new Error("prover rejected execution");
        return {
          callAndProof: {
            call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: [] },
            proof: { proofFacts: ["0x1"], data: "0xdead" },
          },
          warnings: [],
        };
      },
    };
    return builder;
  };
  return {
    createPrivateTransfers: (params: Record<string, unknown>) => {
      sdkState.createCalls++;
      void params;
      return {
        build: (opts: Record<string, unknown>) => makeBuilder(opts),
        discoverNotes: async () => {
          const notes = new Map();
          notes.set(BigInt(STRK), [{ amount: sdkState.privateBalance }]);
          return { timestamp: "0x1f4", notes };
        },
        discoverRequirement: async () => 3,
      };
    },
    Open: Symbol("Open"),
    IndexerDiscoveryProvider: class {
      constructor(
        public apiUrl: string,
        public contractAddress: string,
        public options?: { ohttp?: boolean | { relayUrl?: string; publicKeyConfig?: Uint8Array } },
      ) {}
    },
  };
});

import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";
import { generateSecretKey, canonicalizeSecret } from "../wallet/crypto";
import { deriveWalletViewingKey } from "../wallet/privacy";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import { validatePrivateExecutionIntent, StarknetPrivateExecutor } from "../privacy/execution";
import type { PrivateExecutionIntent } from "../privacy/execution";

const PASSWORD = "correct horse battery staple";
const VALID_SRC5 = ["0x56614c4944"];

/** Provider for the runtime's own RPC reads (deployment probe + finality). */
function makeProvider(finality?: { execution_status: string }) {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => VALID_SRC5),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(async () => finality ?? { execution_status: "SUCCEEDED", block_number: 1 }),
  } as never;
}

/** Replace the wallet account's real RpcProvider with a deterministic mock (starknet.js replaces
 * a plain-object provider in `new Account(...)`, so patching after creation is the repo pattern). */
function patchWalletAccount(wallet: {
  account: { provider: unknown; execute: unknown; estimateInvokeFee: unknown };
}) {
  const provider = {
    callContract: vi.fn(async (call: { entrypoint?: string }) => {
      if (call?.entrypoint === "get_fee_amount") return ["0x" + (2n * 10n ** 18n).toString(16)];
      return ["0xffffffffffffffffffffffffffffffff", "0x0"];
    }),
    getBlockNumber: vi.fn(async () => 1_000_000),
    getBlockWithTxHashes: vi.fn(async () => ({
      l1_gas_price: { price_in_fri: "0x10" },
      l2_gas_price: { price_in_fri: "0x20" },
      l1_data_gas_price: { price_in_fri: "0x30" },
    })),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  };
  (wallet.account as { provider: unknown }).provider = provider as never;
  (wallet.account as { estimateInvokeFee: unknown }).estimateInvokeFee = vi.fn(async () => ({
    overall_fee: 1000n,
    resourceBounds: {
      l1_gas: { max_amount: 1n, max_price_per_unit: 1n },
      l2_gas: { max_amount: 2n, max_price_per_unit: 2n },
      l1_data_gas: { max_amount: 3n, max_price_per_unit: 3n },
    },
  }));
  (wallet.account as { execute: unknown }).execute = vi.fn(async () => ({ transaction_hash: "0xsubmit" }));
}

function makeRuntime(finality?: { execution_status: string }) {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({ storage, providerFactory: () => makeProvider(finality) });
  return { runtime, storage };
}

/** Create a wallet and patch its account so the real adapter can run against the stub SDK. */
async function createdWallet(runtime: WalletRuntime) {
  const wallet = await runtime.create(PASSWORD);
  patchWalletAccount(wallet);
  return wallet;
}

function validIntent(identityId: string, amount = 100n): PrivateExecutionIntent {
  return {
    action: "application.invoke",
    token: STRK,
    amount,
    targetContract: PROBE,
    identity: identityId,
  };
}

beforeEach(() => {
  sdkState.reset();
  // Re-establish the operator env for every test (afterEach deletes them; resolveWalletPrivacyConfig
  // reads them at runtime). The anonymizer is a module-load constant and needs no re-set.
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
  delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
  delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
});

describe("intent validation", () => {
  it("accepts a well-formed application.invoke intent", () => {
    expect(validatePrivateExecutionIntent(validIntent("0x1"))).toBeNull();
  });

  it("rejects malformed intents BEFORE execution", () => {
    expect(validatePrivateExecutionIntent(null)).not.toBeNull();
    expect(validatePrivateExecutionIntent({})).not.toBeNull();
    expect(validatePrivateExecutionIntent(validIntent("0x1", 0n))).not.toBeNull();
    expect(validatePrivateExecutionIntent(validIntent("0x1", -5n))).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), action: "swap" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), token: "not-an-address" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), targetContract: "0xzz" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), identity: "abc" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), destination: "nope" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent("0x1"), expiry: Date.now() - 1 })).not.toBeNull();
  });

  it("rejects an expired intent at execution time (no SDK call)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    const intent = { ...validIntent(identity.id), expiry: Date.now() - 1000 };
    const before = sdkState.createCalls;
    await expect(runtime.executePrivate(intent)).rejects.toThrow(/expired/i);
    // No SDK context was even built — the malformed/expired intent is rejected first.
    expect(sdkState.createCalls).toBe(before);
  });
});

describe("runtime guards", () => {
  it("refuses private execution when the wallet is locked", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    runtime.lock();
    await expect(runtime.executePrivate(validIntent("0x1"))).rejects.toThrow(/locked/i);
  });

  it("refuses private execution when the privacy session is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.executePrivate(validIntent("0x1"))).rejects.toThrow(/privacy is unavailable/i);
  });

  it("stale execution (locked mid-flight) is refused — state is never updated", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    // Force the SDK execute to stay in-flight until we lock the wallet.
    let release!: () => void;
    sdkState.executeGate = new Promise<void>((res) => {
      release = res;
    });
    const p = runtime.executePrivate(validIntent(identity.id));
    // Let the execution reach the SDK stage before locking.
    await new Promise((r) => setTimeout(r, 20));
    runtime.lock();
    release();
    const receipt = await p;
    expect(receipt.transactionHash).toBe("0xsubmit");
    // Lock resets executionOp to idle and the stale update is ignored.
    expect(runtime.getState().executionOp.phase).toBe("idle");
    expect(runtime.getState().isUnlocked).toBe(false);
    void wallet;
  });
});

describe("private execution calls the official STRK20 SDK path", () => {
  it("runs withdraw → privacy_invoke → surplusTo with the shadow identity commitment", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    expect(BigInt(identity.commitmentNonce0)).toBe(BigInt(sdkState.commitmentNonce0));

    const receipt = await runtime.executePrivate(validIntent(identity.id, 100n));

    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(receipt.status).toBe("PENDING");
    expect(receipt.action).toBe("application.invoke");
    expect(receipt.token).toBe(STRK);
    expect(receipt.amount).toBe(100n);
    expect(receipt.targetContract).toBe(PROBE);
    expect(receipt.identityId).toBe(identity.id);
    expect(receipt.executionId).toBe(identity.commitmentNonce0);

    // The SDK builder ran twice (simulate + execute); each pass is withdraw → invoke → surplusTo.
    expect(sdkState.opsLog.filter((op) => op === "withdraw")).toHaveLength(2);
    expect(sdkState.opsLog.filter((op) => op === "invoke")).toHaveLength(2);
    expect(sdkState.opsLog.filter((op) => op === "surplusTo")).toHaveLength(2);
    // The invoke targets the application contract's privacy_invoke selector with the shadow
    // identity commitment as the first calldata felt — never the master wallet.
    const invoke = sdkState.invokeCalls[0];
    expect(invoke.contractAddress).toBe(PROBE);
    expect(invoke.entrypoint).toBe("privacy_invoke");
    expect(BigInt(invoke.calldata[0] as string)).toBe(BigInt(identity.commitmentNonce0));
    // The withdraw pays the application (the private balance "causes" the app action).
    const withdraw = sdkState.withdrawCalls[0] as unknown[];
    expect(withdraw[0]).toMatchObject({ recipient: PROBE, amount: 100n });
    void wallet;
  });

  it("the execution lifecycle reaches success after on-chain reconciliation", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    await runtime.executePrivate(validIntent(identity.id));
    const op = runtime.getState().executionOp;
    expect(op.phase).toBe("success");
    expect(op.transactionHash).toBe("0xsubmit");
    expect(op.action).toBe("application.invoke");
    expect(op.targetContract).toBe(PROBE);
    expect(op.identityId).toBe(identity.id);
    void wallet;
  });

  it("reverted on-chain execution is reported as reverted (never success)", async () => {
    const { runtime } = makeRuntime({ execution_status: "REVERTED" });
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    await runtime.executePrivate(validIntent(identity.id));
    expect(runtime.getState().executionOp.phase).toBe("reverted");
    void wallet;
  });

  it("failed (thrown) execution reports failed", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    sdkState.failExecute = true;
    await expect(runtime.executePrivate(validIntent(identity.id))).rejects.toThrow(/prover rejected/i);
    expect(runtime.getState().executionOp.phase).toBe("failed");
    void wallet;
  });

  it("never falls back to a public Wallet Core transaction path", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    await runtime.executePrivate(validIntent(identity.id));
    // The ONLY SDK contexts created are STRK20 private-transfers contexts (identity + execute);
    // the wallet's public `send()` path was never used (account.execute is only reached by the
    // STRK20 adapter submit), and the activity is labeled as a private op, never public.
    expect(sdkState.createCalls).toBeGreaterThanOrEqual(2);
    const kinds = runtime.getState().recentTransactions.map((t) => t.kind);
    expect(kinds).not.toContain("public");
    void wallet;
  });
});

describe("shadow identity selection is wallet/network scoped", () => {
  it("rejects an identity that does not belong to the active wallet", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    const identityA = await runtime.createPrivateIdentity("acceptance");

    // Import a second wallet and switch to it; the execution must be refused because identityA
    // belongs to walletA, not the active wallet.
    const secretB = canonicalizeSecret(generateSecretKey());
    const imported = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });
    patchWalletAccount(imported);
    expect(runtime.getState().account?.walletId).not.toBe(walletA.walletId);

    await expect(runtime.executePrivate(validIntent(identityA.id))).rejects.toThrow(/no active private identity/i);
  });

  it("rejects an unknown/inactive identity id", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createPrivateIdentity("acceptance");
    await expect(runtime.executePrivate(validIntent("0x9999999999999999999999999999999999999999999999999999999999999999"))).rejects.toThrow(
      /no active private identity/i,
    );
    void wallet;
  });

  it("the executor resolves the identity scoped to the session wallet + network", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    const receipt = await runtime.executePrivate(validIntent(identity.id));
    // The app received the wallet/network-scoped shadow commitment.
    expect(receipt.executionId).toBe(identity.commitmentNonce0);
    void wallet;
  });
});

describe("repeated execution serialization", () => {
  it("serializes concurrent private executions (one in-flight at a time)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    const p1 = runtime.executePrivate(validIntent(identity.id, 1n));
    const p2 = runtime.executePrivate(validIntent(identity.id, 2n));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.transactionHash).toBe("0xsubmit");
    expect(r2.transactionHash).toBe("0xsubmit");
    // The session mutex means the SDK execute never overlaps.
    expect(sdkState.maxConcurrentExecutions).toBe(1);
    void wallet;
  });
});

describe("no secret / viewing-key exposure", () => {
  it("the receipt and runtime state never contain the viewing key", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createPrivateIdentity("acceptance");
    const receipt = await runtime.executePrivate(validIntent(identity.id));

    const json = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    const viewingKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(json(receipt)).not.toContain(viewingKey.toString());
    expect(json(runtime.getState())).not.toContain(viewingKey.toString());
    expect(json(receipt)).not.toMatch(/viewingKey|viewing key|note|proofFacts/i);
    void identity;
  });

  it("the executor never exposes the unlocked session", async () => {
    // Architectural: the executor + application module must not import wallet custody internals.
    const executorSource = readFileSync(join(__dirname, "..", "privacy", "execution", "StarknetPrivateExecutor.ts"), "utf8");
    expect(executorSource).not.toMatch(/sendTransaction|unlockWallet|exportSecret|getViewingKey/i);
    expect(executorSource).toMatch(/WalletPrivacySession/i);
    const appSource = readFileSync(join(__dirname, "..", "privacy", "strk20", "privateApplication.ts"), "utf8");
    expect(appSource).not.toMatch(/getViewingKey|viewingKey\s*[:=]/i);
  });
});

describe("StarknetPrivateExecutor (domain unit)", () => {
  it("rejects a malformed intent before any adapter work", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const privacy = (runtime as unknown as { privacySession: unknown }).privacySession as import("@/wallet/privacy").WalletPrivacySession;
    const executor = new StarknetPrivateExecutor({ wallet, privacySession: privacy });
    const before = sdkState.createCalls;
    await expect(
      executor.execute({ action: "swap" as never, token: STRK, amount: 1n, targetContract: PROBE, identity: "0x1" }),
    ).rejects.toThrow(/unsupported action/i);
    expect(sdkState.createCalls).toBe(before);
  });
});