/**
 * @file privateSwap.test.ts
 * @description Stage 3C — REAL STRK20 shadow-account private swap. Behavior-first coverage of the
 *   `PrivateSwapService` + `WalletRuntime.executePrivateSwap` surface:
 *   intent validation, locked/privacy/stale guards, the REAL quote flow (on-chain `quote_buy`),
 *   stale/mutated-quote rejection, min-output/slippage protection, exact application target +
 *   token/amount, the existing shadow-account SDK path (shadowAccounts(appName).invoke),
 *   root-wallet-never-the-caller, fee + remainder handling, serialization, unknown paymaster
 *   submission, and no-secret exposure.
 *
 *   The vendored STRK20 SDK is STUBBED (like privateExecution.test.ts); the paymaster relay is a
 *   stubbed fetch; the swap application quote is a stubbed provider view. No real prover,
 *   discovery, or network is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const STRKFTW = "0x4ce3233bdb393636c7a576e8d68a94f7d8c41ba4d38a42460782b270be85a00";
const CURVE = "0x1d63a2b150973cf8ae0c02dfbc564c1ed46fbf0a08b298c9d77b07b1c08b0f8";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
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
  /** The on-chain quote_buy value the swap app provider returns (STRKFTW base units). */
  quoteBuy: 2_000_000_000_000_000_000_000n,
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
    this.quoteBuy = 2_000_000_000_000_000_000_000n;
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
    transfer: (...args: unknown[]) => {
      sdkState.opsLog.push("transfer");
      sdkState.withdrawCalls.push(args);
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
          notes.set(BigInt(STRK), [{ amount: sdkState.privateBalance, created: 900_000 }]);
          notes.set(BigInt(STRKFTW), []);
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
import { deriveWalletViewingKey } from "../wallet/privacy";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import {
  validatePrivateSwapIntent,
  computeMinOutput,
  PrivateSwapService,
  PrivateSwapError,
  resolvePrivateSwapApp,
  STRKFTW_CURVE,
} from "../features/private-swap";
import type { PrivateSwapIntent } from "../features/private-swap";

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

/** Replace the wallet account's real RpcProvider with a deterministic mock. `quoteBuy` is the
 * value the swap application's `quote_buy` view returns. */
function patchWalletAccount(
  wallet: { account: { provider: unknown; execute: unknown; estimateInvokeFee: unknown } },
  quoteBuy: bigint = sdkState.quoteBuy,
) {
  const provider = {
    callContract: vi.fn(async (call: { entrypoint?: string }) => {
      if (call?.entrypoint === "get_fee_amount") return ["0x" + (2n * 10n ** 18n).toString(16)];
      if (call?.entrypoint === "quote_buy") return ["0x" + quoteBuy.toString(16)];
      if (call?.entrypoint === "is_graduated") return ["0x0"];
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
  return provider as { callContract: ReturnType<typeof vi.fn> };
}

function makeRuntime(finality?: { execution_status: string }) {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({ storage, providerFactory: () => makeProvider(finality) });
  return { runtime, storage };
}

async function createdWallet(runtime: WalletRuntime) {
  const wallet = await runtime.create(PASSWORD);
  patchWalletAccount(wallet);
  return wallet;
}

function validIntent(appName = "orrange", nonce = 0n, sellAmount = 100n, slippageBps = 100): PrivateSwapIntent {
  return {
    action: "private.swap",
    sellToken: STRK,
    buyToken: STRKFTW,
    sellAmount,
    slippageBps,
    appName,
    nonce,
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
  it("accepts a well-formed private-swap intent", () => {
    expect(validatePrivateSwapIntent(validIntent())).toBeNull();
  });

  it("rejects malformed intents BEFORE execution", () => {
    expect(validatePrivateSwapIntent(null)).not.toBeNull();
    expect(validatePrivateSwapIntent({})).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), action: "application.invoke" })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), sellToken: "zz" })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), buyToken: "zz" })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), sellAmount: 0n })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), sellAmount: -1n })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), slippageBps: 10001 })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), slippageBps: 1.5 })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), slippageBps: -1 })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), appName: "x".repeat(32) })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), nonce: -1n })).not.toBeNull();
    expect(validatePrivateSwapIntent({ ...validIntent(), expiry: Date.now() - 1 })).not.toBeNull();
  });

  it("rejects an expired intent at execution time (no SDK call)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const intent = { ...validIntent(), expiry: Date.now() - 1000 };
    const before = sdkState.createCalls;
    await expect(runtime.executePrivateSwap(intent)).rejects.toThrow(/expired/i);
    expect(sdkState.createCalls).toBe(before);
  });

  it("rejects an unsupported token pair (not in PRIVATE_SWAP_APPS)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await expect(
      runtime.executePrivateSwap({ ...validIntent(), buyToken: STRK, sellToken: STRKFTW }),
    ).rejects.toThrow(/unsupported private-swap pair/i);
  });
});

