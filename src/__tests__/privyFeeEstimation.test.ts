/**
 * @file privyFeeEstimation.test.ts
 * @description Regression test for the SDK-supported fee-estimation flow:
 * fee is estimated from a simulate() (mock proof, NO real proof blob), then the real
 * proof-bearing INVOKE_TXN_V3 is submitted with the resulting resource bounds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { constants } from "starknet";
import { PrivyStrk20Adapter } from "../privacy/adapter/PrivyStrk20Adapter";

const CALL = {
  contractAddress: "0xpool",
  entrypoint: "apply_actions",
  calldata: ["0x1", "0x2", "0x3"],
};

const MOCK_PROOF = { proofFacts: ["0xmock-fact"], data: undefined };
const REAL_PROOF = { proofFacts: ["0xreal-fact"], data: "real-proof-base64" };
const RESOURCE_BOUNDS = {
  l1_gas: { max_amount: 1000n, max_price_per_unit: 10n },
  l2_gas: { max_amount: 1000n, max_price_per_unit: 10n },
  l1_data_gas: { max_amount: 1000n, max_price_per_unit: 10n },
};

const simFn = vi.fn(async () => ({
  callAndProof: { call: CALL, proof: MOCK_PROOF },
  warnings: [],
}));
const execFn = vi.fn(async () => ({
  callAndProof: { call: CALL, proof: REAL_PROOF },
  warnings: [],
}));

vi.mock("@starkware-libs/starknet-privacy-sdk", () => ({
  createPrivateTransfers: () => ({
    build: () => ({
      register: () => ({ simulate: simFn, execute: execFn }),
      with: () => ({
        surplusTo: () => ({ simulate: simFn, execute: execFn }),
      }),
      surplusTo: () => ({ simulate: simFn, execute: execFn }),
    }),
    discoverNotes: async () => ({ notes: new Map() }),
  }),
}));

function makeAccount() {
  const estimateInvokeFee = vi.fn(async (_call: any, _details: any) => ({
    resourceBounds: RESOURCE_BOUNDS,
    overall_fee: 100n,
    unit: "FRI",
  }));
  const execute = vi.fn(async function (
    this: unknown,
    _calls: any,
    _details: any,
  ) {
    if (!this) throw new Error("account.execute called unbound");
    return { transaction_hash: "0xtx" };
  });
  return {
    address: "0xaddr",
    signer: {},
    provider: {},
    estimateInvokeFee,
    execute,
  };
}

describe("PrivyStrk20Adapter fee-estimation flow", () => {
  beforeEach(() => {
    simFn.mockClear();
    execFn.mockClear();
  });

  it("simulates (mock proof) BEFORE the real execute, and estimates fee without the real proof", async () => {
    const account = makeAccount();
    const adapter = new PrivyStrk20Adapter({
      poolContractAddress: "0xpool",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      proverUrl: "",
      discoveryUrl: "",
    });

    const receipt = await adapter.register({ account: account as any, address: "0xaddr", viewingKey: 1n });

    expect(receipt.transactionHash).toBe("0xtx");

    // simulate (mock proof) runs before the real execute.
    const simCall = simFn.mock.invocationCallOrder[0];
    const execCall = execFn.mock.invocationCallOrder[0];
    expect(simCall).toBeLessThan(execCall);

    // Fee estimation uses proof facts ONLY — never the real proof blob.
    expect(account.estimateInvokeFee).toHaveBeenCalledTimes(1);
    const estimateDetails = account.estimateInvokeFee.mock.calls[0][1];
    expect(estimateDetails.proofFacts).toEqual(MOCK_PROOF.proofFacts);
    expect(estimateDetails).not.toHaveProperty("proof");

    // The real submission carries the estimated resource bounds + the real proof.
    expect(account.execute).toHaveBeenCalledTimes(1);
    const submitDetails = account.execute.mock.calls[0][1];
    expect(submitDetails.resourceBounds).toEqual(RESOURCE_BOUNDS);
    expect(submitDetails.proofFacts).toEqual(REAL_PROOF.proofFacts);
    expect(submitDetails.proof).toBe(REAL_PROOF.data);
  });
});