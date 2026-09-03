/**
 * Wallet Core — public ERC-20 transfer call builder.
 *
 * Encodes a public `transfer(recipient, amount: u256)` call correctly:
 *
 *   ERC20 transfer calldata MUST be `[recipient, amountLow, amountHigh]`.
 *
 * The `amount` is a Starknet u256 (two felts). Encoding it as a single bigint felt produces
 * `[recipient, amount]` (calldata length 2), which fails deserialization of param #2 on-chain
 * (argent/multicall-failed, ENTRYPOINT_FAILED). This builder uses starknet.js's canonical
 * `uint256.bnToUint256` so the amount is always a real u256 low/high pair.
 *
 * The recipient is validated and normalized BEFORE any RPC work; the zero address is rejected.
 */

import { CallData, uint256, validateAndParseAddress } from "starknet";
import type { Call } from "starknet";

/** Validate + normalize a Starknet address, or throw a clear error. */
export function normalizeTransferRecipient(raw: string): string {
  let normalized: string;
  try {
    normalized = validateAndParseAddress(raw);
  } catch {
    throw new Error("Invalid recipient address. Enter a valid 0x Starknet address.");
  }
  if (BigInt(normalized) === 0n) {
    throw new Error("Invalid recipient address: the zero address cannot receive funds.");
  }
  return normalized;
}

/**
 * Build the ERC-20 `transfer` call for a public send.
 *
 * @param tokenAddress the ERC-20 token contract address
 * @param rawRecipient the user-entered recipient (validated + normalized here)
 * @param amountBase   the exact base-unit amount (bigint, from `parseAmountToBase`)
 * @returns a starknet.js Call with calldata `[recipient, amountLow, amountHigh]`
 */
export function buildPublicTransferCall(tokenAddress: string, rawRecipient: string, amountBase: bigint): Call {
  if (amountBase <= 0n) throw new Error("Amount must be greater than zero.");
  const recipient = normalizeTransferRecipient(rawRecipient);
  return {
    contractAddress: tokenAddress,
    entrypoint: "transfer",
    calldata: CallData.compile({ recipient, amount: uint256.bnToUint256(amountBase) }),
  };
}