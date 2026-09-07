/**
 * Near Intents — typed route registry (REAL NEAR Intents 1Click route, verified live).
 *
 * This file preserves the canonical Base route; registry.ts extends it with Solana destinations
 * confirmed by the current public token API. Every canonical field below maps
 * to the LIVE 1Click API (verified 2026-09-05 against https://1click.chaindefuser.com/v0/tokens
 * and /v0/quote):
 *
 *   origin asset id      nep141:starknet.omft.near              (STRK, blockchain "starknet")
 *   destination asset id nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near (USDC, "base")
 *   deposit address      a 251-bit Starknet address (0x…66 hex chars)
 *   destination address  a 42-char EVM address on Base
 *
 * A cross-chain intent must match a resolved route exactly — never a silent fallback.
 */
import type { TokenInfo } from "@/config/networks";

/** Starknet STRK (Sepolia + mainnet share the canonical address). */
export const NEAR_INTENT_SOURCE_TOKEN: TokenInfo = {
  symbol: "STRK",
  name: "Starknet Token",
  address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
  icon: "⚡",
};

/** NEAR Intents asset id for STRK on Starknet (verified live). */
export const NEAR_INTENT_STRK_ASSET_ID = "nep141:starknet.omft.near";

/** NEAR Intents asset id for USDC on Base (verified live). */
export const NEAR_INTENT_BASE_USDC_ASSET_ID =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

/** The NEAR Intents 1Click API base URL (public, keyless deposit flow). */
export const NEAR_INTENTS_1CLICK_BASE_URL = "https://1click.chaindefuser.com";

export interface NearIntentRoute {
  /** Route id (typed, not a free-form string). */
  id: string;
  /** Human label (UI only, never a secret). */
  name: string;
  sourceChain: "starknet";
  sourceAsset: "strk";
  /** Starknet STRK token the shadow account transfers (the transfer target's token contract). */
  sourceToken: TokenInfo;
  /** NEAR Intents origin asset id (what the 1Click quote `originAsset` field uses). */
  originAssetId: string;
  destinationChain: "base" | "solana";
  destinationAsset: string;
  /** Human destination token info (decimals for formatting). */
  destinationToken: { symbol: string; name: string; decimals: number; icon: string; address?: string };
  /** NEAR Intents destination asset id (what the 1Click quote `destinationAsset` uses). */
  destinationAssetId: string;
  /** Chain-specific destination validation (EVM hex or Solana base58). */
  destinationAddressKind: "evm" | "solana";
}

export const NEAR_INTENT_ROUTES: readonly NearIntentRoute[] = [
  {
    id: "starknet-strk-to-base-usdc",
    name: "STRK (Starknet) → USDC (Base)",
    sourceChain: "starknet",
    sourceAsset: "strk",
    sourceToken: NEAR_INTENT_SOURCE_TOKEN,
    originAssetId: NEAR_INTENT_STRK_ASSET_ID,
    destinationChain: "base",
    destinationAsset: "usdc",
    destinationToken: { symbol: "USDC", name: "USD Coin (Base)", decimals: 6, icon: "💵" },
    destinationAssetId: NEAR_INTENT_BASE_USDC_ASSET_ID,
    destinationAddressKind: "evm",
  },
];

/** Resolve the configured route for (sourceChain, sourceAsset, destinationChain, destinationAsset). */
export function resolveNearIntentRoute(
  sourceChain: string,
  sourceAsset: string,
  destinationChain: string,
  destinationAsset: string,
  routes: readonly NearIntentRoute[] = NEAR_INTENT_ROUTES,
): NearIntentRoute | null {
  return (
    routes.find(
      (r) =>
        r.sourceChain === sourceChain &&
        r.sourceAsset === sourceAsset &&
        r.destinationChain === destinationChain &&
        r.destinationAsset === destinationAsset,
    ) ?? null
  );
}
