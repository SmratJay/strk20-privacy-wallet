/**
 * Privacy Core — private execution domain types.
 *
 * The smallest private-execution abstraction between Wallet Core/STRK20 and an external Starknet
 * application. It describes WHAT the user wants to execute privately, never HOW:
 *
 *   Wallet Core        → custody + authority (unlocked session, local signer)
 *   STRK20             → privacy (viewing key, notes, proofs — WalletPrivacySession)
 *   PrivateExecutor    → application execution (this module)
 *   NEAR               → future routing layer (NOT here)
 *
 * A `PrivateExecutionIntent` is deliberately minimal and application-agnostic. Wallet Core does
 * not know about applications, solvers, or swaps — it only knows that a private STRK20 balance
 * should cause an action on an external Starknet contract through the privacy layer.
 *
 * SECURITY INVARIANTS:
 *   - intents/receipts carry NO secrets: no viewing key, no notes, no proofs, no secret material;
 *   - an intent references a shadow identity by its PUBLIC `PrivateIdentity.id`, and the executor
 *     resolves + validates it scoped to the active wallet + network (never trusted raw);
 *   - receipts only ever expose public lifecycle data (tx hash, status, public identity metadata).
 */

/** The only private-execution action supported by Phase 1. */
export type PrivateExecutionAction = "application.invoke";

export type PrivateExecutionPhase =
  | "idle"
  | "preparing"
  | "proving"
  | "submitted"
  | "pending"
  | "success"
  | "reverted"
  | "rejected"
  | "failed";

/**
 * What the user wants to execute privately. Validated by the executor BEFORE any SDK/proving
 * work happens (a malformed intent is rejected before execution).
 */
export interface PrivateExecutionIntent {
  /** The action kind. Phase 1 supports a single external application invoke. */
  action: PrivateExecutionAction;
  /** Asset (STRK20 token address) that funds the application action. */
  token: string;
  /** Amount in base units the private balance spends on the application action. */
  amount: bigint;
  /** The external Starknet application contract the action targets. */
  targetContract: string;
  /**
   * The shadow identity used for the execution — the PUBLIC `PrivateIdentity.id`. The executor
   * resolves the real identity (and its shadow-account commitment) scoped to the active wallet +
   * network. NEVER an arbitrary caller-supplied commitment.
   */
  identity: string;
  /** Optional surplus/change recipient (defaults to the user's own wallet). */
  destination?: string;
  /** Optional constraint: minimum output the application action must produce (reserved, Phase 1 app-invoke). */
  minimumOutput?: bigint;
  /** Optional deadline (ms epoch). Execution is refused after it. */
  expiry?: number;
}

/** Safe lifecycle state of a private execution — never exposes secrets/notes/proofs. */
export interface PrivateExecutionOpState {
  phase: PrivateExecutionPhase;
  action: PrivateExecutionAction | null;
  /** Human token symbol for the UI (never a secret). */
  tokenSymbol: string | null;
  /** Amount the private balance spent, in base units. */
  amount: bigint | null;
  targetContract: string | null;
  /** The shadow identity id used (public metadata). */
  identityId: string | null;
  transactionHash: string | null;
  message: string | null;
}

export const IDLE_PRIVATE_EXECUTION: PrivateExecutionOpState = {
  phase: "idle",
  action: null,
  tokenSymbol: null,
  amount: null,
  targetContract: null,
  identityId: null,
  transactionHash: null,
  message: null,
};

/**
 * Safe result of a private execution. Contains ONLY public lifecycle data:
 *   - transactionHash + status (on-chain truth),
 *   - the intent echo (action/token/amount/target),
 *   - public identity metadata (`identityId`, and `executionId` = the public shadow commitment
 *     the application recorded — on-chain data, never a secret).
 */
export interface PrivateExecutionReceipt {
  transactionHash: string;
  status: "PENDING" | "SUCCESS" | "REVERTED" | "REJECTED";
  action: PrivateExecutionAction;
  token: string;
  amount: bigint;
  targetContract: string;
  identityId: string;
  /** The STRK20 shadow-account commitment (public) the application executed under. */
  executionId: string;
  message?: string;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

/** Normalize an address/felt string to a lowercase canonical form for comparisons. */
export function canonicalFelt(value: bigint | string): string {
  return "0x" + BigInt(value).toString(16);
}

/**
 * Validate a private-execution intent. Returns an error string, or null when the intent is valid.
 * Runs BEFORE any SDK/adapter/proving work — a malformed intent is never executed.
 */
export function validatePrivateExecutionIntent(intent: unknown): string | null {
  const i = intent as PrivateExecutionIntent | null;
  if (i === null || typeof i !== "object") return "intent is not an object";
  if (i.action !== "application.invoke") return `unsupported action: ${String(i.action)}`;
  if (typeof i.token !== "string" || !HEX_ADDRESS.test(i.token)) return "malformed token address";
  if (typeof i.targetContract !== "string" || !HEX_ADDRESS.test(i.targetContract)) {
    return "malformed target contract address";
  }
  if (typeof i.identity !== "string" || !HEX_ID.test(i.identity)) return "malformed identity id";
  if (typeof i.amount !== "bigint" || i.amount <= 0n) return "amount must be a positive bigint";
  if (i.destination !== undefined && (typeof i.destination !== "string" || !HEX_ADDRESS.test(i.destination))) {
    return "malformed destination address";
  }
  if (i.minimumOutput !== undefined && (typeof i.minimumOutput !== "bigint" || i.minimumOutput < 0n)) {
    return "minimumOutput must be a non-negative bigint";
  }
  if (i.expiry !== undefined && (typeof i.expiry !== "number" || !Number.isFinite(i.expiry))) {
    return "expiry must be a finite timestamp";
  }
  if (i.expiry !== undefined && i.expiry <= Date.now()) return "intent has expired";
  return null;
}