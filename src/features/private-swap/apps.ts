/**
 * Private Swap — PRIVATE_SWAP_APPS typed application registry.
 *
 * The private-swap feature does NOT expose an arbitrary `targetContract + entrypoint + calldata`
 * field. It owns the target application contracts via this typed configuration: application name,
 * swap contract, supported tokens, network, expected selectors, quote source, and execution
 * constraints. A swap intent is only accepted when it matches a configured app exactly.
 *
 * First application: the repo's OWN real, deployed BondingCurve V2 (STRKFTW) on Sepolia.
 *   - The BondingCurve is a real constant-product AMM (real reserves, real quotes via
 *     `quote_buy`/`quote_sell`, real `buy`/`sell` state transitions).
 *   - The shadow account calls `approve(STRK → curve)` + `buy(base_amount, shadowAddress)` so the
 *     APPLICATION sees the SHADOW ACCOUNT as the trader (never the root wallet).
 *   - AVNU Sepolia currently has ZERO liquidity (empty token registry, no quotes for any pair) and
 *     its SDK private-swap prover requires a starknet.js WalletAccountV6 (`strk20PrepareInvoke`)
 *     that our Wallet Core account is not — so the AVNU private path is neither usable on Sepolia
 *     nor compatible with the current account without redesigning Wallet Core. This is documented
 *     in docs/PRIVATE_SWAP.md. The BondingCurve is the smallest REAL Starknet swap application
 *     where a private swap-like state transition can be demonstrated end to end.
 */
import type { TokenInfo } from "@/config/networks";

export const PRIVATE_SWAP_SEPOLIA_POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

export const STRKFTW_TOKEN: TokenInfo = {
  symbol: "STRKFTW",
  name: "STRKFTW (Sepolia)",
  address: "0x4ce3233bdb393636c7a576e8d68a94f7d8c41ba4d38a42460782b270be85a00",
  decimals: 18,
  icon: "🚀",
};

/** STRKFTW BondingCurve V2 (Sepolia) — real deployed AMM with real STRK liquidity. */
export const STRKFTW_CURVE = "0x1d63a2b150973cf8ae0c02dfbc564c1ed46fbf0a08b298c9d77b07b1c08b0f8";

export interface PrivateSwapAppConfig {
  /** Feature-level app id (typed, not a free-form string). */
  id: string;
  /** Human label (UI only, never a secret). */
  name: string;
  /** The network this app is bound to. */
  network: "sepolia";
  /** The application contract the shadow account executes the swap on. */
  swapContract: string;
  /** Sell token (base asset of the swap). */
  sellToken: TokenInfo;
  /** Buy token (quote asset of the swap). */
  buyToken: TokenInfo;
  /** On-chain quote entrypoint on the swap contract. */
  quoteEntrypoint: "quote_buy";
  /** Swap execution entrypoint on the swap contract. */
  swapEntrypoint: "buy";
  /** Expected selectors the feature is allowed to build against this app. */
  expectedSelectors: readonly ["approve", "buy", "quote_buy"];
  /** App fee in basis points (charged on base input/output). */
  feeBps: number;
  /** Max single trade (basis points of the virtual token reserve) — execution constraint. */
  maxTradeBps: number;
}

export const PRIVATE_SWAP_APPS: readonly PrivateSwapAppConfig[] = [
  {
    id: "strkftw-bonding-curve-v2",
    name: "STRKFTW BondingCurve",
    network: "sepolia",
    swapContract: STRKFTW_CURVE,
    sellToken: {
      symbol: "STRK",
      name: "Starknet Token (Sepolia)",
      address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      decimals: 18,
      icon: "⚡",
    },
    buyToken: STRKFTW_TOKEN,
    quoteEntrypoint: "quote_buy",
    swapEntrypoint: "buy",
    expectedSelectors: ["approve", "buy", "quote_buy"],
    feeBps: 100,
    maxTradeBps: 1000,
  },
];

/** Resolve the configured swap app for a (network, sellToken, buyToken) pair. Null when not a
 * supported private-swap pair (the feature refuses unknown pairs — never a silent route). */
export function resolvePrivateSwapApp(
  network: "sepolia",
  sellToken: string,
  buyToken: string,
): PrivateSwapAppConfig | null {
  const app = PRIVATE_SWAP_APPS.find(
    (a) =>
      a.network === network &&
      a.sellToken.address.toLowerCase() === sellToken.toLowerCase() &&
      a.buyToken.address.toLowerCase() === buyToken.toLowerCase(),
  );
  return app ?? null;
}