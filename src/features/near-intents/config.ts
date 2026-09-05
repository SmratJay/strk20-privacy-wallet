/**
 * Near Intents — authoritative network configuration (mainnet-ready, availability-gated).
 *
 * Separates three concerns (never conflated):
 *   - code support       → the adapter/types/flow exist regardless of network;
 *   - configuration      → this module declares per-network settings;
 *   - feature availability → cross-chain is ENABLED only where the STRK20 privacy layer is live;
 *   - network acceptance → real settlement still requires the operator + funds + destination.
 *
 * The dependency direction stays intact: WalletRuntime → near-intents feature → NEAR adapter →
 * NEAR Intents → solver → destination. Wallet Core remains custody-only.
 */
import type { WalletNetworkId } from "@/wallet";
import { NEAR_INTENTS_1CLICK_BASE_URL } from "./routes";

export interface CrossChainNetworkConfig {
  network: WalletNetworkId;
  /** NEAR Intents 1Click API base URL (mainnet production; there is no public testnet). */
  nearBaseUrl: string;
  /** Whether the cross-chain feature is ENABLED on this network. */
  enabled: boolean;
  /** Human reason when disabled (never a public-execution fallback). */
  reason: string | null;
}

/**
 * Authoritative cross-chain network configuration.
 *
 * - sepolia: the STRK20 Sepolia operator (prover/discovery/shadow anonymizer) is configured, so the
 *   API layer (quote / reserve deposit address / status) is live. Real settlement is still gated on
 *   NEAR Intents being mainnet-only (see docs/NEAR_INTENTS.md).
 * - mainnet: the STRK20 MAINNET operator (prover/discovery/anonymizer + paymaster) is NOT yet
 *   configured in this repo, so cross-chain is DISABLED. Enabling it is a configuration change
 *   (mainnet prover/discovery/anonymizer + paymaster + a funded wallet + destination) — it is NEVER
 *   substituted with a public root-wallet execution.
 */
export const CROSS_CHAIN_NETWORK_CONFIG: Record<WalletNetworkId, CrossChainNetworkConfig> = {
  sepolia: {
    network: "sepolia",
    nearBaseUrl: NEAR_INTENTS_1CLICK_BASE_URL,
    enabled: true,
    reason: null,
  },
  mainnet: {
    network: "mainnet",
    nearBaseUrl: NEAR_INTENTS_1CLICK_BASE_URL,
    enabled: false,
    reason: "STRK20 mainnet privacy operator (prover/discovery/anonymizer) is not configured.",
  },
};

export function crossChainConfigFor(network: WalletNetworkId): CrossChainNetworkConfig {
  return CROSS_CHAIN_NETWORK_CONFIG[network] ?? CROSS_CHAIN_NETWORK_CONFIG.sepolia;
}

/** Whether cross-chain is enabled for a network, plus the reason when it is not. */
export function crossChainAvailability(network: WalletNetworkId): { available: boolean; reason: string | null } {
  const config = crossChainConfigFor(network);
  return { available: config.enabled, reason: config.reason };
}
