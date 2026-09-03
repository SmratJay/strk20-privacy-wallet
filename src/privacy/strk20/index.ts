/**
 * Privacy Core — STRK20 (wallet-native). The PRIMARY privacy path: consumes a Wallet Core
 * account/signer + the wallet-native viewing key. No Privy, no external wallet, no Wallet API.
 */
export {
  Strk20Adapter,
  type Strk20User,
  type Strk20AdapterConfig,
  type Strk20ExecuteReceipt,
  type PrivateBalanceSnapshot,
  type BuilderLike,
  type PrivateTransfersLike,
  type ShadowAccountsLike,
  type ShadowCallLike,
  type CollectPolicyLike,
} from "./Strk20Adapter";
export { privateCurveTrade, type PrivateCurveTradeParams } from "./privateCurve";
export {
  shadowAccountInvoke,
  shadowAddressFromCommitment,
  selectMatureNotes,
  normalizeAddress,
  sameAddress,
  SHADOW_ACCOUNT_PRIMER_CLASS_HASH,
  SHADOW_NOTE_MATURITY_BLOCKS,
  type ShadowAccountInvokeParams,
  type ShadowAccountInvokeResult,
  type ShadowAccountInvokeOptions,
  type ShadowNoteLike,
  type NoteSelection,
} from "./shadowAccount";
export {
  Strk20Paymaster,
  STRK20_PAYMASTER_URL,
  STRK20_PAYMASTER_FEE_MODE,
  PaymasterSubmissionUnknownError,
  type PaymasterBuild,
  type PaymasterFee,
  type PaymasterExecution,
  type Strk20PaymasterOptions,
} from "./paymaster";
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