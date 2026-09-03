/**
 * Privacy Core — the first PrivateExecutor: StarknetPrivateExecutor (REAL shadow accounts).
 *
 * Consumes the existing unlocked Wallet Core session + WalletPrivacySession and executes a real
 * STRK20 shadow-account application action:
 *
 *   WalletRuntime → WalletPrivacySession → Strk20Adapter → SDK RC5 shadowAccounts() → Starknet
 *
 * The FULL chain is:
 *
 *   MASTER WALLET (Wallet Core authority, signs the proof invocation)
 *     → STRK20 private balance (mature shielded notes)
 *     → shadowAccounts(appName).commitment(nonce)   (deterministic shadow identity)
 *     → shadow address (anonymizer-derived, counterfactual)
 *     → private STRK withdrawn to the shadow address
 *     → shadow.invoke(nonce, { calls })             (the SHADOW ACCOUNT calls the application)
 *     → private paymaster relays the proof          (outer tx sender ≠ root wallet)
 *     → Starknet application sees the SHADOW ACCOUNT as caller (never the root wallet)
 *
 * It NEVER:
 *   - bypasses WalletPrivacySession (the viewing key stays inside the session),
 *   - exposes the viewing key, notes, proofs, or secret material,
 *   - adds another signer/wallet,
 *   - falls back to a public master-wallet transaction path,
 *   - submits the outer transaction with the root wallet (the paymaster relays it).
 *
 * This REPLACES the earlier `privacy_invoke` prototype, which was NOT a real shadow account.
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
   * Execute a real shadow-account application action. Validates the intent first (a malformed
   * intent is rejected BEFORE any SDK/proving work), resolves the shadow identity scoped to the
   * active wallet + network, then runs the SDK shadow-account pipeline through the session mutex.
   */
  async execute(intent: PrivateExecutionIntent): Promise<PrivateExecutionReceipt> {
    const invalid = validatePrivateExecutionIntent(intent);
    if (invalid) throw new Error(`Invalid private execution intent: ${invalid}`);

    // Refuse to start an expired intent (deadline is advisory, not a chain guarantee).
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new Error("Private execution intent has expired.");
    }

    // Resolve the shadow identity scoped to THIS wallet on THIS network by (appName, nonce). The
    // session validates the identity belongs to the wallet's address + chain and is active. The
    // caller can never inject an arbitrary commitment or shadow address.
    const identity = this.privacySession.getShadowIdentity(intent.appName, intent.nonce, this.wallet.address);

    // Run through the privacy session (serialized with all other mutating pool ops). The session
    // holds the viewing key internally; the SDK builds the proof with the Wallet Core local
    // signer (authorizing the private-note spending); the paymaster relays the outer tx.
    const result = await this.privacySession.executeShadowApplication({
      appName: identity.appName,
      nonce: intent.nonce,
      token: intent.token,
      amount: intent.amount,
      calls: intent.calls,
      destination: intent.destination,
    });

    return {
      transactionHash: result.transactionHash,
      status: "PENDING",
      action: intent.action,
      token: intent.token,
      amount: intent.amount,
      targetContract: intent.calls[0]?.contractAddress ?? "",
      appName: identity.appName,
      nonce: identity.nonce,
      commitment: result.commitment,
      shadowAddress: result.shadowAddress,
    };
  }
}