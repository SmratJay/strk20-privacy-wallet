/**
 * Near Intents — feature-scoped domain types (REAL NEAR Intents cross-chain routing).
 *
 * This feature is a ROUTING / SETTLEMENT layer on top of the existing STRK20 privacy stack. It
 * never re-implements privacy and never claims to make a cross-chain route private by itself:
 *
 *   Wallet Core (custody)
 *     → STRK20 private balance (privacy)
 *     → shadow identity → shadow account (private execution identity)
 *     → shadow account transfers STRK to the NEAR Intents deposit address (public, on-chain)
 *     → NEAR Intents solver swaps STRK → destination token
 *     → destination chain receives the output at a user-supplied address
 *
 * SECURITY / PRIVACY BOUNDARY (documented, explicit):
 *   - the intent/receipt carry NO secrets: no viewing key, notes, proofs, NEAR keys, or calldata;
 *   - the DESTINATION address is always user-supplied and validated (never derived from the root
 *     wallet — the root Starknet address is not even a valid destination-chain address);
 *   - the source private balance is spent through the EXISTING shadow-account path (the root wallet
 *     is never the on-chain depositor); there is NO public master-wallet fallback;
 *   - NEAR Intents is routing/settlement only — the privacy primitive stays in STRK20/Shadow
 *     Account. What is PRIVATE (root ↔ shadow), PUBLIC (shadow ↔ NEAR deposit), and LINKABLE
 *     (deposit ↔ destination settlement) is documented in docs/NEAR_INTENTS.md.
 *
 * No NEAR credentials ever reach the browser: the 1Click deposit flow needs no NEAR key — it is a
 * plain Starknet transfer plus HTTP quote/status calls. The optional partner JWT (fee waiver) is
 * server-only and is NOT required here.
 */

/** The only cross-chain intent action supported. */
export type NearIntentAction = "cross-chain.swap";

/** Source chain of the single supported route (Starknet — the STRK20 privacy layer lives here). */
export type NearIntentSourceChain = "starknet";
/** Destination chain of the single supported route. */
export type NearIntentDestinationChain = "base" | "solana";
/** Canonical source asset (Starknet STRK). */
export type NearIntentSourceAsset = "strk";
/** Canonical destination asset (Base USDC). */
export type NearIntentDestinationAsset = string;

export type NearIntentPhase =
  | "idle"
  | "quoting"
  | "preparing"
  | "intent-created"
  | "awaiting-source-deposit"
  | "source-confirming"
  | "solver-executing"
  | "destination-pending"
  | "success"
  | "failed"
  | "refunded"
  | "expired"
  | "unknown";

/** Status codes the NEAR Intents 1Click API reports (verbatim). */
export type NearIntentStatusCode =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

/**
 * What the user wants to route cross-chain. Validated BEFORE any API/quote/proof work. The intent
 * is chain/token-generic — it never carries NEAR asset ids, solver data, or calldata.
 */
export interface CrossChainPrivateIntent {
  action: NearIntentAction;
  sourceChain: NearIntentSourceChain;
  /** Canonical source asset key ("strk"). Resolved to a Starknet token address by the route. */
  sourceAsset: NearIntentSourceAsset;
  /** Source amount in base units (STRK, 18 decimals). */
  sourceAmount: bigint;
  destinationChain: NearIntentDestinationChain;
  /** Canonical destination asset key ("usdc"). Resolved to a NEAR asset id by the route. */
  destinationAsset: NearIntentDestinationAsset;
  /** Destination address on the destination chain (validated EVM 0x address, user-supplied). */
  destinationAddress: string;
  /** Allowed slippage in basis points (0..10000). Drives the min-output floor. */
  slippageBps: number;
  /** Shadow identity scope (Cairo short string) — the private execution identity that deposits. */
  appName: string;
  /** Identity nonce — selects the deterministic shadow identity/address. */
  nonce: bigint;
  /** Optional deadline (ms epoch). The quote/execution is refused after it. */
  expiry?: number;
}

/** A REAL pricing quote (dry) from the NEAR Intents 1Click API. Never a UI-provided output. */
export interface NearIntentQuote {
  sourceChain: NearIntentSourceChain;
  sourceAsset: NearIntentSourceAsset;
  sourceAmount: bigint;
  destinationChain: NearIntentDestinationChain;
  destinationAsset: NearIntentDestinationAsset;
  destinationAddress: string;
  /** Quoted output amount (destination base units). */
  amountOut: bigint;
  /** Minimum acceptable output (amountOut adjusted by slippage). */
  minAmountOut: bigint;
  /** Bridge refund fee (source STRK base units) deducted on refund. */
  refundFee: bigint | null;
  /** Withdrawal fee on the destination chain (destination base units). */
  withdrawFee: bigint | null;
  /** Estimated solver time (seconds). */
  timeEstimate: number;
  /** Quote freshness deadline (ISO). */
  deadline: string;
  /** Human route label. */
  route: string;
  slippageBps: number;
}

