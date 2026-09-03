/**
 * LEGACY ADAPTER BOUNDARY — Privy-lane STRK20 adapter.
 *
 * The generic STRK20 adapter now lives in the neutral Wallet Core privacy boundary
 * (`@/privacy/strk20`). It consumes a generic STRK20 user `{ account, address, viewingKey }`
 * (a Wallet Core `UnlockedWallet.account` + wallet-native viewing key satisfies it) and has NO
 * Privy dependency. This file keeps the legacy `PrivyStrk20Adapter` name as a compatibility alias
 * so existing legacy pages (e.g. the old Privy wallet runtime) and tests keep resolving.
 *
 * Do NOT add new code here — new privacy work belongs in `@/privacy/strk20`.
 */
import { Strk20Adapter as PrivyStrk20Adapter } from "@/privacy/strk20";

export { PrivyStrk20Adapter };
export type {
  Strk20User as PrivyStrk20User,
  Strk20AdapterConfig as PrivyStrk20AdapterConfig,
  Strk20ExecuteReceipt,
  PrivateCurveTradeParams,
} from "@/privacy/strk20";