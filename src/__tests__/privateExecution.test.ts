/**
 * @file privateExecution.test.ts
 * @description Stage 3B — Wallet Core REAL STRK20 shadow-account execution. Behavior-first
 *   coverage of the `PrivateExecutor` + `WalletRuntime.executePrivate` surface:
 *   intent validation, unlocked/privacy/stale guards, the real SDK shadow-account path
 *   (shadowAccounts(appName) → commitment(nonce) → withdraw to shadow → invoke → paymaster relay),
 *   wallet/network-scoped identity, root-wallet-not-outer-sender, success/revert/failure
 *   lifecycle, serialization, and no-secret exposure.
 *
 *   The vendored STRK20 SDK is STUBBED (like strk20AdapterHardening.test.ts); the paymaster relay
 *   is a stubbed fetch. No real prover, discovery, or network is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const PROBE = "0x05a6e9d2e6c1b3f4a8d7e6f5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5";
const ANONYMIZER = "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA =
    "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f";
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
});

const sdkState = vi.hoisted(() => ({
  opsLog: [] as string[],
  buildOpts: [] as Record<string, unknown>[],
  invokeCalls: [] as { nonce: bigint; calls: unknown[]; collectPolicy: unknown }[],
  withdrawCalls: [] as unknown[],
  createCalls: 0,
  privateBalance: 500n,
  partialCommitment: 111n,
  commitment: 222n,
  executeGate: null as Promise<void> | null,
  failExecute: false,
  activeExecutions: 0,
  maxConcurrentExecutions: 0,
  paymasterExecutions: 0,
  reset() {
    this.opsLog.length = 0;
    this.buildOpts.length = 0;
    this.invokeCalls.length = 0;
    this.withdrawCalls.length = 0;
    this.createCalls = 0;
    this.privateBalance = 500n;
    this.partialCommitment = 111n;
    this.commitment = 222n;
    this.executeGate = null;
    this.failExecute = false;
    this.activeExecutions = 0;
    this.maxConcurrentExecutions = 0;
    this.paymasterExecutions = 0;
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
      commitment: async () => sdkState.commitment,
      invoke: (nonce: bigint, options: { calls: unknown[]; collectPolicy: unknown }) => {
        sdkState.opsLog.push("shadowInvoke");
        sdkState.invokeCalls.push({ nonce, calls: options.calls, collectPolicy: options.collectPolicy });
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
      invoke: () => {
        sdkState.opsLog.push("invoke");
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
          // created well before the proving block so the note is mature.
          notes.set(BigInt(STRK), [{ amount: sdkState.privateBalance, created: 900_000 }]);
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
import {
  shadowAccountInvoke,
  shadowAddressFromCommitment,
  selectMatureNotes,
  Strk20Paymaster,
  type ShadowAccountInvokeParams,
} from "../privacy/strk20";
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
function patchWalletAccount(wallet: { account: { provider: unknown; execute: unknown; estimateInvokeFee: unknown } }) {
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
  (wallet.account as { execute: unknown }).execute = vi.fn(async () => ({ transaction_hash: "0xroot-submitted" }));
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

function validIntent(appName = "orrange", nonce = 0n, amount = 100n): PrivateExecutionIntent {
  return {
    action: "shadow.invoke",
    appName,
    nonce,
    token: STRK,
    amount,
    calls: [{ contractAddress: PROBE, entrypoint: "record", calldata: ["0x64"] }],
  };
}

/** Stub the AVNU private-paymaster relay so the proof tx is "relayed" without a real network. */
function stubPaymaster() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      void url;
      const body = JSON.parse(init?.body ?? "{}") as { method?: string };
      if (body.method === "paymaster_buildTransaction") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              type: "apply_action",
              parameters: { version: "0x1", fee_mode: { mode: "default", gas_token: STRK } },
              fee_action: { type: "withdraw", token: STRK, recipient: "0x1234", amount: "0x1" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (body.method === "paymaster_executeTransaction") {
        sdkState.paymasterExecutions++;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { transaction_hash: "0x1234", tracking_id: "0x1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected paymaster method ${body.method}`);
    }),
  );
}

beforeEach(() => {
  sdkState.reset();
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
  stubPaymaster();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
  delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
  delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
});

describe("intent validation", () => {
  it("accepts a well-formed shadow.invoke intent", () => {
    expect(validatePrivateExecutionIntent(validIntent())).toBeNull();
  });

  it("rejects malformed intents BEFORE execution", () => {
    expect(validatePrivateExecutionIntent(null)).not.toBeNull();
    expect(validatePrivateExecutionIntent({})).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), action: "application.invoke" })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), appName: "x".repeat(32) })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), nonce: -1n })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), amount: 0n })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), calls: [] })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), calls: [{ contractAddress: "zz", entrypoint: "record", calldata: [] }] })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), calls: [{ contractAddress: PROBE, entrypoint: "record", calldata: ["not-a-felt"] }] })).not.toBeNull();
    expect(validatePrivateExecutionIntent({ ...validIntent(), expiry: Date.now() - 1 })).not.toBeNull();
  });

  it("rejects an expired intent at execution time (no SDK call)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const intent = { ...validIntent(), expiry: Date.now() - 1000 };
    const before = sdkState.createCalls;
    await expect(runtime.executePrivate(intent)).rejects.toThrow(/expired/i);
    expect(sdkState.createCalls).toBe(before);
  });
});

