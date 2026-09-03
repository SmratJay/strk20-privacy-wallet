import type { Account, RpcProvider } from "starknet";

/**
 * Wallet Core — account adapter interface.
 *
 * Account-contract-specific logic lives behind this interface so the wallet core can support
 * multiple Starknet account contracts (Ready today, Braavos/others later) without changing
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

export interface AccountAdapter {
  /** Stable account-contract identifier, e.g. `"ready-v0.4.0"`. Stored in wallet state. */
  readonly type: string;
  /** Counterfactual account address for this public key (before/after deployment). */
  readonly address: string;
  /** The STARK public key the account is configured to accept as owner. */
  readonly publicKey: string;

  /**
   * Probe on-chain deployment state, verifying the expected account class hash.
   * `unknown` (RPC failure or class-hash mismatch) must never authorize a deployment.
   */
  probeDeployment(provider: Pick<RpcProvider, "getClassHashAt">): Promise<AccountDeploymentProbe>;

  /** Convenience: true ONLY when `probeDeployment` is exactly "deployed". */
  isDeployed(provider: Pick<RpcProvider, "getClassHashAt">): Promise<boolean>;

  /**
   * Deploy the account with a real DEPLOY_ACCOUNT transaction signed by `account`. The
   * submitted salt + constructor calldata must match the counterfactual address derivation.
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