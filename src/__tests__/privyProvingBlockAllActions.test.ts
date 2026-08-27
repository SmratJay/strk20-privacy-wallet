/**
 * @file privyProvingBlockAllActions.test.ts
 * @description Every STRK20 privacy action (shield, register, unshield, transfer) must prove
 * against a safe numeric block (currentBlock - margin), never `latest`. The pool rejects proofs
 * whose block is too recent ("maximum allowed block number"), so `register`/`unshield`/`transfer`
 * must forward `provingBlockId` to the SDK `execute()` just like `shield` does.
 */

import { describe, it, expect, vi } from "vitest";
import { constants } from "starknet";
import { PrivyStrk20Adapter } from "../privacy/adapter/PrivyStrk20Adapter";

const SAFETY_MARGIN = 10;

const h = vi.hoisted(() => {
  const executeOpts: Record<string, unknown>[] = [];
  const simFn = vi.fn(async () => ({
    callAndProof: {
      call: { contractAddress: "0xpool", entrypoint: "apply_actions", calldata: ["0x1"] },
      proof: { proofFacts: ["0xmock"], data: undefined },
    },
    warnings: [],
  }));
  const execFn = vi.fn(async (opts?: Record<string, unknown>) => {
    h.executeOpts.push(opts ?? {});
    return {
      callAndProof: {
        call: { contractAddress: "0xpool", entrypoint: "apply_actions", calldata: ["0x1"] },
        proof: { proofFacts: ["0xreal"], data: "proof-b64" },
      },
      warnings: [],
    };
  });
  return { executeOpts, simFn, execFn };
});

vi.mock("@starkware-libs/starknet-privacy-sdk", () => ({
  createPrivateTransfers: () => ({
    build: () => ({
      with: () => ({
        surplusTo: () => ({ simulate: h.simFn, execute: h.execFn }),
      }),
      register: () => ({ simulate: h.simFn, execute: h.execFn }),
    }),
    discoverNotes: async () => ({ notes: new Map() }),
  }),
}));

function buildAdapter(getBlockNumber: () => Promise<number>) {
  const provider = {
    getBlockNumber: vi.fn(getBlockNumber),
    callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
      if (entrypoint === "get_fee_amount") return ["0x" + (2n * 10n ** 18n).toString(16)];
      if (entrypoint === "allowance") return ["0x" + (1000n * 10n ** 18n).toString(16), "0x0"];
      return ["0x0"];
    }),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED" })),
    getBlockWithTxHashes: vi.fn(async () => ({
      l1_gas_price: { price_in_fri: "0x64" },
      l2_gas_price: { price_in_fri: "0x2" },
      l1_data_gas_price: { price_in_fri: "0x1" },
    })),
  };
  const execute = vi.fn(async function (this: unknown) {
    if (!this) throw new Error("unbound");
    return { transaction_hash: "0xtx" };
  });
  const estimateInvokeFee = vi.fn(async () => ({
    resourceBounds: {
      l1_gas: { max_amount: 1n, max_price_per_unit: 200n },
      l2_gas: { max_amount: 1_210_000_000n, max_price_per_unit: 4n },
      l1_data_gas: { max_amount: 10_000n, max_price_per_unit: 2n },
    },
    overall_fee: 100n,
    unit: "FRI",
  }));
  const account = { address: "0xowner", signer: {}, provider, execute, estimateInvokeFee };
  const user = { account: account as any, address: "0xowner", viewingKey: 1n };
  const adapter = new PrivyStrk20Adapter({
    poolContractAddress: "0xpool",
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    proverUrl: "https://prover.example.com",
    discoveryUrl: "https://discovery.example.com",
  });
  return { adapter, user, provider };
}

const CURRENT = 14_138_924;

describe("PrivyStrk20Adapter proving block for every action", () => {
  it("register passes a numeric provingBlockId a safety margin behind the head", async () => {
    h.executeOpts.length = 0;
    const { adapter, user } = buildAdapter(async () => CURRENT);
    await adapter.register(user);
    expect(h.executeOpts.length).toBe(1);
    expect(h.executeOpts[0]).toEqual({ provingBlockId: CURRENT - SAFETY_MARGIN });
  });

  it("unshield passes a numeric provingBlockId a safety margin behind the head", async () => {
    h.executeOpts.length = 0;
    const { adapter, user } = buildAdapter(async () => CURRENT);
    await adapter.unshield(user, "0xtoken", 100n);
    expect(h.executeOpts.length).toBe(1);
    expect(h.executeOpts[0]).toEqual({ provingBlockId: CURRENT - SAFETY_MARGIN });
  });

  it("transfer passes a numeric provingBlockId a safety margin behind the head", async () => {
    h.executeOpts.length = 0;
    const { adapter, user } = buildAdapter(async () => CURRENT);
    await adapter.transfer(user, "0xtoken", 100n, "0xrecipient");
    expect(h.executeOpts.length).toBe(1);
    expect(h.executeOpts[0]).toEqual({ provingBlockId: CURRENT - SAFETY_MARGIN });
  });

  it("shield still passes a numeric provingBlockId (regression)", async () => {
    h.executeOpts.length = 0;
    const { adapter, user } = buildAdapter(async () => CURRENT);
    await adapter.shield(user, "0xtoken", 100n);
    expect(h.executeOpts.length).toBe(1);
    expect(h.executeOpts[0]).toEqual({ provingBlockId: CURRENT - SAFETY_MARGIN });
  });
});
