/**
 * Near Intents — feature entry point.
 *
 * The cross-chain routing/settlement layer on top of the existing STRK20 privacy stack. Wallet Core
 * stays custody-only; STRK20 stays privacy-only; the Shadow Account stays the private execution
 * identity; NEAR Intents is routing/settlement only. This feature is a consumer of all four — it
 * produces the STRK transfer the shadow account executes and drives the NEAR Intents 1Click
 * lifecycle (quote → reserve → fund → track → reconcile). Wallet Core never imports this module's
 * logic beyond the thin `*CrossChain*` runtime bridges.
 */
export {
  validateCrossChainIntent,
  validateDestinationAddress,
  computeMinOutput,
  isValidSlippageBps,
  isValidStarknetAddress,
  nearIntentPhaseForStatus,
  IDLE_NEAR_INTENT,
  NearIntentError,
  NearIntentQuoteStaleError,
  NearIntentUnsupportedRouteError,
  NearIntentRejectedError,
  NearIntentUnknownError,
  type NearIntentAction,
  type NearIntentPhase,
  type NearIntentStatusCode,
  type NearIntentSourceChain,
  type NearIntentDestinationChain,
  type CrossChainPrivateIntent,
  type NearIntentQuote,
  type NearIntentPrepared,
  type NearIntentOpState,
  type NearIntentStatus,
  type NearIntentReceipt,
} from "./types";
export {
  crossChainConfigFor,
  crossChainAvailability,
  type CrossChainNetworkConfig,
} from "./config";
export {
  NEAR_INTENT_ROUTES,
  NEAR_INTENT_SOURCE_TOKEN,
  NEAR_INTENT_STRK_ASSET_ID,
  NEAR_INTENT_BASE_USDC_ASSET_ID,
  NEAR_INTENTS_1CLICK_BASE_URL,
  resolveNearIntentRoute,
  type NearIntentRoute,
} from "./routes";
export {
  NearIntentClient,
  type NearIntentClientOptions,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
} from "./client";
export {
  NearIntentAdapter,
  transferCalldata,
  type NearIntentAdapterOptions,
  type NearIntentPhaseUpdate,
} from "./adapter";
