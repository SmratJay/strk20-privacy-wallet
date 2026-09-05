/**
 * Private Swap — REAL quote sources.
 *
 * The quote is the swap application's own on-chain quote view (`quote_buy` on the BondingCurve),
 * bound to the live reserves at read time. It is NEVER a UI-supplied output amount: the execution
 * re-quotes right before building the proof and rejects a stale/mutated quote that falls below the
 * confirmed min-output.
 *
 * The private-paymaster relay fee is read from the same AVNU paymaster the shadow path uses
 * (`Strk20Paymaster.build`), so the UI can show the effective private execution fee BEFORE
 * confirmation — never pretending the operation is free.
 */
import { uint256 } from "starknet";
import { Strk20Paymaster } from "@/privacy/strk20";
import type { PrivateSwapAppConfig } from "./apps";
import { PrivateSwapError } from "./types";

/** Read the swap application's real on-chain quote for `sellAmount` (base units). */
export async function getOnChainSwapQuote(
  provider: { callContract(call: unknown): Promise<string[]> },
  app: PrivateSwapAppConfig,
  sellAmount: bigint,
): Promise<{ buyAmount: bigint; asOfBlock: number | null }> {
  if (sellAmount <= 0n) throw new PrivateSwapError("Quote requires a positive sell amount.");
  // u128 base_amount on the BondingCurve (single felt).
  if (sellAmount > (1n << 128n) - 1n) {
    throw new PrivateSwapError("Sell amount exceeds the swap application's u128 limit.");
  }
  let result: string[];
  try {
    result = await provider.callContract({
      contractAddress: app.swapContract,
      entrypoint: app.quoteEntrypoint,
      calldata: ["0x" + sellAmount.toString(16)],
    });
  } catch (err) {
    throw new PrivateSwapError(
      `Could not read a private swap quote (${err instanceof Error ? err.message : "network error"}).`,
    );
  }
  const buyAmount = BigInt(result?.[0] ?? "0x0");
  if (buyAmount <= 0n) throw new PrivateSwapError("The swap application returned a zero quote.");
  return { buyAmount, asOfBlock: null };
}

/** Read the effective private-paymaster relay fee (STRK base units) for a shadow-account proof. */
export async function getPrivateExecutionFee(poolAddress: string, gasToken: string): Promise<bigint | null> {
  try {
    const terms = await new Strk20Paymaster().build(poolAddress, gasToken);
    return terms.fee?.amount ?? null;
  } catch {
    return null;
  }
}

/** Encode an ERC20 u256 `approve(spender, amount)` calldata for the shadow account. */
export function approveCalldata(spender: string, amount: bigint): string[] {
  const u256 = uint256.bnToUint256(amount);
  return [spender, String(u256.low), String(u256.high)];
}