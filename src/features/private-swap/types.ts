/**
 * Private Swap — feature-scoped types (REAL STRK20 shadow-account swap).
 *
 * The one user-facing private application built on the existing STRK20 shadow-account
 * primitive: private STRK → shadow identity → real shadow account → REAL swap application
 * (the pinned BondingCurve V2) → private output token collected back into the private balance.
 *
 *   UI → WalletRuntime.executePrivateSwap(intent) → PrivateSwapService → WalletPrivacySession
 *     → shadowAccountInvoke → SDK shadowAccounts(appName).invoke(nonce, { calls })
 *     → private paymaster → BondingCurve.buy (the swap) → STRKFTW note → private result
 *
 * The feature NEVER exposes arbitrary Starknet calls to the user. The intent is a typed
 * `PrivateSwapIntent`; the feature internally converts it into the exact swap calls against a
 * typed application config (`PRIVATE_SWAP_APPS`) that owns the target contract + selectors.
 *
 * SECURITY INVARIANTS:
 *   - the intent carries NO secrets (no viewing key / notes / proofs / keys);
 *   - output amounts are NEVER trusted from the UI — the min-output is derived from the real
 *     on-chain quote + slippage, and re-validated right before execution (stale/mutated quotes
 *     are rejected);
 *   - the quote is bound to the exact (sellToken, buyToken, sellAmount, network) pair;
 *   - the shadow identity is resolved wallet + network scoped (never trusted raw);
 *   - the receipt exposes only public lifecycle data (tx hash, shadow address, amounts).
 */

import type { TokenInfo } from "@/config/networks";

/** The only private-swap direction supported. BUY = spend private STRK for the app's token. */
export type PrivateSwapAction = "private.swap";

export type PrivateSwapPhase =
  | "idle"
  | "quoting"
  | "preparing"
  | "funding"
  | "proving"
  | "relaying"
  | "pending"
  | "success"
  | "reverted"
  | "rejected"
  | "failed"
  | "unknown";

/** What the user wants to swap privately. Validated by the service BEFORE any quote/proof work. */
export interface PrivateSwapIntent {
  action: PrivateSwapAction;
  /** STRK20 token the user sells (must match a PRIVATE_SWAP_APPS sell token for the network). */
  sellToken: string;
  /** Token the user receives (must match the same app config buy token). */
  buyToken: string;
  /** Amount to sell in base units (never float; validated against the sell token decimals). */
  sellAmount: bigint;
  /** Allowed slippage in basis points (0..10000). Drives the min-output, never the quote itself. */
  slippageBps: number;
  /** Shadow identity scope (Cairo short string). */
  appName: string;
  /** Identity nonce — selects the deterministic shadow identity/address. */
  nonce: bigint;
  /** Optional deadline (ms epoch). Execution is refused after it. */
  expiry?: number;
}

/** A REAL on-chain quote bound to the current application state. Never a UI-provided output. */
export interface PrivateSwapQuote {
  /** The application contract that executes the swap. */
  swapContract: string;
  sellToken: string;
  buyToken: string;
  /** Gross sell amount (base units) the quote is for. */
  sellAmount: bigint;
  /** On-chain quoted buy amount (base units) from the application's quote view. */
  buyAmount: bigint;
  /** Minimum acceptable output (buyAmount adjusted by slippage) — the execution floor. */
  minOutput: bigint;
  /** Human route label (the application name). */
  route: string;
  /** Private-paymaster relay fee (STRK base units), surfaced BEFORE confirmation. */
  feeStrk: bigint | null;
  /** Slippage (bps) used to derive minOutput. */
  slippageBps: number;
  /** The block the quote was read at (numeric), when known. */
  asOfBlock: number | null;
}

/** Safe lifecycle state of a private swap — never exposes secrets/notes/proofs. */
export interface PrivateSwapOpState {
  phase: PrivateSwapPhase;
  sellTokenSymbol: string | null;
  buyTokenSymbol: string | null;
  sellAmount: bigint | null;
  /** The confirmed min-output (base units) the execution must meet. */
  minOutput: bigint | null;
  estimatedBuy: bigint | null;
  feeStrk: bigint | null;
  appName: string | null;
  nonce: string | null;
  swapContract: string | null;
  shadowAddress: string | null;
  transactionHash: string | null;
  message: string | null;
}