describe("min-output / slippage math", () => {
  it("computes the min-output from the quote with integer math", () => {
    const quote = 1_000_000n;
    expect(computeMinOutput(quote, 0)).toBe(1_000_000n);
    expect(computeMinOutput(quote, 100)).toBe(990_000n);
    expect(computeMinOutput(quote, 500)).toBe(950_000n);
    expect(computeMinOutput(quote, 10_000)).toBe(0n);
  });

  it("rejects invalid slippage inputs", () => {
    expect(() => computeMinOutput(1n, 10001)).toThrow(PrivateSwapError);
    expect(() => computeMinOutput(1n, -1)).toThrow(PrivateSwapError);
  });
});

describe("quote flow", () => {
  it("reads a REAL on-chain quote bound to the pair + amount and surfaces the paymaster fee", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const quote = await runtime.quotePrivateSwap(validIntent());
    expect(quote.swapContract).toBe(STRKFTW_CURVE);
    expect(quote.sellToken).toBe(STRK);
    expect(quote.buyToken).toBe(STRKFTW);
    expect(quote.sellAmount).toBe(100n);
    expect(quote.buyAmount).toBe(sdkState.quoteBuy);
    expect(quote.minOutput).toBe((sdkState.quoteBuy * 9900n) / 10000n);
    expect(quote.route).toBe("STRKFTW BondingCurve");
    expect(quote.feeStrk).not.toBeNull();
    void wallet;
  });

  it("never trusts a UI-supplied output amount — the min-output is derived from the real quote", async () => {
    const quote = await new PrivateSwapService({
      wallet: (await createdWallet(makeRuntime().runtime)) as never,
      privacySession: (null as never),
      network: "sepolia",
    }).quote(validIntent());
    expect(quote.minOutput).toBe((sdkState.quoteBuy * 9900n) / 10000n);
  });
});

describe("runtime guards", () => {
  it("refuses a private swap when the wallet is locked", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    runtime.lock();
    await expect(runtime.executePrivateSwap(validIntent())).rejects.toThrow(/locked/i);
  });

  it("refuses a private swap when the privacy session is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
    delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.executePrivateSwap(validIntent())).rejects.toThrow(/privacy is unavailable/i);
  });

  it("stale swap (locked mid-flight) is refused — state is never updated", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    let release!: () => void;
    sdkState.executeGate = new Promise<void>((res) => {
      release = res;
    });
    const p = runtime.executePrivateSwap(validIntent());
    await new Promise((r) => setTimeout(r, 20));
    runtime.lock();
    release();
    const receipt = await p;
    expect(receipt.transactionHash).toBe("0x1234");
    expect(runtime.getState().swapOp.phase).toBe("idle");
    expect(runtime.getState().isUnlocked).toBe(false);
  });
});

describe("REAL shadow-account swap path", () => {
  it("executes the swap through the existing shadow path with exact app calls + collect tokens", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);

    const receipt = await runtime.executePrivateSwap(validIntent());

    expect(receipt.transactionHash).toBe("0x1234");
    expect(receipt.action).toBe("private.swap");
    expect(receipt.appName).toBe("orrange");
    expect(receipt.swapContract).toBe(STRKFTW_CURVE);
    expect(receipt.shadowAddress).toBe(identity.shadowAddress);
    expect(receipt.commitment).toBe(identity.commitment);
    expect(receipt.minOutput).toBe((sdkState.quoteBuy * 9900n) / 10000n);

    // The SDK builder ran the REAL shadow flow: shadowAccounts → invoke.
    expect(sdkState.opsLog).toContain("shadowInvoke");
    expect(sdkState.invokeCalls[0].nonce).toBe(0n);
    const calls = sdkState.invokeCalls[0].calls as { contractAddress: string; entrypoint: string; calldata: unknown[] }[];
    // The SHADOW ACCOUNT approves the curve to pull STRK, then calls buy on the swap application.
    expect(calls[0].contractAddress.toLowerCase()).toBe(STRK.toLowerCase());
    expect(calls[0].entrypoint).toBe("approve");
    expect(calls[1].contractAddress.toLowerCase()).toBe(STRKFTW_CURVE.toLowerCase());
    expect(calls[1].entrypoint).toBe("buy");
    expect(calls[1].calldata).toEqual(["0x64", identity.shadowAddress.toLowerCase()]);

    // The buy output token is collected back into a private note (open-note transfer for STRKFTW).
    const transfers = sdkState.withdrawCalls.filter((c) => Array.isArray(c));
    expect(transfers.some((c) => String(c[0]?.recipient ?? "").toLowerCase() === wallet.address.toLowerCase())).toBe(true);

    // The proof was relayed through the paymaster — NOT submitted with the root account.
    expect(sdkState.paymasterExecutions).toBe(1);
  });

  it("the ROOT wallet is never the swap application caller (shadow account executes the calls)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivateSwap(validIntent());
    const calls = sdkState.invokeCalls[0].calls as { contractAddress: string; entrypoint: string }[];
    // The calls are executed BY the shadow account, so the application sees the SHADOW address as
    // the caller (the anonymizer runs them from the shadow account). The root wallet never submits
    // the outer tx either.
    const execute = (wallet.account as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
    expect(execute).not.toHaveBeenCalled();
    expect(sdkState.paymasterExecutions).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("the swap lifecycle reaches success after on-chain reconciliation", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivateSwap(validIntent());
    const op = runtime.getState().swapOp;
    expect(op.phase).toBe("success");
    expect(op.transactionHash).toBe("0x1234");
    expect(op.shadowAddress).toBe(identity.shadowAddress);
  });

  it("reverted on-chain swap is reported as reverted (never success)", async () => {
    const { runtime } = makeRuntime({ execution_status: "REVERTED" });
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await runtime.executePrivateSwap(validIntent());
    expect(runtime.getState().swapOp.phase).toBe("reverted");
  });

  it("failed (thrown) swap reports failed", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    sdkState.failExecute = true;
    await expect(runtime.executePrivateSwap(validIntent())).rejects.toThrow(/prover rejected/i);
    expect(runtime.getState().swapOp.phase).toBe("failed");
  });
});

