/**
 * Private Swap — feature entry point.
 *
 * The one user-facing private application built on the existing STRK20 shadow-account primitive:
 * private STRK → shadow identity → real shadow account → REAL swap application → private result.
 *
 * Wallet Core stays custody-only. STRK20 stays privacy-only. The Shadow Account stays the
 * execution identity. This feature is a consumer of all three — it produces safe swap calls and
 * executes them through the existing shadow path. Wallet Core never imports this module's swap
 * logic beyond the thin `executePrivateSwap` runtime bridge.
 */
export { PrivateSwapService } from "./service";
export {
  PRIVATE_SWAP_APPS,
  PRIVATE_SWAP_SEPOLIA_POOL,
  STRKFTW_CURVE,
  STRKFTW_TOKEN,
  resolvePrivateSwapApp,
  type PrivateSwapAppConfig,
} from "./apps";
export {
  validatePrivateSwapIntent,
  computeMinOutput,
  isValidSlippageBps,
  tokenSymbolFor,
  IDLE_PRIVATE_SWAP,
  PrivateSwapError,
  PrivateSwapQuoteStaleError,
  type PrivateSwapAction,
  type PrivateSwapPhase,
  type PrivateSwapIntent,
  type PrivateSwapQuote,
  type PrivateSwapOpState,
  type PrivateSwapReceipt,
} from "./types";
export { getOnChainSwapQuote, getPrivateExecutionFee, approveCalldata } from "./quote";