/**
 * A prepared (non-dry) quote: the NEAR Intents service has RESERVED a deposit address for the swap.
 * This is the publish step — the deposit address is where the shadow account sends STRK.
 */
export interface NearIntentPrepared extends NearIntentQuote {
  /** Starknet address to fund (the shadow account transfers STRK here). */
  depositAddress: string;
  /** Deposit-address inactivity window (ISO) — the swap must be funded before it. */
  depositAddressDeadline: string;
  /** Correlation id the 1Click API assigned (intent id for tracking). */
  intentId: string;
  /** The Starknet STRK token address the shadow account transfers. */
  sourceTokenAddress: string;
}

/** Safe lifecycle state of a cross-chain intent — never exposes secrets/notes/proofs. */
export interface NearIntentOpState {
  phase: NearIntentPhase;
  destinationChain?: NearIntentDestinationChain;
  destinationDecimals?: number;
  route?: string;
  sourceSymbol: string | null;
  destinationSymbol: string | null;
  sourceAmount: bigint | null;
  amountOut: bigint | null;
  depositAddress: string | null;
  destinationAddress: string | null;
  shadowAddress: string | null;
  transactionHash: string | null;
  status: NearIntentStatusCode | null;
  /** Destination-chain (Base) tx hashes, for verification/links when settled. */
  destinationTxHashes: string[];
  /** Amount refunded to the shadow account (source base units) when refunded. */
  refundedAmount: bigint | null;
  /** Refund reason (null unless refunded). */
  refundReason: string | null;
  message: string | null;
}

export const IDLE_NEAR_INTENT: NearIntentOpState = {
  phase: "idle",
  sourceSymbol: null,
  destinationSymbol: null,
  sourceAmount: null,
  amountOut: null,
  depositAddress: null,
  destinationAddress: null,
  shadowAddress: null,
  transactionHash: null,
  status: null,
  destinationTxHashes: [],
  refundedAmount: null,
  refundReason: null,
  message: null,
};

/** Reconciled status of an intent's on-chain settlement. Never fabricated. */
export interface NearIntentStatus {
  code: NearIntentStatusCode;
  depositAddress: string;
  intentHashes: string[];
  nearTxHashes: string[];
  originChainTxHashes: string[];
  destinationChainTxHashes: string[];
  amountIn: bigint | null;
  amountOut: bigint | null;
  refundedAmount: bigint;
  refundReason: string | null;
  /** True for terminal states (SUCCESS / REFUNDED / FAILED / INCOMPLETE_DEPOSIT). */
  terminal: boolean;
  /** True ONLY when the destination settlement is confirmed (code === "SUCCESS"). */
  settled: boolean;
}

/** Safe result of a cross-chain intent. Only public lifecycle data + amounts + status. */
export interface NearIntentReceipt {
  route?: string;
  intentId: string;
  depositAddress: string;
  status: NearIntentStatusCode;
  sourceChain: NearIntentSourceChain;
  destinationChain: NearIntentDestinationChain;
  sourceAsset: NearIntentSourceAsset;
  sourceAmount: bigint;
  destinationAsset: NearIntentDestinationAsset;
  destinationAddress: string;
  /** Destination amount the solver delivered (destination base units), when settled. */
  amountOut: bigint | null;
  /** The shadow account (private execution identity) that funded the deposit. */
  shadowAddress: string;
  /** The STRK20 shadow-account commitment (public). */
  commitment: string;
  /** The Starknet shadow-account transaction that funded the NEAR deposit (source tx). */
  transactionHash: string;
  /** NEAR verifier tx hashes (settlement on NEAR). Public corroboration, never secrets. */
  nearTxHashes: string[];
  /** Destination-chain (Base) tx hashes — the destination settlement evidence. */
  destinationChainTxHashes: string[];
  /** Amount refunded to the refund target (source base units), when the swap refunded. */
  refundedAmount: bigint;
  /** Refund reason reported by NEAR (null unless refunded). */
  refundReason: string | null;
  message?: string;
}

/** Errors the near-intents adapter can throw, typed for honest UI handling. */
export class NearIntentError extends Error {
  override readonly name: string = "NearIntentError";
  constructor(message: string) {
    super(message);
  }
}

