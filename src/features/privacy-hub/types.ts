/**
 * Privacy Hub — provider-agnostic cross-chain orchestration types.
 *
 * The PrivacyHub is an ORCHESTRATION layer only. It owns NO keys, implements NO privacy primitive,
 * performs NO NEAR HTTP calls, and solves NO route itself. Its job is to normalize a typed intent,
 * resolve it to a route + provider, and forward the quote/prepare/execute/reconcile lifecycle to
 * that provider (today: the existing `NearIntentAdapter` via `NearIntentProvider`).
 *
 * Privacy boundary (documented, explicit):
 *   - PRIVATE: root wallet → STRK20 private balance → Shadow Account (STRK20 is the privacy
 *     primitive; the Shadow Account is the private execution identity).
 *   - PUBLIC:  Shadow Account → NEAR deposit (an on-chain STRK transfer).
 *   - PUBLIC:  NEAR solver → destination chain settlement.
 * The PrivacyHub adds NO privacy. It never claims anonymous or untraceable cross-chain transfers.
 *
 * PROVIDER-AGNOSTIC SURFACE: nothing here references NEAR asset ids, deposit addresses, solver
 * internals, proofs, notes, or viewing keys. Provider-specific data crosses the boundary only as an
 * opaque `providerPayload` that only the originating provider understands.
 */

/** Source chain of the single supported route (Starknet — where STRK20 privacy lives). */
export type PrivacyHubSourceChain = "starknet";
/** Source asset (Starknet STRK). */
export type PrivacyHubSourceAsset = "strk";
/** Destination chain (Base). */
export type PrivacyHubDestinationChain = "base" | "solana";
/** Destination asset (Base USDC). */
export type PrivacyHubDestinationAsset = string;

/** Normalized provider-agnostic lifecycle (provider states are collapsed into this set). */
export type PrivacyHubPhase =
  | "idle"
  | "quoting"
  | "preparing"
  | "funding"
  | "processing"
  | "destination-pending"
  | "success"
  | "failed"
  | "refunded"
  | "expired"
  | "unknown";

/**
 * A typed hub-level cross-chain intent. Chain/token-generic; carries NO NEAR detail, deposit
 * address, solver instruction, proof, note, viewing key, or secret.
 */
export interface PrivacyHubIntent {
  sourceChain: PrivacyHubSourceChain;
  sourceAsset: PrivacyHubSourceAsset;
  sourceAmount: bigint;
  destinationChain: PrivacyHubDestinationChain;
  destinationAsset: PrivacyHubDestinationAsset;
  /** Destination-chain address (user-supplied, validated). Never the root Starknet address. */
  destinationAddress: string;
  /** Allowed slippage in basis points (0..10000). Drives the min-output floor. */
  slippageBps: number;
  /** Private execution identity scope (Cairo short string). */
  appName: string;
  /** Identity nonce — selects the deterministic shadow identity/address. */
  nonce: bigint;
  /** Optional deadline (ms epoch). Quote/execution refused after it. */
  expiry?: number;
  /** Optional explicit route id (defaults to the resolved single route). */
  routeId?: string;
}

/** A provider-agnostic pricing quote. Never a UI-supplied output. */
export interface PrivacyHubQuote {
  route: string;
  provider: string;
  sourceChain: PrivacyHubSourceChain;
  sourceAsset: PrivacyHubSourceAsset;
  sourceAmount: bigint;
  destinationChain: PrivacyHubDestinationChain;
  destinationAsset: PrivacyHubDestinationAsset;
  destinationAddress: string;
  amountOut: bigint;
  minAmountOut: bigint;
  refundFee: bigint | null;
  withdrawFee: bigint | null;
  timeEstimate: number;
  deadline: string;
  slippageBps: number;
  /** Provider-internal payload consumed only by the same provider's prepare() (opaque). */
  providerPayload?: unknown;
}

/** A prepared (publish-step) intent: the provider reserved what it needs to execute. */
export interface PrivacyHubPrepared {
  route: string;
  provider: string;
  /** Provider-scoped status reference (e.g. the deposit address). Opaque to the hub. */
  reference: string;
  sourceAmount: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  destinationAddress: string;
  /** Provider-internal payload consumed only by the same provider's execute(). Opaque. */
  providerPayload: unknown;
}