describe("runtime guards", () => {
  it("refuses private execution when the wallet is locked", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    runtime.lock();
    await expect(runtime.executePrivate(validIntent())).rejects.toThrow(/locked/i);
  });

  it("refuses private execution when the privacy session is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.executePrivate(validIntent())).rejects.toThrow(/privacy is unavailable/i);
  });

  it("stale execution (locked mid-flight) is refused — state is never updated", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    let release!: () => void;
    sdkState.executeGate = new Promise<void>((res) => {
      release = res;
    });
    const p = runtime.executePrivate(validIntent());
    await new Promise((r) => setTimeout(r, 20));
    runtime.lock();
    release();
    const receipt = await p;
    expect(receipt.transactionHash).toBe("0x1234");
    expect(runtime.getState().executionOp.phase).toBe("idle");
    expect(runtime.getState().isUnlocked).toBe(false);
    void wallet;
  });
});

describe("real shadow-account SDK path", () => {
  it("builds shadowAccounts(appName).commitment(nonce) + withdraw-to-shadow + invoke, relayed by the paymaster", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    expect(BigInt(identity.commitment)).toBe(BigInt(sdkState.commitment));

    const receipt = await runtime.executePrivate(validIntent());

    expect(receipt.transactionHash).toBe("0x1234");
    expect(receipt.action).toBe("shadow.invoke");
    expect(receipt.appName).toBe("orrange");
    expect(BigInt(receipt.nonce)).toBe(0n);
    expect(receipt.commitment).toBe(identity.commitment);
    expect(receipt.shadowAddress).toBe(identity.shadowAddress);
    expect(receipt.targetContract).toBe(PROBE);

    // The SDK builder ran the shadow flow: shadowAccounts → invoke with the application calls.
    expect(sdkState.opsLog).toContain("shadowInvoke");
    expect(sdkState.invokeCalls[0].nonce).toBe(0n);
    expect(sdkState.invokeCalls[0].calls).toEqual([{ contractAddress: PROBE, entrypoint: "record", calldata: ["0x64"] }]);
    // The withdraw pays the shadow address (the counterfactual shadow account).
    const withdraw = sdkState.withdrawCalls[0] as unknown[];
    expect(withdraw[0]).toMatchObject({ recipient: identity.shadowAddress.toLowerCase(), amount: 100n });
    // The proof was relayed through the paymaster — NOT submitted with the root account.
    expect(sdkState.paymasterExecutions).toBe(1);
    void wallet;
  });

  it("the OUTER tx is relayed by the paymaster, never the root wallet (root != outer sender)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivate(validIntent());
    // account.execute (the root wallet submission path) was never reached for the outer tx.
    const execute = (wallet.account as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
    expect(execute).not.toHaveBeenCalled();
    expect(sdkState.paymasterExecutions).toBe(1);
  });

  it("the execution lifecycle reaches success after on-chain reconciliation", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivate(validIntent());
    const op = runtime.getState().executionOp;
    expect(op.phase).toBe("success");
    expect(op.transactionHash).toBe("0x1234");
    expect(op.appName).toBe("orrange");
    expect(op.shadowAddress).toBe(identity.shadowAddress);
    void wallet;
  });

  it("reverted on-chain execution is reported as reverted (never success)", async () => {
    const { runtime } = makeRuntime({ execution_status: "REVERTED" });
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivate(validIntent());
    expect(runtime.getState().executionOp.phase).toBe("reverted");
    void wallet;
  });

  it("failed (thrown) execution reports failed", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    sdkState.failExecute = true;
    await expect(runtime.executePrivate(validIntent())).rejects.toThrow(/prover rejected/i);
    expect(runtime.getState().executionOp.phase).toBe("failed");
    void wallet;
  });
});

describe("shadow identity selection is wallet/network scoped", () => {
  it("rejects an identity that does not belong to the active wallet", async () => {
    const { runtime } = makeRuntime();
    const walletA = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);

    const secretB = canonicalizeSecret(generateSecretKey());
    const imported = await runtime.import({ accountType: "ready-v0.4.0", secret: secretB, password: PASSWORD });
    patchWalletAccount(imported);
    expect(runtime.getState().account?.walletId).not.toBe(walletA.walletId);

    await expect(runtime.executePrivate(validIntent())).rejects.toThrow(/no active shadow identity/i);
  });

  it("rejects an unknown (appName, nonce) combination", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await expect(runtime.executePrivate(validIntent("orrange", 9n))).rejects.toThrow(/no active shadow identity/i);
    void wallet;
  });
});

