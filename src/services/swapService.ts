/**
 * @file src/services/swapService.ts
 * @description AVNU public swap flow for the Wallet Core runtime. Quotes are fetched from AVNU and
 * the swap calls are executed through `WalletRuntime.send()` (the Wallet Core local signer). The
 * STRK20 PRIVATE swap path is a separate feature: see src/features/private-swap (real STRK20
 * shadow-account private swap, wired into /wallet). The AVNU paymaster key stays server-side.
 */
import {
  getQuotes,
  quoteToCalls,
  type Quote,
  BASE_URL,
  SEPOLIA_BASE_URL,
} from '@avnu/avnu-sdk';
import type { Call } from 'starknet';
import type { NetworkId } from '@/config/networks';
import type { TokenInfo } from '@/config/tokens';
import { parseTokenAmount } from '@/utils/formatters';

export interface SwapQuoteResult {
  quote: Quote;
  /** Human-readable estimated buy amount (token units). */
  buyAmount: string;
  /** Human-readable estimated gas fee in STRK. */
  gasFeeStrk: string;
  routes: string[];
  sellAmount: bigint;
}

export function avnuBaseUrlFor(networkId: NetworkId): string {
  return networkId === 'sepolia' ? SEPOLIA_BASE_URL : BASE_URL;
}

/**
 * Fetch the best AVNU quote for a sell/buy pair. `takerAddress` is the Wallet Core account address.
 * Returns null when AVNU has no route/liquidity for the pair.
 */
export async function getSwapQuote(
  networkId: NetworkId,
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  amountStr: string,
  takerAddress: string,
): Promise<SwapQuoteResult | null> {
  if (!amountStr || parseFloat(amountStr) <= 0) return null;
  const sellAmount = parseTokenAmount(amountStr, sellToken.decimals);
  const quotes = await getQuotes(
    {
      sellTokenAddress: sellToken.address,
      buyTokenAddress: buyToken.address,
      sellAmount,
      takerAddress,
      size: 1,
    },
    { baseUrl: avnuBaseUrlFor(networkId) },
  );
  const quote = quotes?.[0];
  if (!quote) return null;
  const buyAmountNum = Number(quote.buyAmount) / 10 ** buyToken.decimals;
  return {
    quote,
    buyAmount: buyAmountNum.toFixed(buyToken.decimals >= 8 ? 6 : 4),
    gasFeeStrk: (Number(quote.gasFees ?? 0n) / 1e18).toFixed(4),
    routes: quote.routes.map((r) => r.name || 'DEX'),
    sellAmount,
  };
}

/**
 * Build the AVNU router calls for a PUBLIC swap (approve + swap). The calls are executed by the
 * Wallet Core local signer via `WalletRuntime.send(calls)` — no external wallet, no Privy.
 */
export async function buildPublicSwapCalls(
  networkId: NetworkId,
  quote: Quote,
  slippage: number,
  takerAddress: string,
): Promise<Call[]> {
  const { calls } = await quoteToCalls(
    { quoteId: quote.quoteId, slippage, takerAddress, executeApprove: true },
    { baseUrl: avnuBaseUrlFor(networkId) },
  );
  if (!calls || calls.length === 0) {
    throw new Error('Could not build swap calls from AVNU router.');
  }
  return calls as unknown as Call[];
}

/** Public swap is supported by Wallet Core; private swaps are not yet. */
export function publicSwapSupported(): boolean {
  return true;
}

/**
 * Private STRK20 swaps ARE supported by Wallet Core now — through the REAL STRK20 shadow-account
 * path (see `/wallet` → Private swap panel and src/features/private-swap). This helper stays for
 * legacy imports; the private swap UI lives in the feature module, never routed to another wallet.
 */
export function privateSwapSupported(): boolean {
  return true;
}
