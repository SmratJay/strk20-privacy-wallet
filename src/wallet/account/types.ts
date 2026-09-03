import type { Account, RpcProvider } from "starknet";

/**
 * Wallet Core — account adapter interface.
 *
 * Account-contract-specific logic lives behind this interface so the wallet core can support
 * multiple Starknet account contracts (Ready today, Braavos now, others later) without changing
 * the core. The core talks to accounts only through this seam.
 */

export interface AccountDeployment {
  transactionHash: string;
  contractAddress: string;
}

/**
 * On-chain deployment state of an account address.
 *
 *  - "deployed":     the address hosts the EXPECTED account class (class hash verified).
 *  - "not_deployed": the address has no contract (RPC definitively says so).
 *  - "unknown":      cannot be determined safely (RPC failure, or the address hosts a DIFFERENT
 *                    class than expected). `unknown` must NEVER authorize a deployment.
 */
export type AccountDeploymentProbe = "deployed" | "not_deployed" | "unknown";

/**
 * Result of proving that a signing key controls an on-chain account.
 *
 * `verified: true` means the key was proven to control the account. The `method` describes how
 * (e.g. "counterfactual-derivation" or "is_valid_signature"), and `reason` explains a failure.
 * `observedClassHash` is the class hash the chain reported at the address, when readable.
 */
export interface OwnershipVerification {
  verified: boolean;
  method: string;
  reason?: string;
  observedClassHash?: string;
}

export interface AccountAdapter {
  /** Stable account-contract identifier, e.g. `"ready-v0.4.0"`. Stored in wallet state. */
  readonly type: string;
  /** Account address this adapter manages (derived or user-supplied). */
  readonly address: string;
  /** The STARK public key the account is configured to accept as owner. */
  readonly publicKey: string;
  /**
   * True when the address is deterministically derivable from the public key (counterfactual).
   * False for account types whose address depends on non-key init parameters (e.g. Braavos),
   * which require the user's existing address.
   */
  readonly addressDerivable: boolean;

  /**
   * Probe on-chain deployment state, verifying the expected account class hash.
   * `unknown` (RPC failure or class-hash mismatch) must never authorize a deployment.
   */
  probeDeployment(provider: Pick<RpcProvider, "getClassHashAt">): Promise<AccountDeploymentProbe>;

  /** Convenience: true ONLY when `probeDeployment` is exactly "deployed". */
  isDeployed(provider: Pick<RpcProvider, "getClassHashAt">): Promise<boolean>;

  /**
   * Prove that the local signer's key controls the account at `address`. For derivable
   * accounts this may be answered from address derivation alone when not yet deployed; for
   * deployed accounts it verifies on-chain (e.g. SRC-5 `is_valid_signature`).
   */
  verifyOwnership(account: Account, provider: RpcProvider): Promise<OwnershipVerification>;

  /**
   * Deploy the account with a real DEPLOY_ACCOUNT transaction signed by `account`. The
   * submitted salt + constructor calldata must match the counterfactual address derivation.
   * Account types that are only importable as existing accounts must reject this.
   */
  deploy(account: Account): Promise<AccountDeployment>;

  /**
   * Wait until the deployment block is `blocks` behind the chain tip (STRK20 proving needs
   * the account finalized before registration). Throws on timeout.
   */
  waitForFinality(
    provider: Pick<RpcProvider, "getBlockNumber">,
    deployedAtBlock: number,
    blocks?: number,
  ): Promise<number>;
}