export class NearIntentQuoteStaleError extends NearIntentError {
  override readonly name = "NearIntentQuoteStaleError";
  constructor(message?: string) {
    super(message ?? "The cross-chain quote moved outside your slippage. Re-quote before sending.");
  }
}

export class NearIntentUnsupportedRouteError extends NearIntentError {
  override readonly name = "NearIntentUnsupportedRouteError";
  constructor(message?: string) {
    super(message ?? "Unsupported cross-chain route.");
  }
}

/** The NEAR service rejected the swap (FAILED / INCOMPLETE_DEPOSIT). Not success. */
export class NearIntentRejectedError extends NearIntentError {
  override readonly name = "NearIntentRejectedError";
  constructor(message?: string) {
    super(message ?? "The cross-chain intent was rejected by the NEAR Intents service.");
  }
}

/** The intent could not be reconciled to a terminal state (timeout / API unreachable). */
export class NearIntentUnknownError extends NearIntentError {
  override readonly name = "NearIntentUnknownError";
  constructor(message?: string) {
    super(message ?? "The cross-chain intent status could not be reconciled.");
  }
}

const HEX_FELT = /^0x[0-9a-fA-F]{1,64}$/;
import { validateChainAddress } from './address';

/** Valid slippage range: 0..10000 bps (0%..100%). */
export function isValidSlippageBps(slippageBps: number): boolean {
  return (
    Number.isFinite(slippageBps) &&
    slippageBps >= 0 &&
    slippageBps <= 10_000 &&
    Math.floor(slippageBps) === slippageBps
  );
}

/** Validate a destination-chain (EVM) address. Returns an error string, or null when valid. */
export function validateDestinationAddress(value: unknown, chain: NearIntentDestinationChain = 'base'): string | null {
  return validateChainAddress(value, chain === 'solana' ? 'solana' : 'evm');
}

/** Compute the minimum acceptable output for `amountOut` under `slippageBps`. Integer math only. */
export function computeMinOutput(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut < 0n || !isValidSlippageBps(slippageBps)) throw new NearIntentError("Invalid min-output inputs.");
  if (slippageBps === 0) return amountOut;
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Validate a cross-chain intent. Returns an error string, or null when valid. Runs BEFORE any
 * API/quote/proof work — a malformed intent is never executed. Token/network/route-specific
 * checks happen in the adapter against the typed route registry.
 */
export function validateCrossChainIntent(intent: unknown): string | null {
  const i = intent as CrossChainPrivateIntent | null;
  if (i === null || typeof i !== "object") return "intent is not an object";
  if (i.action !== "cross-chain.swap") return `unsupported action: ${String(i.action)}`;
  if (i.sourceChain !== "starknet") return `unsupported source chain: ${String(i.sourceChain)}`;
  if (i.sourceAsset !== "strk") return `unsupported source asset: ${String(i.sourceAsset)}`;
  if (typeof i.sourceAmount !== "bigint" || i.sourceAmount <= 0n) {
    return "sourceAmount must be a positive bigint";
  }
  if (i.destinationChain !== "base" && i.destinationChain !== "solana") return `unsupported destination chain: ${String(i.destinationChain)}`;
  if ((i.destinationChain === 'base' && i.destinationAsset !== 'usdc') || typeof i.destinationAsset !== 'string' || !i.destinationAsset) return `unsupported destination asset: ${String(i.destinationAsset)}`;
  const dest = validateDestinationAddress(i.destinationAddress, i.destinationChain);
  if (dest) return dest;
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

/** Validate a Starknet felt/address string (the deposit address the API returns). */
export function isValidStarknetAddress(value: unknown): value is string {
  return typeof value === "string" && HEX_FELT.test(value);
}

/**
 * Map a NEAR Intents 1Click status code to the honest cross-chain lifecycle phase.
 *
 * UNKNOWN is never collapsed into FAILED, and SUCCESS is never claimed before the service reports
 * SUCCESS (destination settlement). Note the 1Click API folds destination-chain confirmation into
 * `PROCESSING` → `SUCCESS` (there is no distinct "destination pending" status), so `PROCESSING` is
 * reported as `solver-executing` and `destination-pending` is reserved for a future, more granular
 * status source — it is never fabricated here.
 */
export function nearIntentPhaseForStatus(status: NearIntentStatusCode): NearIntentPhase {
  switch (status) {
    case "SUCCESS":
      return "success";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
    case "INCOMPLETE_DEPOSIT":
      return "failed";
    case "PENDING_DEPOSIT":
      return "awaiting-source-deposit";
    case "KNOWN_DEPOSIT_TX":
      return "source-confirming";
    case "PROCESSING":
      return "solver-executing";
    default:
      return "solver-executing";
  }
}