/** Normalized provider-agnostic status of an intent's on-chain settlement. Never fabricated. */
export interface PrivacyHubStatus {
  provider: string;
  reference: string;
  phase: PrivacyHubPhase;
  /** Provider terminal/reconcile flags. */
  terminal: boolean;
  /** True ONLY when the destination settlement is reconciled by the provider. */
  settled: boolean;
  amountOut: bigint | null;
  refundedAmount: bigint;
  refundReason: string | null;
  destinationTxHashes: string[];
  message?: string;
}

/** Safe result of a cross-chain intent. Only public lifecycle data + amounts + status. */
export interface PrivacyHubReceipt {
  route: string;
  provider: string;
  reference: string;
  phase: PrivacyHubPhase;
  sourceAmount: bigint;
  destinationAddress: string;
  amountOut: bigint | null;
  /** Source-chain transaction (the shadow account's deposit) — public. */
  transactionHash: string;
  destinationTxHashes: string[];
  refundedAmount: bigint;
  refundReason: string | null;
  message?: string;
}

/** Structured live-readiness result (provider-agnostic). */
export interface PrivacyHubReadiness {
  provider: string;
  ready: boolean;
  checks: { name: string; ok: boolean; detail: string | null }[];
  reason: string | null;
}

export class PrivacyHubError extends Error {
  override readonly name = "PrivacyHubError";
  constructor(message: string) {
    super(message);
  }
}

import { validateChainAddress } from '../near-intents/address';

export function isValidHubSlippageBps(slippageBps: number): boolean {
  return (
    Number.isFinite(slippageBps) &&
    slippageBps >= 0 &&
    slippageBps <= 10_000 &&
    Math.floor(slippageBps) === slippageBps
  );
}

/** Validate a hub-level intent. Returns an error string, or null when valid. No provider work. */
export function validatePrivacyHubIntent(intent: unknown): string | null {
  const i = intent as PrivacyHubIntent | null;
  if (i === null || typeof i !== "object") return "intent is not an object";
  if (i.sourceChain !== "starknet") return `unsupported source chain: ${String(i.sourceChain)}`;
  if (i.sourceAsset !== "strk") return `unsupported source asset: ${String(i.sourceAsset)}`;
  if (typeof i.sourceAmount !== "bigint" || i.sourceAmount <= 0n) {
    return "sourceAmount must be a positive bigint";
  }
  if (i.destinationChain !== "base" && i.destinationChain !== "solana") return `unsupported destination chain: ${String(i.destinationChain)}`;
  if ((i.destinationChain === 'base' && i.destinationAsset !== 'usdc') || typeof i.destinationAsset !== 'string' || !i.destinationAsset) return `unsupported destination asset: ${String(i.destinationAsset)}`;
  const addressError = validateChainAddress(i.destinationAddress, i.destinationChain === 'solana' ? 'solana' : 'evm');
  if (addressError) return addressError;
  if (!isValidHubSlippageBps(i.slippageBps)) return "slippage must be an integer in basis points (0..10000)";
  if (typeof i.appName !== "string" || i.appName.trim().length === 0 || i.appName.length > 31) {
    return "malformed appName (Cairo short string)";
  }
  if (typeof i.nonce !== "bigint" || i.nonce < 0n) return "nonce must be a non-negative bigint";
  if (i.expiry !== undefined && (typeof i.expiry !== "number" || !Number.isFinite(i.expiry))) {
    return "expiry must be a finite timestamp";
  }
  if (i.expiry !== undefined && i.expiry <= Date.now()) return "intent has expired";
  if (i.routeId !== undefined && typeof i.routeId !== "string") return "routeId must be a string";
  return null;
}

/** Compute the minimum acceptable output for `amountOut` under `slippageBps`. Integer math only. */
export function computeHubMinOutput(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut < 0n || !isValidHubSlippageBps(slippageBps)) throw new PrivacyHubError("Invalid min-output inputs.");
  if (slippageBps === 0) return amountOut;
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}
