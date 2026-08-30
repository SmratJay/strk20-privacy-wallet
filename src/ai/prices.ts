/**
 * @file src/ai/prices.ts
 * @description USD price feed for the Hamster AI treasury portfolio.
 *
 * The AI reasons in USD; prices are INPUTS to the analysis, never execution state. Where a
 * real on-chain market price is available (AVNU STRK→USDC / ETH→USDC) it is used and marked
 * `source: 'avnu'`; otherwise a documented static fallback is used and marked `static`.
 * Stablecoins are pinned to $1. The price source is surfaced in every downstream view so
 * "USD value" is never confused with on-chain truth.
 */
import { getQuotes } from '@avnu/avnu-sdk';
import { SEPOLIA_TOKENS, TokenInfo } from '@/config/networks';
import { getActivePoolAddress } from '@/config/tokens';

export interface AssetPrice {
  priceUsd: number;
  source: 'avnu' | 'static';
}

/** Documented static USD reference (matches the repo's existing fallback rates). */
export const STATIC_PRICES_USD: Record<string, number> = {
  STRK: 0.38,
  ETH: 2715,
  USDC: 1,
  USDT: 1,
};

/** Tokens treated as liquid (usable toward the "keep $X liquid" policy). */
export const LIQUID_SYMBOLS = new Set(['STRK', 'ETH', 'USDC', 'USDT']);

export function isLiquidSymbol(symbol: string): boolean {
  return LIQUID_SYMBOLS.has(symbol);
}

function tokenBySymbol(symbol: string): TokenInfo | undefined {
  return SEPOLIA_TOKENS.find((t) => t.symbol === symbol);
}

/**
 * Real STRK→USDC or ETH→USDC price from the AVNU aggregator (Sepolia pool as taker).
 * Returns null when the market/aggregator is unavailable so callers can fall back.
 */
async function tryAvnuPriceUsd(symbol: 'STRK' | 'ETH'): Promise<number | null> {
  try {
    const sell = tokenBySymbol(symbol);
    const usdc = tokenBySymbol('USDC');
    if (!sell || !usdc) return null;
    const sellAmount = 10n ** BigInt(sell.decimals); // 1 unit
    const quotes = await getQuotes(
      {
        sellTokenAddress: sell.address,
        buyTokenAddress: usdc.address,
        sellAmount,
        takerAddress: getActivePoolAddress('sepolia'),
      },
      { baseUrl: process.env.NEXT_PUBLIC_AVNU_BASE_URL || undefined },
    );
    if (!quotes?.length) return null;
    const usdPerUnit = Number(quotes[0].buyAmount) / 10 ** usdc.decimals;
    return usdPerUnit > 0 ? usdPerUnit : null;
  } catch {
    return null;
  }
}

/** Resolve a USD price for a token symbol (AVNU where possible, static fallback). */
export async function getAssetPriceUsd(symbol: string): Promise<AssetPrice> {
  if (symbol === 'USDC' || symbol === 'USDT') {
    return { priceUsd: 1, source: 'static' };
  }
  if (symbol === 'STRK' || symbol === 'ETH') {
    const live = await tryAvnuPriceUsd(symbol);
    if (live !== null) return { priceUsd: live, source: 'avnu' };
  }
  const staticPrice = STATIC_PRICES_USD[symbol];
  return { priceUsd: staticPrice ?? 0, source: 'static' };
}

/** Resolve prices for every known token in the treasury in one pass. */
export async function resolvePortfolioPrices(
  symbols: string[],
): Promise<Record<string, AssetPrice>> {
  const out: Record<string, AssetPrice> = {};
  for (const symbol of symbols) {
    out[symbol] = await getAssetPriceUsd(symbol);
  }
  return out;
}