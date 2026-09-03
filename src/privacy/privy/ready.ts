/**
 * LEGACY ADAPTER BOUNDARY — Ready account helpers (formerly Privy-lane).
 *
 * The Ready account implementation now lives in Wallet Core (`@/wallet/account/ready`) and is
 * owned by the self-custodial wallet. This file is kept ONLY as a backward-compatible alias so
 * existing legacy (Privy) consumers and tests keep resolving. Do NOT add new code here.
 */
export {
  READY_SEPOLIA_CLASS_HASH,
  READY_ACCOUNT_CONFIG,
  isReadyAccountSupported,
  READY_DEPLOY_FINALITY_BLOCKS,
  READY_FINALITY_POLL_MS,
  READY_FINALITY_TIMEOUT_MS,
  buildReadyConstructorCalldata,
  computeReadyAccountAddress,
  isAccountDeployed,
  probeAccountDeployment,
  deployReadyAccount,
  waitForDeploymentFinality,
} from "@/wallet/account/ready";

export type { AccountDeployment as ReadyAccountDeployment } from "@/wallet/account/types";