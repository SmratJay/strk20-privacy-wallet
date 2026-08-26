/**
 * @file privyAllowance.test.ts
 * @description STRK20 pool-fee allowance prerequisite for the Privy lane:
 * - sufficient allowance → no approve tx
 * - insufficient allowance → approve 10 STRK, wait for receipt, re-verify
 * - failed verification → precise error, no privacy proof generated
 * - existing PROOF0 fallback still works after an approval
 * - Wallet API lane untouched
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { constants } from "starknet";
import {
  ensurePrivacyPoolAllowance,
  readPoolFee,
  readAllowance,
  STRK_TOKEN_ADDRESS,
} from "../privacy/privy/allowance";
import { PrivyStrk20Adapter } from "../privacy/adapter/PrivyStrk20Adapter";

const POOL = "0xpool";
const FEE = 2n * 10n ** 18n; // 2 STRK
const TARGET = 10n * 10n ** 18n; // 10 STRK

function felt128(v: bigint): string {
  return "0x" + (v & ((1n << 128n) - 1n)).toString(16);
}

function makeAccount(opts: {
  allowanceValues?: bigint[];
  fee?: bigint;
  waitForTxError?: Error;
  executionStatus?: "SUCCEEDED" | "REVERTED";
  revertReason?: string;
}) {
  let allowanceIdx = 0;
  const provider = {
    callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
      if (entrypoint === "get_fee_amount") return [felt128(opts.fee ?? FEE)];
      if (entrypoint === "allowance") {
        const seq = opts.allowanceValues ?? [0n];
        const a = seq[Math.min(allowanceIdx++, seq.length - 1)] ?? 0n;
        return [felt128(a), felt128(a >> 128n)];
      }
      throw new Error(`unexpected entrypoint ${entrypoint}`);
    }),
    waitForTransaction: vi.fn(async (_hash: any) => {
      if (opts.waitForTxError) throw opts.waitForTxError;
      return {
        execution_status: opts.executionStatus ?? "SUCCEEDED",
        finality_status: "ACCEPTED_ON_L2",
        revert_reason: opts.revertReason,
      };
    }),
  };
  const execute = vi.fn(async function (this: unknown, _call: any) {
    if (!this) throw new Error("account.execute called unbound");
    return { transaction_hash: "0xapprove" };
  });
  return { address: "0xowner", signer: {}, provider, execute };
}

describe("ensurePrivacyPoolAllowance (Privy lane)", () => {
  it("1. skips approval when the allowance already covers the pool fee", async () => {
    const account = makeAccount({ allowanceValues: [5n * 10n ** 18n] });
    const res = await ensurePrivacyPoolAllowance(
      account as any,
      STRK_TOKEN_ADDRESS,
      POOL,
      FEE,
    );
    expect(res.approved).toBe(false);
    expect(res.allowance).toBe(5n * 10n ** 18n);
    expect(account.execute).not.toHaveBeenCalled();
    expect(account.provider.waitForTransaction).not.toHaveBeenCalled();
  });

  it("2. approves the target 10 STRK allowance when the allowance is insufficient", async () => {
    const account = makeAccount({ allowanceValues: [0n, TARGET] });
    const res = await ensurePrivacyPoolAllowance(
      account as any,
      STRK_TOKEN_ADDRESS,
      POOL,
      FEE,
    );
    expect(res.approved).toBe(true);
    expect(account.execute).toHaveBeenCalledTimes(1);
    const approveCall = account.execute.mock.calls[0][0];
    expect(approveCall.contractAddress).toBe(STRK_TOKEN_ADDRESS);
    expect(approveCall.entrypoint).toBe("approve");
    expect(approveCall.calldata[0]).toBe(POOL);
    expect(BigInt(approveCall.calldata[1])).toBe(TARGET);
    expect(BigInt(approveCall.calldata[2])).toBe(0n);
    // exact u256 encoding: [pool, 0x8ac7230489e80000, 0x0]
    expect("0x" + BigInt(approveCall.calldata[1]).toString(16)).toBe("0x8ac7230489e80000");
    expect("0x" + BigInt(approveCall.calldata[2]).toString(16)).toBe("0x0");
  });

  it("3. waits for the approval receipt before returning", async () => {
    const account = makeAccount({ allowanceValues: [0n, TARGET] });
    await ensurePrivacyPoolAllowance(account as any, STRK_TOKEN_ADDRESS, POOL, FEE);
    expect(account.provider.waitForTransaction).toHaveBeenCalledTimes(1);
    expect(account.provider.waitForTransaction.mock.calls[0][0]).toBe("0xapprove");
  });

  it("3b. a REVERTED approval receipt stops the flow (no privacy proof, precise error)", async () => {
    const account = makeAccount({
      allowanceValues: [0n, 0n],
      executionStatus: "REVERTED",
      revertReason: "Insufficient ERC20 allowance",
    });
    await expect(
      ensurePrivacyPoolAllowance(account as any, STRK_TOKEN_ADDRESS, POOL, FEE),
    ).rejects.toThrow("Could not approve STRK spending for the privacy pool.");
    expect(account.execute).toHaveBeenCalledTimes(1); // approve was attempted
  });

  it("4. throws a precise error when the post-approval allowance is still insufficient (stops before proving)", async () => {
    const account = makeAccount({ allowanceValues: [0n, 0n] });
    await expect(
      ensurePrivacyPoolAllowance(account as any, STRK_TOKEN_ADDRESS, POOL, FEE),
    ).rejects.toThrow("Could not approve STRK spending for the privacy pool.");
    expect(account.execute).toHaveBeenCalledTimes(1); // approve was attempted
  });

  it("4b. readPoolFee / readAllowance parse u256 correctly", async () => {
    const account = makeAccount({ fee: FEE, allowanceValues: [TARGET] });
    const provider = account.provider as any;
    expect(await readPoolFee(provider, POOL)).toBe(FEE);
    expect(await readAllowance(provider, "0xowner", STRK_TOKEN_ADDRESS, POOL)).toBe(TARGET);
  });
});

// SDK mock reused by the adapter integration test.
const order: string[] = [];
const simFn = vi.fn(async () => ({
  callAndProof: { call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: ["0x1"] }, proof: { proofFacts: ["0xmock"], data: undefined } },
  warnings: [],
}));
const execFn = vi.fn(async () => {
  order.push("prove");
  return {
    callAndProof: { call: { contractAddress: POOL, entrypoint: "apply_actions", calldata: ["0x1"] }, proof: { proofFacts: ["0xreal"], data: "real-proof" } },
    warnings: [],
  };
});

vi.mock("@starkware-libs/starknet-privacy-sdk", () => ({
  createPrivateTransfers: () => ({
    build: () => ({
      register: () => ({ simulate: simFn, execute: execFn }),
      with: () => ({ surplusTo: () => ({ simulate: simFn, execute: execFn }) }),
      surplusTo: () => ({ simulate: simFn, execute: execFn }),
    }),
    discoverNotes: async () => ({ notes: new Map() }),
  }),
}));

describe("PrivyStrk20Adapter: allowance before proving + PROOF0 fallback intact", () => {
  it("5. approves STRK before the real proof, then uses gas-price bounds after PROOF0 rejection", async () => {
    order.length = 0;
    let allowanceIdx = 0;
    const allowanceSeq = [0n, TARGET];
    const execute = vi.fn(async function (this: unknown, call: any, details: any) {
      if (!this) throw new Error("unbound");
      if (call?.entrypoint === "approve") order.push("approve");
      return { transaction_hash: "0xtx" };
    });
    const provider = {
      callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_fee_amount") return [felt128(FEE)];
        if (entrypoint === "allowance") {
          const a = allowanceSeq[Math.min(allowanceIdx++, allowanceSeq.length - 1)] ?? 0n;
          return [felt128(a), felt128(a >> 128n)];
        }
        throw new Error(`unexpected ${entrypoint}`);
      }),
      waitForTransaction: vi.fn(async (_hash: any) => ({ execution_status: "SUCCEEDED" })),
      getBlockWithTxHashes: vi.fn(async () => ({
        l1_gas_price: { price_in_fri: "0x64" },
        l2_gas_price: { price_in_fri: "0x2" },
        l1_data_gas_price: { price_in_fri: "0x1" },
      })),
    };
    const estimateInvokeFee = vi.fn(async () => {
      throw new Error(
        "Invalid proof facts: Proof version 88314448135728 (PROOF0) is not allowed under this protocol version.",
      );
    });
    const account = { address: "0xowner", signer: {}, provider, execute, estimateInvokeFee };

    const adapter = new PrivyStrk20Adapter({
      poolContractAddress: POOL,
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      proverUrl: "",
      discoveryUrl: "",
    });

    const receipt = await adapter.register({ account: account as any, address: "0xowner", viewingKey: 1n });
    expect(receipt.transactionHash).toBe("0xtx");

    // approval happened BEFORE the real proof was generated
    expect(order.indexOf("approve")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("approve")).toBeLessThan(order.indexOf("prove"));

    // two account.execute calls: approve + apply_actions submission
    const entries = execute.mock.calls.map((c: any) => c[0]?.entrypoint);
    expect(entries).toEqual(["approve", "apply_actions"]);

    // PROOF0 rejection → gas-price fallback bounds were used for the submission
    const submitDetails = execute.mock.calls[1][1];
    expect(submitDetails.resourceBounds).toEqual({
      l1_gas: { max_amount: 1n, max_price_per_unit: 200n },
      l2_gas: { max_amount: 1_210_000_000n, max_price_per_unit: 4n },
      l1_data_gas: { max_amount: 10_000n, max_price_per_unit: 2n },
    });
    expect(submitDetails.proofFacts).toEqual(["0xreal"]);
    expect(submitDetails.proof).toBe("real-proof");
    expect(estimateInvokeFee).toHaveBeenCalledTimes(1);
  });

  it("6. does not change the Wallet API lane (no privy/approve logic added there)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../services/strk20WalletApiService.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/privy/i);
    expect(src).not.toMatch(/allowance/i);
  });
});