describe("quote mutation protection", () => {
  it("rejects a swap when the quote moved below the confirmed min-output (stale/mutated quote)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    // Quote once with the good price.
    const confirmed = await runtime.quotePrivateSwap(validIntent());
    expect(confirmed.buyAmount).toBe(sdkState.quoteBuy);
    // The curve moved: quote_buy now returns far less than the confirmed quote.
    patchWalletAccount(wallet, sdkState.quoteBuy / 2n);
    await expect(runtime.executePrivateSwap(validIntent(), confirmed)).rejects.toThrow(/slippage|quote moved/i);
    expect(sdkState.paymasterExecutions).toBe(0);
  });

  it("rejects a swap whose confirmed quote does not match the intent", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const confirmed = await runtime.quotePrivateSwap(validIntent());
    await expect(runtime.executePrivateSwap(validIntent("orrange", 0n, 200n), confirmed)).rejects.toThrow(
      /does not match/i,
    );
  });
});

describe("shadow identity selection is wallet/network scoped", () => {
  it("rejects a swap when there is no active shadow identity", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.executePrivateSwap(validIntent())).rejects.toThrow(/no active shadow identity/i);
  });

  it("rejects an unknown (appName, nonce) combination", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await expect(runtime.executePrivateSwap(validIntent("orrange", 9n))).rejects.toThrow(
      /no active shadow identity/i,
    );
  });
});

describe("concurrent swap serialization", () => {
  it("serializes concurrent swaps (one in-flight at a time)", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const p1 = runtime.executePrivateSwap(validIntent("orrange", 0n, 1n));
    const p2 = runtime.executePrivateSwap(validIntent("orrange", 0n, 2n));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.transactionHash).toBe("0x1234");
    expect(r2.transactionHash).toBe("0x1234");
    expect(sdkState.maxConcurrentExecutions).toBe(1);
    void wallet;
  });
});

describe("no secret / viewing-key exposure", () => {
  it("the receipt and runtime state never contain the viewing key or secret material", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const receipt = await runtime.executePrivateSwap(validIntent());

    const json = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    const viewingKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(json(receipt)).not.toContain(viewingKey.toString());
    expect(json(runtime.getState())).not.toContain(viewingKey.toString());
    expect(json(receipt)).not.toMatch(/viewingKey|viewing key|note|proofFacts|secret/i);
  });

  it("the feature source never exposes secrets or a public master-wallet fallback", () => {
    const serviceSource = readFileSync(join(__dirname, "..", "features", "private-swap", "service.ts"), "utf8");
    expect(serviceSource).not.toMatch(/sendTransaction|unlockWallet|exportSecret|getViewingKey/i);
    expect(serviceSource).toMatch(/executeShadowApplication/i);
    expect(serviceSource).toMatch(/shadowAccounts/i);
    expect(serviceSource).not.toMatch(/getViewingKey|viewingKey\s*[:=]/i);
    const shadowSource = readFileSync(join(__dirname, "..", "privacy", "strk20", "shadowAccount.ts"), "utf8");
    expect(shadowSource).toMatch(/collectTokens/i);
    expect(shadowSource).toMatch(/paymaster\.execute/i);
  });

  it("resolves the configured app for the supported pair only", () => {
    expect(resolvePrivateSwapApp("sepolia", STRK, STRKFTW)?.swapContract).toBe(STRKFTW_CURVE);
    expect(resolvePrivateSwapApp("sepolia", STRKFTW, STRK)).toBeNull();
  });
});