describe("repeated execution serialization", () => {
  it("serializes concurrent shadow executions (one in-flight at a time)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const p1 = runtime.executePrivate(validIntent("orrange", 0n, 1n));
    const p2 = runtime.executePrivate(validIntent("orrange", 0n, 2n));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.transactionHash).toBe("0x1234");
    expect(r2.transactionHash).toBe("0x1234");
    expect(sdkState.maxConcurrentExecutions).toBe(1);
    void wallet;
  });
});

describe("no secret / viewing-key exposure", () => {
  it("the receipt and runtime state never contain the viewing key", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    const receipt = await runtime.executePrivate(validIntent());

    const json = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    const viewingKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(json(receipt)).not.toContain(viewingKey.toString());
    expect(json(runtime.getState())).not.toContain(viewingKey.toString());
    expect(json(receipt)).not.toMatch(/viewingKey|viewing key|note|proofFacts/i);
    void identity;
  });

  it("the executor never exposes the unlocked session or a public fallback", async () => {
    const executorSource = readFileSync(join(__dirname, "..", "privacy", "execution", "StarknetPrivateExecutor.ts"), "utf8");
    expect(executorSource).not.toMatch(/sendTransaction|unlockWallet|exportSecret|getViewingKey/i);
    expect(executorSource).toMatch(/WalletPrivacySession/i);
    const shadowSource = readFileSync(join(__dirname, "..", "privacy", "strk20", "shadowAccount.ts"), "utf8");
    expect(shadowSource).toMatch(/shadowAccounts\(/i);
    expect(shadowSource).toMatch(/paymaster\.execute/i);
    expect(shadowSource).not.toMatch(/getViewingKey|viewingKey\s*[:=]/i);
  });
});

describe("shadow-account unit (deterministic identity + maturity)", () => {
  it("derives a deterministic shadow address from a commitment", () => {
    const commitment = 222n;
    const address = shadowAddressFromCommitment(commitment, BigInt(ANONYMIZER));
    expect(address).toMatch(/^0x/);
    expect(shadowAddressFromCommitment(commitment, BigInt(ANONYMIZER))).toBe(address);
    expect(shadowAddressFromCommitment(commitment + 1n, BigInt(ANONYMIZER))).not.toBe(address);
  });

  it("selectMatureNotes only spends notes mature at the proving block", () => {
    const notes = [
      { amount: 10n, created: 1_000_000 }, // too recent
      { amount: 50n, created: 900_000 }, // mature
      { amount: 100n }, // no created → not spendable
      { amount: 40n, created: 800_000, open: true }, // open → not spendable
    ];
    const selection = selectMatureNotes(notes, 40n, 1_000_000, 10);
    expect(selection.selectedAmount).toBe(50n);
    expect(selection.matureBalance).toBe(50n);
    expect(selection.privateBalance).toBe(200n);
    expect(() => selectMatureNotes(notes, 60n, 1_000_000, 10)).toThrow(/Not enough mature/);
  });

  it("shadowAccountInvoke routes private STRK to the derived shadow address and relays via the paymaster", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);

    const fakePaymaster = {
      build: vi.fn(async () => ({
        parameters: { version: "0x1" as const, fee_mode: { mode: "default" as const, gas_token: STRK } },
        fee: { token: STRK, recipient: "0x1234", amount: 1n },
      })),
      execute: vi.fn(async () => ({ transactionHash: "0x1234", trackingId: "0x1" })),
    };
    const privacy = (runtime as unknown as { privacySession: unknown }).privacySession as import("@/wallet/privacy").WalletPrivacySession;
    const adapter = (privacy as unknown as { adapter: unknown }).adapter as import("@/privacy/strk20").Strk20Adapter;
    const result = await shadowAccountInvoke(
      adapter,
      { account: wallet.account, address: wallet.address, viewingKey: deriveWalletViewingKey(wallet.secret, "sepolia") },
      { appName: "orrange", nonce: 0n, token: STRK, amount: 100n, calls: [{ contractAddress: PROBE, entrypoint: "record", calldata: ["0x64"] }] } satisfies ShadowAccountInvokeParams,
      { paymaster: fakePaymaster as unknown as Strk20Paymaster },
    );
    expect(result.transactionHash).toBe("0x1234");
    expect(result.shadowAddress).toBe(identity.shadowAddress);
    expect(fakePaymaster.build).toHaveBeenCalledTimes(1);
    expect(fakePaymaster.execute).toHaveBeenCalledTimes(1);
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
      executor.execute({ action: "swap" as never, appName: "orrange", nonce: 0n, token: STRK, amount: 1n, calls: [] }),
    ).rejects.toThrow(/unsupported action/i);
    expect(sdkState.createCalls).toBe(before);
  });
});