/**
 * Privacy Core — private execution domain types (REAL STRK20 shadow-account execution).
 *
 * The smallest private-execution abstraction between Wallet Core/STRK20 and an external Starknet
 * application. It describes WHAT the user wants to execute privately through a REAL STRK20 shadow
 * account, never HOW:
 *
 *   Wallet Core        → custody + authority (unlocked session, local signer)
 *   STRK20             → privacy (viewing key, notes, proofs — WalletPrivacySession)
 *   PrivateExecutor    → shadow-account application execution (this module)
 *   NEAR               → future routing layer (NOT here)
 *
 * SECURITY INVARIANTS:
 *   - intents/receipts carry NO secrets: no viewing key, no notes, no proofs, no secret material;
 *   - a shadow identity is selected by (appName, nonce) and resolved + validated scoped to the
 *     active wallet + network (never trusted raw);
 *   - `calls` are strongly validated (address / entrypoint / felt calldata) — this is NOT an
 *     arbitrary unauthenticated transaction relay;
 *   - receipts only expose public lifecycle data (tx hash, status, commitment, shadow address).
 */

/** The only private-execution action supported. A real shadow-account application invocation. */
export type PrivateExecutionAction = "shadow.invoke";

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

/** A single application call the shadow account executes (strongly validated). */
export interface PrivateExecutionCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/**
 * What the user wants to execute privately. Validated by the executor BEFORE any SDK/proving
 * work happens (a malformed intent is rejected before execution).
 */
export interface PrivateExecutionIntent {
  /** The action kind. Phase 2 supports a single real shadow-account application invoke. */
  action: PrivateExecutionAction;
  /** Application scope (Cairo short string) shared by the shadow identity. */
  appName: string;
  /** Identity nonce — selects the deterministic shadow identity/address. A fresh nonce = a fresh
   * shadow identity (never silently reused). */
  nonce: bigint;
  /** Asset (STRK20 token address) that funds the shadow account. */
  token: string;
  /** Amount in base units withdrawn privately into the shadow account before the calls run. */
  amount: bigint;
  /** Application calls the shadow account executes (each strongly validated). */
  calls: PrivateExecutionCall[];
  /** Optional surplus/change recipient (defaults to the user's own wallet). */
  destination?: string;
  /** Optional deadline (ms epoch). Execution is refused after it. */
  expiry?: number;
}

/** Safe lifecycle state of a private execution — never exposes secrets/notes/proofs. */
export interface PrivateExecutionOpState {
  phase: PrivateExecutionPhase;
  action: PrivateExecutionAction | null;
  /** Human token symbol for the UI (never a secret). */
  tokenSymbol: string | null;
  /** Amount the private balance routed into the shadow account (base units). */
  amount: bigint | null;
  /** The shadow identity (appName · nonce) used. */
  appName: string | null;
  nonce: string | null;
  targetContract: string | null;
  /** The public shadow-account address the application observed as caller. */
  shadowAddress: string | null;
  transactionHash: string | null;
  message: string | null;
}

export const IDLE_PRIVATE_EXECUTION: PrivateExecutionOpState = {
  phase: "idle",
  action: null,
  tokenSymbol: null,
  amount: null,
  appName: null,
  nonce: null,
  targetContract: null,
  shadowAddress: null,
  transactionHash: null,
  message: null,
};

/**
 * Safe result of a private execution. Contains ONLY public lifecycle data:
 *   - transactionHash + status (on-chain truth),
 *   - the intent echo (action/token/amount/target),
 *   - public shadow-identity metadata (`commitment` + `shadowAddress` — on-chain data).
 */
export interface PrivateExecutionReceipt {
  transactionHash: string;
  status: "PENDING" | "SUCCESS" | "REVERTED" | "REJECTED";
  action: PrivateExecutionAction;
  token: string;
  amount: bigint;
  targetContract: string;
  appName: string;
  nonce: string;
  /** The STRK20 shadow-account commitment (public). */
  commitment: string;
  /** The deterministic shadow-account address that called the application (public). */
  shadowAddress: string;
  message?: string;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_FELT = /^0x[0-9a-fA-F]{1,64}$/;

/** Normalize an address/felt string to a lowercase canonical form for comparisons. */
export function canonicalFelt(value: bigint | string): string {
  return "0x" + BigInt(value).toString(16);
}

/**
 * Validate a single application call the shadow account will execute. This is the guard against
 * arbitrary unauthenticated calldata: address + entrypoint + felt-only calldata.
 */
export function validatePrivateExecutionCall(call: unknown): string | null {
  const c = call as PrivateExecutionCall | null;
  if (c === null || typeof c !== "object") return "call is not an object";
  if (typeof c.contractAddress !== "string" || !HEX_ADDRESS.test(c.contractAddress)) {
    return "malformed call contract address";
  }
  if (typeof c.entrypoint !== "string" || c.entrypoint.length === 0 || c.entrypoint.length > 64) {
    return "malformed call entrypoint";
  }
  if (!Array.isArray(c.calldata)) return "call calldata must be an array";
  for (const item of c.calldata) {
    if (typeof item !== "string" || !HEX_FELT.test(item)) return "call calldata must be felts";
  }
  return null;
}

/**
 * Validate a private-execution intent. Returns an error string, or null when the intent is valid.
 * Runs BEFORE any SDK/adapter/proving work — a malformed intent is never executed.
 */
export function validatePrivateExecutionIntent(intent: unknown): string | null {
  const i = intent as PrivateExecutionIntent | null;
  if (i === null || typeof i !== "object") return "intent is not an object";
  if (i.action !== "shadow.invoke") return `unsupported action: ${String(i.action)}`;
  if (typeof i.appName !== "string" || i.appName.trim().length === 0 || i.appName.length > 31) {
    return "malformed appName (Cairo short string)";
  }
  if (typeof i.nonce !== "bigint" || i.nonce < 0n) return "nonce must be a non-negative bigint";
  if (typeof i.token !== "string" || !HEX_ADDRESS.test(i.token)) return "malformed token address";
  if (typeof i.amount !== "bigint" || i.amount <= 0n) return "amount must be a positive bigint";
  if (!Array.isArray(i.calls) || i.calls.length === 0) return "at least one application call is required";
  for (const call of i.calls) {
    const invalidCall = validatePrivateExecutionCall(call);
    if (invalidCall) return `invalid call: ${invalidCall}`;
  }
  if (i.destination !== undefined && (typeof i.destination !== "string" || !HEX_ADDRESS.test(i.destination))) {
    return "malformed destination address";
  }
  if (i.expiry !== undefined && (typeof i.expiry !== "number" || !Number.isFinite(i.expiry))) {
    return "expiry must be a finite timestamp";
  }
  if (i.expiry !== undefined && i.expiry <= Date.now()) return "intent has expired";
  return null;
}