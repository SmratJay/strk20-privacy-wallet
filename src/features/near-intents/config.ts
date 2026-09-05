/**
 * Near Intents — authoritative network configuration (mainnet-ready, hard-gated).
 *
 * Three concerns, never conflated:
 *   - `configured`          → the STRK20 privacy stack (pool + prover + discovery + shadow
 *                             anonymizer) is configured FOR THIS network (never inherited from
 *                             another network — see `resolveWalletPrivacyConfig`).
 *   - `available`           → the cross-chain API layer (quote / reserve deposit address / status)
 *                             may be used. (== `configured`.)
 *   - `settlementEnabled`   → real settlement may proceed: the shadow account may fund a NEAR
 *                             deposit. This requires a MAINNET STRK20 stack + a MAINNET private
 *                             paymaster relay + a funded account. It is OFF by default and is NEVER
 *                             substituted with a public root-wallet execution.
 *
 * Dependency direction: WalletRuntime → near-intents feature → NEAR adapter → NEAR Intents →
 * solver → destination. Wallet Core remains custody-only.
 */
import type { WalletNetworkId } from "@/wallet";
import { resolveWalletPrivacyConfig } from "@/wallet/privacy";
import { getNetworkConfig } from "@/config/networks";
import { NEAR_INTENTS_1CLICK_BASE_URL } from "./routes";

export interface CrossChainNetworkConfig {
  network: WalletNetworkId;
  /** NEAR Intents 1Click API base URL (mainnet production; there is no public testnet). */
  nearBaseUrl: string;
  /** STRK20 privacy stack is configured for this network (pool + prover + discovery + anonymizer). */
  configured: boolean;
  /** The API layer (quote/reserve/status) is usable. */
  available: boolean;
  /** Real settlement (funding a mainnet NEAR deposit from mainnet STRK20) may proceed. */
  settlementEnabled: boolean;
  /** Human reason when a gate is closed (never a public-execution fallback). */
  reason: string | null;
}

/**
 * Whether a MAINNET private-paymaster relay is configured. The shadow-account proof is relayed
 * through the AVNU private paymaster so the root wallet is never the on-chain sender. The wiring
 * is currently Sepolia-only (`Strk20Paymaster`), so mainnet settlement is gated OFF until a mainnet
 * paymaster URL is provided AND the shadow relay is wired to it.
 */
function mainnetPaymasterConfigured(env?: Record<string, string | undefined>): boolean {
  const url = (
    env?.NEXT_PUBLIC_STRK20_PAYMASTER_URL_MAINNET ??
    process.env.NEXT_PUBLIC_STRK20_PAYMASTER_URL_MAINNET ??
    ""
  ).trim();
  return url.length > 0 && url.startsWith("https://");
}

/**
 * Resolve the authoritative cross-chain configuration for a network.
 *
 * - sepolia: STRK20 Sepolia operator is configured → `configured`/`available` = true; the API layer
 *   is live (quote/reserve/status prove it). `settlementEnabled` = false because NEAR Intents is
 *   mainnet-only and Sepolia STRK cannot fund a mainnet deposit.
 * - mainnet: the STRK20 MAINNET operator (prover/discovery/anonymizer) + a MAINNET private paymaster
 *   are NOT yet configured → `configured` = false and `settlementEnabled` = false. There is NO
 *   fallback to the Sepolia operator and NO public root-wallet execution.
 */
export function crossChainConfigFor(
  network: WalletNetworkId,
  env?: Record<string, string | undefined>,
): CrossChainNetworkConfig {
  const privacy = resolveWalletPrivacyConfig(network, env);
  const anonymizer = getNetworkConfig(network).shadowAccountAnonymizerAddress.trim();
  const configured = privacy !== null && anonymizer.length > 0;
  const isMainnet = network === "mainnet";
  const paymaster = isMainnet && mainnetPaymasterConfigured(env);
  const settlementEnabled = configured && isMainnet && paymaster;

  let reason: string | null = null;
  if (!configured) {
    reason = "STRK20 privacy stack (prover/discovery/anonymizer) is not configured for this network.";
  } else if (!settlementEnabled) {
    reason = isMainnet
      ? "Private-paymaster relay + funded account are required for mainnet settlement."
      : "NEAR Intents is mainnet-only; this network can only prove the API layer, not settle.";
  }

  return {
    network,
    nearBaseUrl: NEAR_INTENTS_1CLICK_BASE_URL,
    configured,
    available: configured,
    settlementEnabled,
    reason,
  };
}

/** Whether the API layer is usable on a network, plus the reason when it is not. */
export function crossChainAvailability(
  network: WalletNetworkId,
  env?: Record<string, string | undefined>,
): { available: boolean; reason: string | null } {
  const config = crossChainConfigFor(network, env);
  return { available: config.available, reason: config.reason };
}
