/**
 * Privacy Core — STRK20 (wallet-native). The PRIMARY privacy path: consumes a Wallet Core
 * account/signer + the wallet-native viewing key. No Privy, no external wallet, no Wallet API.
 * `PrivyStrk20Adapter` (legacy) aliases `Strk20Adapter` for backward compatibility.
 */
export {
  Strk20Adapter,
  type Strk20User,
  type Strk20AdapterConfig,
  type Strk20ExecuteReceipt,
  type PrivateCurveTradeParams,
} from "./Strk20Adapter";
export {
  STRK_TOKEN_ADDRESS,
  DEFAULT_STRK_ALLOWANCE_TARGET,
  POOL_FEE_ENTRYPOINT,
  ALLOWANCE_ENTRYPOINT,
  APPROVE_ENTRYPOINT,
  readPoolFee,
  readAllowance,
  ensurePrivacyPoolAllowance,
  type ApprovalStatus,
  type EnsureAllowanceOptions,
  type AllowanceResult,
} from "./allowance";