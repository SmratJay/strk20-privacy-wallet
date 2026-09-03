/**
 * @file publicTransfer.test.ts
 * @description Public STRK send encoding — ERC20 `transfer(recipient, amount: u256)` MUST be
 *   `[recipient, amountLow, amountHigh]` (calldata length 3). The previous malformed shape
 *   `[recipient, amount]` (a single bigint felt, length 2) failed on-chain with
 *   argent/multicall-failed / ENTRYPOINT_FAILED. These tests pin the corrected encoding.
 */

import { describe, it, expect } from "vitest";
import { uint256 } from "starknet";
import { buildPublicTransferCall, normalizeTransferRecipient } from "../wallet/publicTransfer";
import { parseAmountToBase } from "../wallet/amount";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RECIPIENT = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";

/** `call.calldata` is `RawArgs | Calldata`; the compiled transfer calldata is a string[]. */
function calldata(call: ReturnType<typeof buildPublicTransferCall>): string[] {
  return call.calldata as unknown as string[];
}

describe("buildPublicTransferCall — u256 calldata", () => {
  it("1 STRK encodes as [recipient, low, high] with high=0", () => {
    const call = buildPublicTransferCall(STRK, RECIPIENT, 1n * 10n ** 18n);
    expect(call.contractAddress).toBe(STRK);
    expect(call.entrypoint).toBe("transfer");
    const cd = calldata(call);
    expect(cd).toHaveLength(3);
    expect(cd[0]).toBe(BigInt(RECIPIENT).toString()); // recipient serialized as felt
    expect(cd[1]).toBe("1000000000000000000"); // low
    expect(cd[2]).toBe("0"); // high
  });

  it("fractional STRK amount encodes the exact base units", () => {
    const call = buildPublicTransferCall(STRK, RECIPIENT, parseAmountToBase("0.001", 18));
    const cd = calldata(call);
    expect(cd).toHaveLength(3);
    expect(cd[1]).toBe("1000000000000000"); // 0.001 STRK
    expect(cd[2]).toBe("0");
  });

  it("amount > 2^128 puts the overflow in the high limb", () => {
    const amount = (1n << 128n) + 5n;
    const call = buildPublicTransferCall(STRK, RECIPIENT, amount);
    const cd = calldata(call);
    expect(cd).toHaveLength(3);
    expect(cd[1]).toBe("5"); // low
    expect(cd[2]).toBe("1"); // high
    // Round-trip check against the canonical helper.
    const decoded = uint256.uint256ToBN({ low: cd[1], high: cd[2] } as never);
    expect(decoded).toBe(amount);
  });

  it("inspects the generated call: calldata length is ALWAYS 3 (regression from [recipient, amount])", () => {
    for (const amount of [1n, 123456n, 1n * 10n ** 18n, (1n << 200n) + 7n]) {
      const cd = calldata(buildPublicTransferCall(STRK, RECIPIENT, amount));
      expect(cd).toHaveLength(3);
    }
    // The previous malformed shape was calldata length 2 (a single amount felt). Prove that
    // shape is impossible now: every transfer call carries the u256 low AND high limbs.
    const cd = calldata(buildPublicTransferCall(STRK, RECIPIENT, 5n));
    expect(cd.length).not.toBe(2);
    expect(cd.length >= 3).toBe(true);
  });
});

describe("amount validation", () => {
  it("rejects zero amount", () => {
    expect(() => buildPublicTransferCall(STRK, RECIPIENT, 0n)).toThrow(/greater than zero/);
    expect(() => parseAmountToBase("0", 18)).not.toThrow();
    expect(() => buildPublicTransferCall(STRK, RECIPIENT, parseAmountToBase("0", 18))).toThrow(
      /greater than zero/,
    );
  });

  it("rejects negative amounts", () => {
    expect(() => parseAmountToBase("-1", 18)).toThrow(/Invalid amount/);
    expect(() => buildPublicTransferCall(STRK, RECIPIENT, -1n)).toThrow(/greater than zero/);
  });

  it("rejects over-precision (more fractional digits than the token decimals)", () => {
    expect(() => parseAmountToBase("0.0000000000000000001", 18)).toThrow(/more than 18 decimal places/);
  });

  it("rejects malformed input", () => {
    expect(() => parseAmountToBase("abc", 18)).toThrow(/Invalid amount/);
    expect(() => parseAmountToBase("", 18)).toThrow(/Invalid amount/);
  });
});

describe("recipient validation happens before any RPC work", () => {
  it("normalizes a valid address", () => {
    expect(normalizeTransferRecipient(RECIPIENT)).toBe(RECIPIENT.toLowerCase());
  });

  it("rejects malformed recipient", () => {
    expect(() => buildPublicTransferCall(STRK, "not-an-address", 1n)).toThrow(/Invalid recipient address/);
    expect(() => buildPublicTransferCall(STRK, "0xzzz", 1n)).toThrow(/Invalid recipient address/);
    expect(() => normalizeTransferRecipient("")).toThrow(/Invalid recipient address/);
  });

  it("rejects the zero address", () => {
    expect(() => buildPublicTransferCall(STRK, "0x0", 1n)).toThrow(/zero address/);
    expect(() => buildPublicTransferCall(STRK, "0x0000000000000000000000000000000000000000000000000000000000000000", 1n)).toThrow(
      /zero address/,
    );
  });
});