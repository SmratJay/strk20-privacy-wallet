/**
 * Privacy Hub — typed route registry + provider capabilities.
 *
 * The hub owns the WHO/WHERE of a route (which provider executes a given source→destination pair),
 * NOT the HOW (the provider owns that). The single route today resolves to the existing
 * `near-intents` provider. Adding a second provider later means adding a route entry + a provider
 * implementation — the hub, Runtime, and Wallet Core stay unchanged.
 */
import type {
  PrivacyHubSourceChain,
  PrivacyHubSourceAsset,
  PrivacyHubDestinationChain,
  PrivacyHubDestinationAsset,
} from "./types";

/** Provider identifiers the hub can route to. */
export type CrossChainProviderId = "near-intents";

/** Capabilities a provider may advertise for a route. */
export type ProviderCapability = "quote" | "prepare" | "execute" | "status" | "readiness";

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
  /** Destination address validation kind. */
  addressKind: "evm";
}

export const PRIVACY_HUB_ROUTES: readonly PrivacyHubRoute[] = [
  {
    id: "starknet-strk-to-base-usdc",
    name: "STRK (Starknet) → USDC (Base)",
    sourceChain: "starknet",
    sourceAsset: "strk",
    destinationChain: "base",
    destinationAsset: "usdc",
    provider: "near-intents",
    capabilities: ["quote", "prepare", "execute", "status", "readiness"],
    addressKind: "evm",
  },
];

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
