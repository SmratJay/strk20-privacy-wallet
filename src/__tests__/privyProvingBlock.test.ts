/**
 * @file privyProvingBlock.test.ts
 * @description STRK20 shield must NOT prove against `latest` — account validation rejects proofs
 * whose block is too recent. The adapter must select a proving block a safety margin behind the
 * current chain head and pass it to the SDK execute() as provingBlockId.
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
    proverUrl: "",
    discoveryUrl: "",
  });
  return { adapter, user, provider, execFn: h.execFn };
}

describe("PrivyStrk20Adapter shield proving block selection", () => {
  it("passes a provingBlockId a safety margin behind the current block", async () => {
    h.executeOpts.length = 0;
    const currentBlock = 1_000_000;
    const { adapter, user, provider } = buildAdapter(async () => currentBlock);

    await adapter.shield(user, "0xtoken", 100n);

    expect(provider.getBlockNumber).toHaveBeenCalled();
    expect(h.executeOpts.length).toBe(1);
    const provingBlockId = (h.executeOpts[0] as { provingBlockId?: { block_number?: number } })
      .provingBlockId;
    expect(provingBlockId).toBeDefined();
    expect(provingBlockId!.block_number).toBe(currentBlock - SAFETY_MARGIN);
    expect(provingBlockId!.block_number).toBeLessThan(currentBlock);
  });

  it("never proves against `latest` for a shield", async () => {
    h.executeOpts.length = 0;
    const currentBlock = 14_124_611; // mirrors the observed failing block range
    const { adapter, user } = buildAdapter(async () => currentBlock);

    await adapter.shield(user, "0xtoken", 100n);

    const provingBlockId = (h.executeOpts[0] as { provingBlockId?: { block_number?: number } })
      .provingBlockId;
    expect(provingBlockId).toEqual({ block_number: currentBlock - SAFETY_MARGIN });
    // The proof must reference a numeric block, never the string "latest".
    expect(provingBlockId!.block_number).toBeLessThan(currentBlock);
  });

  it("clamps the proving block at 0 when the chain head is below the margin", async () => {
    h.executeOpts.length = 0;
    const currentBlock = 3;
    const { adapter, user } = buildAdapter(async () => currentBlock);

    await adapter.shield(user, "0xtoken", 100n);

    const provingBlockId = (h.executeOpts[0] as { provingBlockId?: { block_number?: number } })
      .provingBlockId;
    expect(provingBlockId!.block_number).toBe(0);
  });
});
