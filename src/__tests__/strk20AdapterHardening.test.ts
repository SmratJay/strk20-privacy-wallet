/**
 * @file strk20AdapterHardening.test.ts
 * @description Stage 3A STRK20 adapter hardening — operation shapes (register/shield/transfer/
 *   withdraw), bounded fee/resource fallback, and cache-context safety. Uses a stubbed SDK
 *   (`createPrivateTransfers`) and a fake Wallet-Core account so no real network/prover is touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

// Hoisted state so the SDK stub can record which private-transfer ops were built.
const sdkState = vi.hoisted(() => ({
  opsLog: [] as string[],
  createCalls: 0,
  reset() {
    this.opsLog.length = 0;
    this.createCalls = 0;
  },
}));

vi.mock("@starkware-libs/starknet-privacy-sdk", () => {
  const makeTokenOps = () => ({
    deposit: () => {
      sdkState.opsLog.push("deposit");
      return makeTokenOps();
    },
    withdraw: () => {
      sdkState.opsLog.push("withdraw");
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
      simulate: async () => ({
        callAndProof: {
          call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: [] },
          proof: { proofFacts: ["0x1"], data: "0xdead" },
        },
        warnings: [],
      }),
      execute: async () => ({
        callAndProof: {
          call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: [] },
          proof: { proofFacts: ["0x1"], data: "0xdead" },
        },
        warnings: [],
      }),
    };
    void opts;
    return builder;
  };
  return {
    createPrivateTransfers: (params: Record<string, unknown>) => {
      sdkState.createCalls++;
      void params;
      return {
        build: (opts: Record<string, unknown>) => makeBuilder(opts),
        discoverNotes: async () => ({ notes: new Map() }),
        discoverRequirement: async () => 2,
      };
    },
  };
});

import { Strk20Adapter, type Strk20User } from "../privacy/strk20";
import { constants } from "starknet";

function makeAccount(overrides: Record<string, unknown> = {}) {
  const provider = {
    getBlockNumber: vi.fn(async () => 1_000_000),
    getBlockWithTxHashes: vi.fn(async () => ({
      l1_gas_price: { price_in_fri: "0x10" },
      l2_gas_price: { price_in_fri: "0x20" },
      l1_data_gas_price: { price_in_fri: "0x30" },
    })),
    callContract: vi.fn(async (call: { entrypoint: string }) => {
      if (call.entrypoint === "get_fee_amount") return ["0x" + (2n * 10n ** 18n).toString(16)];
      // allowance → huge, so no approve is needed.
      return ["0xffffffffffffffffffffffffffffffff", "0x0"];
    }),
    ...(overrides.provider ?? {}),
  };
  return {
    provider,
    signer: {},
    address: "0xabc",
    estimateInvokeFee: vi.fn(async () => ({
      overall_fee: 1000n,
      resourceBounds: {
        l1_gas: { max_amount: 1n, max_price_per_unit: 1n },
        l2_gas: { max_amount: 2n, max_price_per_unit: 2n },
        l1_data_gas: { max_amount: 3n, max_price_per_unit: 3n },
      },
    })),
    execute: vi.fn(async () => ({ transaction_hash: "0xsubmit" })),
    ...overrides,
  };
}

function makeUser(account = makeAccount()): Strk20User {
  return {
    account: account as never,
    address: account.address,
    viewingKey: 123n,
  };
}

function makeAdapter(config: Partial<ConstructorParameters<typeof Strk20Adapter>[0]> = {}) {
  return new Strk20Adapter({
    poolContractAddress: POOL,
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    proverUrl: "https://prover.test",
    discoveryUrl: "https://discovery.test",
    feeTokenAddress: STRK,
    ...config,
  });
}

beforeEach(() => {
  sdkState.reset();
});

describe("STRK20 operation shapes", () => {
  it("register builds an autoRegister + register apply_actions flow", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const receipt = await adapter.register(user);
    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(sdkState.opsLog).toContain("register");
  });

  it("shield builds a deposit + surplusTo flow", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const receipt = await adapter.shield(user, STRK, 5n);
    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(sdkState.opsLog).toContain("deposit");
    expect(sdkState.opsLog).toContain("surplusTo");
  });

  it("transfer builds a transfer + surplusTo flow", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const receipt = await adapter.transfer(user, STRK, 3n, "0xrecipient");
    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(sdkState.opsLog).toContain("transfer");
    expect(sdkState.opsLog).toContain("surplusTo");
  });

  it("withdraw (unshield) builds a withdraw + surplusTo flow", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const receipt = await adapter.unshield(user, STRK, 2n);
    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(sdkState.opsLog).toContain("withdraw");
    expect(sdkState.opsLog).toContain("surplusTo");
  });
});

describe("fee / resource-bound fallback is bounded", () => {
  it("prefers real fee estimation when the node accepts the proof facts", async () => {
    const account = makeAccount();
    const adapter = makeAdapter();
    const receipt = await adapter.shield(makeUser(account), STRK, 5n);
    expect(receipt.transactionHash).toBe("0xsubmit");
    expect(account.estimateInvokeFee).toHaveBeenCalled();
    // The estimation-derived resource bounds flow into the submission.
    const executeArgs = account.execute.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(executeArgs[1].resourceBounds).toMatchObject({
      l2_gas: { max_amount: 2n, max_price_per_unit: 2n },
    });
  });

  it("falls back to gas-price bounds (2x) ONLY on proof-version rejection, and is bounded", async () => {
    const account = makeAccount({
      estimateInvokeFee: vi.fn(async () => {
        throw new Error("Proof version PROOF0 is not allowed under this protocol version");
      }),
    });
    const adapter = makeAdapter();
    const receipt = await adapter.shield(makeUser(account), STRK, 5n);
    expect(receipt.transactionHash).toBe("0xsubmit");
    // Fallback bounds: documented capped max_amounts + 2x headroom on price per unit.
    const executeArgs = account.execute.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    const rb = executeArgs[1].resourceBounds as {
      l2_gas: { max_amount: bigint; max_price_per_unit: bigint };
    };
    expect(rb.l2_gas.max_amount).toBe(1_210_000_000n);
    expect(rb.l2_gas.max_price_per_unit).toBe(0x20n * 2n);
  });

  it("does NOT swallow an insufficient-resource failure", async () => {
    const account = makeAccount({
      estimateInvokeFee: vi.fn(async () => {
        throw new Error("insufficient max fee");
      }),
    });
    const adapter = makeAdapter();
    await expect(adapter.shield(makeUser(account), STRK, 5n)).rejects.toThrow(/insufficient max fee/);
  });

  it("the resolveResourceBounds fallback is capped (bounded amounts, 2x price headroom)", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const bounds = await (adapter as unknown as {
      resolveResourceBounds: (u: Strk20User) => Promise<{
        l1_gas: { max_amount: bigint; max_price_per_unit: bigint };
        l2_gas: { max_amount: bigint; max_price_per_unit: bigint };
        l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint };
      }>;
    }).resolveResourceBounds(user);
    expect(bounds.l2_gas.max_amount).toBe(1_210_000_000n);
    expect(bounds.l1_gas.max_amount).toBe(1n);
    expect(bounds.l1_data_gas.max_amount).toBe(10_000n);
    expect(bounds.l2_gas.max_price_per_unit).toBe(0x20n * 2n);
    expect(bounds.l1_gas.max_price_per_unit).toBe(0x10n * 2n);
    expect(bounds.l1_data_gas.max_price_per_unit).toBe(0x30n * 2n);
  });
});

describe("cache-context safety", () => {
  it("caches per address within the same adapter", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    await adapter.getTransfers(user);
    await adapter.getTransfers(user);
    expect(sdkState.createCalls).toBe(1);
  });

  it("cache keys include network, pool, prover, discovery, fee token and address (no context mixing)", async () => {
    const adapter = makeAdapter();
    const user = makeUser();
    const key = (adapter as unknown as { cacheKey: (u: Strk20User) => string }).cacheKey(user);
    expect(key).toContain(constants.StarknetChainId.SN_SEPOLIA);
    expect(key).toContain(POOL.toLowerCase());
    expect(key).toContain("https://prover.test");
    expect(key).toContain("https://discovery.test");
    expect(key).toContain(STRK.toLowerCase());
    expect(key).toContain(user.address.toLowerCase());

    // A different pool/config must produce a DIFFERENT key for the same address.
    const other = makeAdapter({ poolContractAddress: "0x9999", proverUrl: "https://prover-2.test" });
    const otherKey = (other as unknown as { cacheKey: (u: Strk20User) => string }).cacheKey(user);
    expect(otherKey).not.toBe(key);
  });

  it("cached contexts are never shared across incompatible pool configurations", async () => {
    const a = makeAdapter();
    const b = makeAdapter({ poolContractAddress: "0x9999" });
    const user = makeUser();
    await a.getTransfers(user);
    await b.getTransfers(user);
    // Different adapters/configs each built their own SDK context (no cross-contamination).
    expect(sdkState.createCalls).toBe(2);
  });
});