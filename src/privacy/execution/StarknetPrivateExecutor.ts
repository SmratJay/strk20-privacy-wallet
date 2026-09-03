/**
 * Privacy Core — the first PrivateExecutor: StarknetPrivateExecutor.
 *
 * Consumes the existing unlocked Wallet Core session + WalletPrivacySession and executes a
 * private Starknet application action through the STRK20 privacy layer:
 *
 *   WalletRuntime → WalletPrivacySession → Strk20Adapter / official SDK → private action → Starknet
 *
 * It NEVER:
 *   - bypasses WalletPrivacySession (the viewing key stays inside the session),
 *   - exposes the viewing key, notes, proofs, or secret material,
 *   - adds another signer/wallet,
 *   - falls back to a public master-wallet transaction path.
 *
 * Shadow-account model (Phase 1):
 *   Master Wallet (custody) → PrivateIdentity (shadow commitment) → Private App Execution
 * A shadow account is an EXECUTION IDENTITY derived from the user's Wallet Core authority — NOT a
 * second master wallet and NOT another custody system. The application only ever sees the public
 * shadow commitment; the Wallet Core remains the ultimate authority that signs the proof.
 */
import type { UnlockedWallet } from "@/wallet";
import type { WalletPrivacySession } from "@/wallet/privacy";
import type { PrivateExecutor } from "./PrivateExecutor";
import {
  validatePrivateExecutionIntent,
  type PrivateExecutionIntent,
  type PrivateExecutionReceipt,
} from "./types";

export interface StarknetPrivateExecutorOptions {
  /** The unlocked Wallet Core session (authority + local signer). */
  wallet: UnlockedWallet;
  /** The live wallet-native STRK20 privacy session (viewing key + adapter, internal only). */
  privacySession: WalletPrivacySession;
}

export class StarknetPrivateExecutor implements PrivateExecutor {
  readonly name = "starknet-private-executor";
  private readonly wallet: UnlockedWallet;
  private readonly privacySession: WalletPrivacySession;

  constructor(options: StarknetPrivateExecutorOptions) {
    this.wallet = options.wallet;
    this.privacySession = options.privacySession;
  }

  /**
   * Execute a private application action. Validates the intent first (a malformed intent is
   * rejected BEFORE any SDK/proving work), resolves the shadow identity scoped to the active
   * wallet + network, then runs the SDK private-invoke pipeline through the session mutex.
   */
  async execute(intent: PrivateExecutionIntent): Promise<PrivateExecutionReceipt> {
    const invalid = validatePrivateExecutionIntent(intent);
    if (invalid) throw new Error(`Invalid private execution intent: ${invalid}`);

    // Refuse to start an expired intent (deadline is advisory, not a chain guarantee).
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new Error("Private execution intent has expired.");
    }

    // Resolve the shadow identity scoped to THIS wallet on THIS network. The session validates
    // the identity belongs to the wallet's address and chain, and is active. The caller can never
    // inject an arbitrary commitment.
    const identity = this.privacySession.getPrivateIdentity(intent.identity, this.wallet.address);

    // Run through the privacy session (serialized with all other mutating pool ops). The session
    // holds the viewing key internally; the adapter builds the proof + submits with the Wallet
    // Core local signer. No public master-wallet fallback exists on this path.
    const result = await this.privacySession.executePrivateApplication({
      token: intent.token,
      amount: intent.amount,
      targetContract: intent.targetContract,
      identityCommitment: identity.commitmentNonce0,
      destination: intent.destination,
    });

    return {
      transactionHash: result.transactionHash,
      status: result.status,
      action: intent.action,
      token: intent.token,
      amount: intent.amount,
      targetContract: intent.targetContract,
      identityId: identity.id,
      executionId: identity.commitmentNonce0,
    };
  }
}