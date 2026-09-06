/**
 * Privacy Hub — feature entry point.
 *
 * The cross-chain ORCHESTRATION layer on top of the existing STRK20 privacy stack + NEAR Intents
 * adapter. It is NOT a privacy protocol, NOT a new provider, and owns NO keys. It routes a typed
 * hub intent to a provider (today: `NearIntentProvider` → `NearIntentAdapter`) and normalizes the
 * lifecycle. Wallet Core never imports this module's logic beyond the thin `*PrivacyHub*` bridges.
 */
export {
  validatePrivacyHubIntent,
  computeHubMinOutput,
  isValidHubSlippageBps,
  PrivacyHubError,
  type PrivacyHubSourceChain,
  type PrivacyHubSourceAsset,
  type PrivacyHubDestinationChain,
  type PrivacyHubDestinationAsset,
  type PrivacyHubPhase,
  type PrivacyHubIntent,
  type PrivacyHubQuote,
  type PrivacyHubPrepared,
  type PrivacyHubStatus,
  type PrivacyHubReceipt,
  type PrivacyHubReadiness,
} from "./types";
export {
  PRIVACY_HUB_ROUTES,
  resolvePrivacyHubRoute,
  privacyHubRouteById,
  routeHasPrivacyCapability,
  type PrivacyHubRoute,
  type CrossChainProviderId,
  type ProviderCapability,
  type ProviderPrivacyCapability,
} from "./routes";
export {
  nearPhaseToHubPhase,
  type CrossChainProvider,
} from "./provider";
export { NearIntentProvider } from "./provider";
export {
  ConfidentialIntentProvider,
  confidentialIntentAvailability,
  type ConfidentialIntentAvailability,
  type ConfidentialityLevel,
} from "./confidential";
export { PrivacyHub, type PrivacyHubOptions } from "./service";
