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

export interface AccountAdapter {
  /** Stable account-contract identifier, e.g. `"ready-v0.4.0"`. Stored in wallet state. */
  readonly type: string;
  /** Counterfactual account address for this public key (before/after deployment). */
  readonly address: string;
  /** The STARK public key the account is configured to accept as owner. */
  readonly publicKey: string;

  /** True when the account contract is deployed on-chain (class hash present). */
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