export const IDLE_PRIVATE_SWAP: PrivateSwapOpState = {
  phase: "idle",
  sellTokenSymbol: null,
  buyTokenSymbol: null,
  sellAmount: null,
  minOutput: null,
  estimatedBuy: null,
  feeStrk: null,
  appName: null,
  nonce: null,
  swapContract: null,
  shadowAddress: null,
  transactionHash: null,
  message: null,
};

/** Safe result of a private swap. Only public lifecycle data + amounts. */
export interface PrivateSwapReceipt {
  transactionHash: string;
  status: "PENDING" | "SUCCESS" | "REVERTED" | "REJECTED";
  action: PrivateSwapAction;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  /** The confirmed min-output the execution was bound to (base units). */
  minOutput: bigint;
  appName: string;
  nonce: string;
  /** The swap application contract the shadow account called. */
  swapContract: string;
  /** The deterministic shadow-account address that executed the swap (public). */
  shadowAddress: string;
  /** The STRK20 shadow-account commitment (public). */
  commitment: string;
  message?: string;
}

/** Errors the private-swap service can throw, typed for honest UI handling. */
export class PrivateSwapError extends Error {
  override readonly name: string = "PrivateSwapError";
  constructor(message: string) {
    super(message);
  }
}

export class PrivateSwapQuoteStaleError extends PrivateSwapError {
  override readonly name = "PrivateSwapQuoteStaleError";
  constructor(message?: string) {
    super(message ?? "The private swap quote moved outside your slippage. Re-quote before swapping.");
  }
}

/** Valid slippage range: 0..10000 bps (0%..100%). */
export function isValidSlippageBps(slippageBps: number): boolean {
  return (
    Number.isFinite(slippageBps) &&
    slippageBps >= 0 &&
    slippageBps <= 10_000 &&
    Math.floor(slippageBps) === slippageBps
  );
}

/** Compute the minimum acceptable output for `buyAmount` under `slippageBps`. Integer math only. */
export function computeMinOutput(buyAmount: bigint, slippageBps: number): bigint {
  if (buyAmount < 0n || !isValidSlippageBps(slippageBps)) throw new PrivateSwapError("Invalid min-output inputs.");
  if (slippageBps === 0) return buyAmount;
  return (buyAmount * BigInt(10_000 - slippageBps)) / 10_000n;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

/** Validate a private-swap intent. Returns an error string, or null when valid. Runs BEFORE any
 * SDK/quote/proof work — a malformed intent is never executed. Token/network-specific checks
 * happen in the service against the typed app config. */
export function validatePrivateSwapIntent(intent: unknown): string | null {
  const i = intent as PrivateSwapIntent | null;
  if (i === null || typeof i !== "object") return "intent is not an object";
  if (i.action !== "private.swap") return `unsupported action: ${String(i.action)}`;
  if (typeof i.sellToken !== "string" || !HEX_ADDRESS.test(i.sellToken)) return "malformed sellToken";
  if (typeof i.buyToken !== "string" || !HEX_ADDRESS.test(i.buyToken)) return "malformed buyToken";
  if (typeof i.sellAmount !== "bigint" || i.sellAmount <= 0n) return "sellAmount must be a positive bigint";
  if (!isValidSlippageBps(i.slippageBps)) return "slippage must be an integer in basis points (0..10000)";
  if (typeof i.appName !== "string" || i.appName.trim().length === 0 || i.appName.length > 31) {
    return "malformed appName (Cairo short string)";
  }
  if (typeof i.nonce !== "bigint" || i.nonce < 0n) return "nonce must be a non-negative bigint";
  if (i.expiry !== undefined && (typeof i.expiry !== "number" || !Number.isFinite(i.expiry))) {
    return "expiry must be a finite timestamp";
  }
  if (i.expiry !== undefined && i.expiry <= Date.now()) return "intent has expired";
  return null;
}

/** Resolve the human symbol for a token from a config token list (UI label, never a secret). */
export function tokenSymbolFor(token: string, tokens: TokenInfo[]): string | null {
  return tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ?? null;
}