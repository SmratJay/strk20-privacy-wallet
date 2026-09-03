/**
 * LEGACY ADAPTER BOUNDARY — STRK20 allowance helpers (formerly Privy-lane).
 *
 * The allowance/fee helpers are Privy-free and now live in the neutral Wallet Core privacy
 * boundary (`@/privacy/strk20/allowance`). This file is kept ONLY as a backward-compatible alias
 * so existing legacy (Privy) consumers and tests keep resolving. Do NOT add new code here.
 */
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
} from "@/privacy/strk20/allowance";