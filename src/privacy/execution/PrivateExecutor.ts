/**
 * Privacy Core — PrivateExecutor contract.
 *
 * The application-execution boundary between the STRK20 privacy layer and external Starknet
 * applications:
 *
 *   Wallet Core (custody) → STRK20 (privacy) → PrivateExecutor (application execution) → Starknet
 *
 * An executor turns a `PrivateExecutionIntent` into a safe `PrivateExecutionReceipt` using the
 * privacy layer ONLY — never a public master-wallet fallback, never a second wallet/signer.
 */
import type { PrivateExecutionIntent, PrivateExecutionReceipt } from "./types";

export interface PrivateExecutor {
  /** Human-readable executor identity (for diagnostics/UI labels). */
  readonly name: string;
  /**
   * Execute a private application action. Returns a SAFE receipt (tx hash + status + public
   * identity metadata). Rejects on malformed/locked/stale inputs before any SDK work.
   */
  execute(intent: PrivateExecutionIntent): Promise<PrivateExecutionReceipt>;
}