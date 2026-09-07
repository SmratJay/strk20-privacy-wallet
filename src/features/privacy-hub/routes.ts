/**
 * Privacy Hub — typed route registry + provider capabilities.
 *
 * The hub owns the WHO/WHERE of a route (which provider executes a given source→destination pair),
 * NOT the HOW (the provider owns that). Canonical Base and registry-backed Solana routes use the existing
 * `near-intents` provider. Adding a second provider later means adding a route entry + a provider
 * implementation — the hub, Runtime, and Wallet Core stay unchanged.
 */
import type {
  PrivacyHubSourceChain,
  PrivacyHubSourceAsset,
  PrivacyHubDestinationChain,
  PrivacyHubDestinationAsset,
} from "./types";
import { NEAR_INTENT_ROUTES, type NearIntentRoute } from '../near-intents/routes';

/** Provider identifiers the hub can route to. */
export type CrossChainProviderId = "near-intents" | "confidential-intents";

/** Capabilities a provider may advertise for a route. */
export type ProviderCapability = "quote" | "prepare" | "execute" | "status" | "readiness";

/**
 * PRIVACY capabilities a route/provider may declare. These describe WHERE privacy holds, never
 * claim more than the protocol guarantees:
 *   - `source-private`        → the SOURCE side is funded privately (STRK20 Shadow Account);
 *   - `destination-public`    → the destination settlement remains publicly observable;
 *   - `public-settlement`     → the solver settles on the public NEAR chain (intents.near);
 *   - `confidential-execution`→ the solver settles on NEAR's private FAR chain (intents.far);
 *   - `selective-disclosure`  → the provider exposes selective-disclosure controls.
 */
export type ProviderPrivacyCapability =
  | "source-private"
  | "destination-public"
  | "public-settlement"
  | "confidential-execution"
  | "selective-disclosure";

export interface PrivacyHubRoute {
  id: string;
  name: string;
  sourceChain: PrivacyHubSourceChain;
  sourceAsset: PrivacyHubSourceAsset;
  destinationChain: PrivacyHubDestinationChain;
  destinationAsset: PrivacyHubDestinationAsset;
  /** The provider that executes this route (resolves to a registered `CrossChainProvider`). */
  provider: CrossChainProviderId;
  capabilities: readonly ProviderCapability[];
  /** Privacy boundary facts for this route (never over-claims). */
  privacy: readonly ProviderPrivacyCapability[];
  /** Destination address validation kind. */
  addressKind: "evm" | "solana";
}

/** One shared route source; do not duplicate NEAR asset metadata in the orchestration layer. */
export function toPrivacyHubRoutes(routes: readonly NearIntentRoute[]): PrivacyHubRoute[] {
  return routes.map(route => ({
    id: route.id, name: route.name,
    sourceChain: route.sourceChain, sourceAsset: route.sourceAsset,
    destinationChain: route.destinationChain, destinationAsset: route.destinationAsset,
    provider: "near-intents",
    capabilities: ["quote", "prepare", "execute", "status", "readiness"],
    privacy: ["source-private", "destination-public", "public-settlement"],
    addressKind: route.destinationAddressKind,
  }));
}
export const PRIVACY_HUB_ROUTES: readonly PrivacyHubRoute[] = toPrivacyHubRoutes(NEAR_INTENT_ROUTES);

export function routeHasPrivacyCapability(
  route: PrivacyHubRoute,
  capability: ProviderPrivacyCapability,
): boolean {
  return route.privacy.includes(capability);
}

export function resolvePrivacyHubRoute(
  sourceChain: string,
  sourceAsset: string,
  destinationChain: string,
  destinationAsset: string,
): PrivacyHubRoute | null {
  return (
    PRIVACY_HUB_ROUTES.find(
      (r) =>
        r.sourceChain === sourceChain &&
        r.sourceAsset === sourceAsset &&
        r.destinationChain === destinationChain &&
        r.destinationAsset === destinationAsset,
    ) ?? null
  );
}

export function privacyHubRouteById(routeId: string): PrivacyHubRoute | null {
  return PRIVACY_HUB_ROUTES.find((r) => r.id === routeId) ?? null;
}
