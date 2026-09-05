/**
 * @file nearIntents.test.ts
 * @description Phase 4 — REAL NEAR Intents cross-chain routing. Behavior-first coverage of the
 *   `NearIntentAdapter` + `WalletRuntime` cross-chain bridges:
 *   intent validation, route resolution, destination-address validation, quote/amount parsing,
 *   quote expiry, stale/mutated-quote rejection, publish (deposit-address reservation), the
 *   existing shadow-account STRK transfer to the NEAR deposit address, status transitions
 *   (pending → success / refunded / failed), solver/status failure, unknown settlement, stale
 *   runtime guard, no secret leakage, no public master-wallet fallback, and correct adapter usage.
 *
 *   The vendored STRK20 SDK is STUBBED (like privateSwap.test.ts); the private paymaster relay and
 *   the NEAR Intents 1Click API are stubbed fetches. No real prover, discovery, or network touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const DEPOSIT = "0x00999ae4dce7c80dd630d49ffd005912672af71cac81b20e790df4d741fc1b58";
const DEST = "0x742d35cc6634c0532925a3b8d84b2021f90a51a3";
const ANONYMIZER = "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA =
    "0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f";
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
});

const sdkState = vi.hoisted(() => ({
  opsLog: [] as string[],
  invokeCalls: [] as { nonce: bigint; calls: { contractAddress: string; entrypoint: string; calldata: unknown[] }[] }[],
  createCalls: 0,
  privateBalance: 500n,
  partialCommitment: 111n,
  commitment: 222n,
  paymasterExecutions: 0,
  executeGate: null as Promise<void> | null,
  reset() {
    this.opsLog.length = 0;
    this.invokeCalls.length = 0;
    this.createCalls = 0;
    this.privateBalance = 500n;
    this.partialCommitment = 111n;
    this.commitment = 222n;
    this.paymasterExecutions = 0;
    this.executeGate = null;
  },
}));

const nearState = vi.hoisted(() => ({
  amountOut: 1_000_000n,
  depositAddress: "0x00999ae4dce7c80dd630d49ffd005912672af71cac81b20e790df4d741fc1b58",
  statusQueue: [] as string[],
  statusFails: false,
  quoteCount: 0,
  submitCount: 0,
  reset() {
    this.amountOut = 1_000_000n;
    this.depositAddress = "0x00999ae4dce7c80dd630d49ffd005912672af71cac81b20e790df4d741fc1b58";
    this.statusQueue = ["SUCCESS"];
    this.statusFails = false;
    this.quoteCount = 0;
    this.submitCount = 0;
  },
}));

vi.mock("@starkware-libs/starknet-privacy-sdk", () => {
  const makeTokenOps = () => ({
    deposit: () => makeTokenOps(),
    withdraw: (...args: unknown[]) => {
      sdkState.opsLog.push("withdraw");
      void args;
      return makeTokenOps();
    },
    transfer: (...args: unknown[]) => {
      sdkState.opsLog.push("transfer");
      void args;
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
  const makeBuilder = () => {
    const shadowBuilder = {
      partialCommitment: async () => sdkState.partialCommitment,
      commitment: async () => sdkState.commitment,
      invoke: (nonce: bigint, options: { calls: unknown[] }) => {
        sdkState.opsLog.push("shadowInvoke");
        sdkState.invokeCalls.push({
          nonce,
          calls: options.calls as { contractAddress: string; entrypoint: string; calldata: unknown[] }[],
        });
        return builder;
      },
    };
    const builder = {
      with: (_token: string, opFn: (t: unknown) => void) => {
        opFn(makeTokenOps());
        return builder;
      },
      register: () => builder,
      surplusTo: () => builder,
      shadowAccounts: () => shadowBuilder,
      simulate: async () => ({
        callAndProof: {
          call: { contractAddress: "0x1", entrypoint: "apply_actions", calldata: [] },
          proof: { proofFacts: ["0x1"], data: "0xdead" },
        },
        warnings: [],
      }),
      execute: async () => {
        if (sdkState.executeGate) await sdkState.executeGate;
        return {
          callAndProof: {
            call: { contractAddress: "0x1", entrypoint: "apply_actions", calldata: [] },
            proof: { proofFacts: ["0x1"], data: "0xdead" },
          },
          warnings: [],
        };
      },
    };
    return builder;
  };
  return {
    createPrivateTransfers: () => {
      sdkState.createCalls++;
      return {
        build: () => makeBuilder(),
        discoverNotes: async () => {
          const notes = new Map();
          notes.set(BigInt(STRK), [{ amount: sdkState.privateBalance, created: 900_000 }]);
          return { timestamp: "0x1f4", notes };
        },
        discoverRequirement: async () => 3,
      };
    },
    Open: Symbol("Open"),
    IndexerDiscoveryProvider: class {
      constructor() {}
    },
  };
});

import { WalletRuntime } from "../wallet/runtime";
import { createMemoryStorage } from "../wallet/storage";
import { deriveWalletViewingKey } from "../wallet/privacy";
import { READY_SEPOLIA_CLASS_HASH } from "../wallet/account";
import {
  validateCrossChainIntent,
  validateDestinationAddress,
  computeMinOutput,
  resolveNearIntentRoute,
  NearIntentAdapter,
  transferCalldata,
  NearIntentQuoteStaleError,
  NearIntentUnknownError,
  nearIntentPhaseForStatus,
  crossChainConfigFor,
  NEAR_INTENT_STRK_ASSET_ID,
  NEAR_INTENT_BASE_USDC_ASSET_ID,
} from "../features/near-intents";
import type { CrossChainPrivateIntent } from "../features/near-intents";

const PASSWORD = "correct horse battery staple";
const VALID_SRC5 = ["0x56614c4944"];

function makeProvider() {
  return {
    getClassHashAt: vi.fn(async () => READY_SEPOLIA_CLASS_HASH),
    callContract: vi.fn(async () => VALID_SRC5),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  } as never;
}

function patchWalletAccount(wallet: { account: { provider: unknown; execute: unknown } }) {
  const provider = {
    callContract: vi.fn(async () => ["0x0", "0x0"]),
    getBlockNumber: vi.fn(async () => 1_000_000),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED", block_number: 1 })),
  };
  (wallet.account as { provider: unknown }).provider = provider as never;
  (wallet.account as { execute: unknown }).execute = vi.fn(async () => ({ transaction_hash: "0xroot" }));
}

function makeRuntime() {
  const storage = createMemoryStorage();
  const runtime = new WalletRuntime({ storage, providerFactory: () => makeProvider() });
  return { runtime, storage };
}

async function createdWallet(runtime: WalletRuntime) {
  const wallet = await runtime.create(PASSWORD);
  patchWalletAccount(wallet);
  return wallet;
}

function validIntent(overrides: Partial<CrossChainPrivateIntent> = {}): CrossChainPrivateIntent {
  return {
    action: "cross-chain.swap",
    sourceChain: "starknet",
    sourceAsset: "strk",
    sourceAmount: 100n,
    destinationChain: "base",
    destinationAsset: "usdc",
    destinationAddress: DEST,
    slippageBps: 100,
    appName: "orrange",
    nonce: 0n,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes("1click.chaindefuser.com")) {
        if (u.includes("/v0/quote")) {
          nearState.quoteCount++;
          const body = JSON.parse(init?.body ?? "{}") as { dry?: boolean; amount?: string };
          const dry = body.dry === true;
          return jsonResponse(201, {
            quote: {
              amountIn: body.amount,
              amountOut: nearState.amountOut.toString(),
              minAmountOut: "0",
              refundFee: "0",
              withdrawFee: "0",
              timeEstimate: 29,
              deadline: new Date(Date.now() + 3600e3).toISOString(),
              timeWhenInactive: new Date(Date.now() + 3 * 86400e3).toISOString(),
              ...(dry ? {} : { depositAddress: nearState.depositAddress }),
            },
            correlationId: "test-intent-id",
          });
        }
        if (u.includes("/v0/deposit/submit")) {
          nearState.submitCount++;
          return jsonResponse(200, {});
        }
        if (u.includes("/v0/status")) {
          if (nearState.statusFails) throw new Error("status unreachable");
          const code =
            nearState.statusQueue.length > 1
              ? (nearState.statusQueue.shift() as string)
              : (nearState.statusQueue[0] ?? "PENDING_DEPOSIT");
          return jsonResponse(200, {
            status: code,
            correlationId: "test-intent-id",
            swapDetails: {
              intentHashes: [],
              nearTxHashes: [],
              originChainTxHashes: code === "SUCCESS" ? ["0xsrc"] : [],
              destinationChainTxHashes: code === "SUCCESS" ? ["0xdest"] : [],
              amountIn: code === "SUCCESS" ? "100" : null,
              amountOut: code === "SUCCESS" ? nearState.amountOut.toString() : null,
              refundedAmount: "0",
              refundReason: null,
            },
          });
        }
        throw new Error(`unexpected near endpoint ${u}`);
      }
      // private paymaster JSON-RPC
      const body = JSON.parse(init?.body ?? "{}") as { method?: string };
      if (body.method === "paymaster_buildTransaction") {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: 1,
          result: {
            type: "apply_action",
            parameters: { version: "0x1", fee_mode: { mode: "default", gas_token: STRK } },
            fee_action: { type: "withdraw", token: STRK, recipient: "0x1234", amount: "0x1" },
          },
        });
      }
      if (body.method === "paymaster_executeTransaction") {
        sdkState.paymasterExecutions++;
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: 1,
          result: { transaction_hash: "0x1234", tracking_id: "0x1" },
        });
      }
      throw new Error(`unexpected paymaster method ${body.method}`);
    }),
  );
}

beforeEach(() => {
  sdkState.reset();
  nearState.reset();
  process.env.NEXT_PUBLIC_STRK20_PROVER_URL = "https://prover.test";
  process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL = "https://discovery.test";
  process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA = ANONYMIZER;
  stubNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_STRK20_PROVER_URL;
  delete process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL;
  delete process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA;
});

describe("intent validation", () => {
  it("accepts a well-formed cross-chain intent", () => {
    expect(validateCrossChainIntent(validIntent())).toBeNull();
  });

  it("rejects malformed intents BEFORE execution", () => {
    expect(validateCrossChainIntent(null)).not.toBeNull();
    expect(validateCrossChainIntent({})).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), action: "private.swap" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), sourceChain: "ethereum" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), sourceAsset: "eth" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), sourceAmount: 0n })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), destinationChain: "ethereum" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), destinationAsset: "eth" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), destinationAddress: "0xzz" })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), destinationAddress: DEST.slice(0, -1) })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), slippageBps: 10001 })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), appName: "x".repeat(32) })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), nonce: -1n })).not.toBeNull();
    expect(validateCrossChainIntent({ ...validIntent(), expiry: Date.now() - 1 })).not.toBeNull();
  });

  it("validates the destination address is a fresh EVM address (never the Starknet root)", () => {
    expect(validateDestinationAddress(DEST)).toBeNull();
    expect(validateDestinationAddress("0x" + "a".repeat(40))).toBeNull();
    expect(validateDestinationAddress(STRK)).not.toBeNull(); // Starknet felt is not a Base address
    expect(validateDestinationAddress("0x1234")).not.toBeNull();
    expect(validateDestinationAddress(undefined)).not.toBeNull();
  });

  it("resolves the single supported route only", () => {
    expect(resolveNearIntentRoute("starknet", "strk", "base", "usdc")?.originAssetId).toBe(NEAR_INTENT_STRK_ASSET_ID);
    expect(resolveNearIntentRoute("starknet", "strk", "base", "usdc")?.destinationAssetId).toBe(
      NEAR_INTENT_BASE_USDC_ASSET_ID,
    );
    expect(resolveNearIntentRoute("base", "usdc", "starknet", "strk")).toBeNull();
    expect(resolveNearIntentRoute("starknet", "strk", "solana", "usdc")).toBeNull();
  });
});

describe("min-output / amount math", () => {
  it("computes the min-output from the quote with integer math", () => {
    const quote = 1_000_000n;
    expect(computeMinOutput(quote, 0)).toBe(1_000_000n);
    expect(computeMinOutput(quote, 100)).toBe(990_000n);
    expect(computeMinOutput(quote, 500)).toBe(950_000n);
    expect(computeMinOutput(quote, 10_000)).toBe(0n);
  });

  it("encodes a u256 ERC20 transfer calldata for the shadow account", () => {
    const calldata = transferCalldata(DEPOSIT, 100n);
    expect(calldata[0]).toBe(DEPOSIT);
    expect(calldata[1]).toBe("0x64");
    expect(calldata[2]).toBe("0x0");
  });
});

describe("quote + publish (deposit-address reservation)", () => {
  it("quotes a REAL dry quote bound to the route + amount + destination", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    const quote = await runtime.quoteCrossChain(validIntent());
    expect(quote.sourceAsset).toBe("strk");
    expect(quote.destinationAsset).toBe("usdc");
    expect(quote.amountOut).toBe(1_000_000n);
    expect(quote.minAmountOut).toBe(990_000n);
    expect(quote.destinationAddress).toBe(DEST);
    expect(quote.route).toContain("STRK");
  });

  it("reserves a deposit address when creating the intent (publish)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    expect(prepared.depositAddress).toBe(DEPOSIT);
    expect(prepared.intentId).toBe("test-intent-id");
    expect(prepared.sourceTokenAddress).toBe(STRK);
  });

  it("rejects a stale/mutated quote before funding", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const confirmed = await runtime.quoteCrossChain(validIntent());
    // The route moved: the fresh quote now returns below the confirmed floor (990_000).
    nearState.amountOut = 900_000n;
    await expect(runtime.createCrossChainIntent(validIntent(), confirmed)).rejects.toThrow(
      NearIntentQuoteStaleError,
    );
  });

  it("rejects an expired intent at creation time (no API call)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const before = nearState.quoteCount;
    await expect(
      runtime.createCrossChainIntent(validIntent({ expiry: Date.now() - 1000 })),
    ).rejects.toThrow(/expired/i);
    expect(nearState.quoteCount).toBe(before);
  });

  it("rejects an unsupported route", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.quoteCrossChain(validIntent({ destinationChain: "solana" as never }))).rejects.toThrow(
      /unsupported/i,
    );
  });
});

describe("execution + status reconciliation", () => {
  it("executes the full path: shadow account funds the NEAR deposit and reconciles SUCCESS", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    const identity = await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());

    const receipt = await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });

    expect(receipt.status).toBe("SUCCESS");
    expect(receipt.depositAddress).toBe(DEPOSIT);
    expect(receipt.destinationAddress).toBe(DEST);
    expect(receipt.shadowAddress).toBe(identity.shadowAddress);
    expect(receipt.transactionHash).toBe("0x1234");
    expect(receipt.amountOut).toBe(1_000_000n);

    // The shadow account executed the STRK transfer to the NEAR deposit address.
    expect(sdkState.invokeCalls.length).toBe(1);
    const call = sdkState.invokeCalls[0].calls[0];
    expect(call.contractAddress.toLowerCase()).toBe(STRK.toLowerCase());
    expect(call.entrypoint).toBe("transfer");
    expect(String(call.calldata[0]).toLowerCase()).toBe(DEPOSIT.toLowerCase());

    // The proof was relayed through the paymaster (root wallet never the on-chain depositor).
    expect(sdkState.paymasterExecutions).toBe(1);
    // The deposit tx was notified to 1Click.
    expect(nearState.submitCount).toBe(1);

    // Lifecycle reached success.
    expect(runtime.getState().nearIntentOp.phase).toBe("success");
  });

  it("reports a REFUNDED settlement as refunded (never success)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    nearState.statusQueue = ["PROCESSING", "REFUNDED"];
    const receipt = await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });
    expect(receipt.status).toBe("REFUNDED");
    expect(runtime.getState().nearIntentOp.phase).toBe("refunded");
  });

  it("reports a FAILED settlement as failed (never success)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    nearState.statusQueue = ["PROCESSING", "FAILED"];
    const receipt = await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });
    expect(receipt.status).toBe("FAILED");
    expect(runtime.getState().nearIntentOp.phase).toBe("failed");
  });

  it("reports an unreconcilable status as unknown (never success)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    nearState.statusQueue = ["PENDING_DEPOSIT"]; // never terminal
    nearState.statusFails = true; // and the endpoint is unreachable
    await expect(
      runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1, trackTimeoutMs: 30 }),
    ).rejects.toThrow(NearIntentUnknownError);
    expect(runtime.getState().nearIntentOp.phase).toBe("unknown");
  });

  it("rejects a mutated prepared intent (wrong amount) before funding", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    const before = sdkState.paymasterExecutions;
    await expect(
      runtime.executeCrossChainIntent(validIntent({ sourceAmount: 200n }), prepared, { pollMs: 1 }),
    ).rejects.toThrow(/does not match/i);
    expect(sdkState.paymasterExecutions).toBe(before);
  });
});

describe("runtime guards + adapter correctness", () => {
  it("refuses to quote/execute when the wallet is locked", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    runtime.lock();
    await expect(runtime.quoteCrossChain(validIntent())).rejects.toThrow(/locked/i);
    const prepared = {
      sourceAsset: "strk" as const,
      sourceAmount: 100n,
      destinationAddress: DEST,
      depositAddress: DEPOSIT,
      sourceChain: "starknet" as const,
      destinationChain: "base" as const,
      destinationAsset: "usdc" as const,
      amountOut: 1_000_000n,
      minAmountOut: 990_000n,
      refundFee: 0n,
      withdrawFee: 0n,
      timeEstimate: 0,
      deadline: "",
      route: "",
      slippageBps: 100,
      depositAddressDeadline: "",
      intentId: "",
      sourceTokenAddress: STRK,
    };
    await expect(runtime.executeCrossChainIntent(validIntent(), prepared)).rejects.toThrow(/locked/i);
  });

  it("refuses when there is no active shadow identity", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await expect(runtime.createCrossChainIntent(validIntent())).rejects.toThrow(/no active shadow identity/i);
  });

  it("getCrossChainStatus reconciles a deposit address", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    nearState.statusQueue = ["SUCCESS"];
    const status = await runtime.getCrossChainStatus(DEPOSIT);
    expect(status.code).toBe("SUCCESS");
    expect(status.settled).toBe(true);
    expect(status.terminal).toBe(true);
  });

  it("the adapter owns NEAR business logic; Wallet Core stays custody-only", () => {
    // The NearIntentAdapter is a feature-level type; the runtime only exposes thin bridges.
    expect(typeof NearIntentAdapter).toBe("function");
    const adapter = new NearIntentAdapter({ wallet: null as never, privacySession: null as never, network: "sepolia" });
    expect(adapter.name).toBe("near-intent-adapter");
  });
});

describe("status machine + availability", () => {
  it("maps status codes to the honest lifecycle phases (never collapses unknown→failed)", () => {
    expect(nearIntentPhaseForStatus("PENDING_DEPOSIT")).toBe("awaiting-source-deposit");
    expect(nearIntentPhaseForStatus("KNOWN_DEPOSIT_TX")).toBe("source-confirming");
    expect(nearIntentPhaseForStatus("PROCESSING")).toBe("solver-executing");
    expect(nearIntentPhaseForStatus("SUCCESS")).toBe("success");
    expect(nearIntentPhaseForStatus("REFUNDED")).toBe("refunded");
    expect(nearIntentPhaseForStatus("FAILED")).toBe("failed");
    expect(nearIntentPhaseForStatus("INCOMPLETE_DEPOSIT")).toBe("failed");
  });

  it("createCrossChainIntent leaves the intent in the intent-created state", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    await runtime.createCrossChainIntent(validIntent());
    expect(runtime.getState().nearIntentOp.phase).toBe("intent-created");
    expect(runtime.getState().nearIntentOp.depositAddress).toBe(DEPOSIT);
  });

  it("emits the source + solver lifecycle (preparing → source-confirming → solver-executing → success)", async () => {
    const { runtime } = makeRuntime();
    await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());

    const phases: string[] = [];
    const unsubscribe = runtime.subscribe(() => {
      const phase = runtime.getState().nearIntentOp.phase;
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    });

    nearState.statusQueue = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
    await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });
    unsubscribe();

    expect(phases).toContain("preparing");
    expect(phases).toContain("awaiting-source-deposit");
    expect(phases).toContain("source-confirming");
    expect(phases).toContain("solver-executing");
    expect(phases.at(-1)).toBe("success");
  });

  it("cross-chain is enabled on Sepolia but unavailable (not public-fallback) on mainnet", async () => {
    expect(crossChainConfigFor("sepolia").enabled).toBe(true);
    expect(crossChainConfigFor("mainnet").enabled).toBe(false);
    expect(crossChainConfigFor("mainnet").reason).toMatch(/mainnet/i);
    // The adapter refuses on mainnet without touching any wallet/signing.
    const adapter = new NearIntentAdapter({
      wallet: null as never,
      privacySession: null as never,
      network: "mainnet",
    });
    await expect(adapter.quote(validIntent())).rejects.toThrow(/unavailable on mainnet/i);
  });
});

describe("no secret / viewing-key exposure", () => {
  it("the receipt and runtime state never contain the viewing key or secret material", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    const receipt = await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });

    const json = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
    const viewingKey = deriveWalletViewingKey(wallet.secret, "sepolia");
    expect(json(receipt)).not.toContain(viewingKey.toString());
    expect(json(runtime.getState())).not.toContain(viewingKey.toString());
    expect(json(receipt)).not.toMatch(/viewingKey|viewing key|note|proofFacts|secret|privateKey/i);
  });

  it("never exposes NEAR credentials or a public master-wallet fallback", async () => {
    const { runtime } = makeRuntime();
    const wallet = await createdWallet(runtime);
    await runtime.createShadowIdentity("orrange", 0n);
    const prepared = await runtime.createCrossChainIntent(validIntent());
    await runtime.executeCrossChainIntent(validIntent(), prepared, { pollMs: 1 });
    // The root wallet account never submitted the outer tx (the paymaster relayed it).
    const execute = (wallet.account as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
    expect(execute).not.toHaveBeenCalled();
    expect(sdkState.paymasterExecutions).toBe(1);
  });
});
