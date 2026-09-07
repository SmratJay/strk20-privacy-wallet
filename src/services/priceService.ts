/**
 * @file priceService.ts
 * @description Centralized real-time token price service (Whitepaper Sections 5 & 13)
 * Fetches actual USD rates, including stablecoins; never assumes a dollar peg.
 */

export interface TokenPrices {
  [symbol: string]: number | null;
}

class PriceService {
  private cachedPrices: TokenPrices = {};
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL_MS = 30 * 1000;
  private pending: Promise<TokenPrices> | null = null;

  /**
   * Get latest prices with automatic background refresh
   */
  async getPrices(): Promise<TokenPrices> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return { ...this.cachedPrices };
    }
    if (this.pending) return this.pending;
    this.pending = this.fetchUsdPrices().finally(() => { this.pending = null; });
    return this.pending;
  }

  private async fetchUsdPrices(): Promise<TokenPrices> {
    try {
      // USDT-denominated tickers are not USD prices. Read USD for every asset, including USDC.
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,starknet,ethereum,usd-coin,tether&vs_currencies=usd',
        { signal: AbortSignal.timeout(8000), cache: 'no-store' }
      );

      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          const prices: TokenPrices = {};
          for (const [id, symbol] of Object.entries({ bitcoin: 'BTC', starknet: 'STRK', ethereum: 'ETH', 'usd-coin': 'USDC', tether: 'USDT' })) {
            const price = data[id]?.usd;
            prices[symbol] = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
          }
          this.cachedPrices = prices;
          this.lastFetchTime = Date.now();
          return { ...prices };
        }
      }
    } catch {
      // A failed refresh must not present stale prices as a current wallet valuation.
    }

    this.cachedPrices = {};
    return {};
  }

  /**
   * Synchronous cached getter for instant UI renders
   */
  getCachedPrice(symbol: string): number | null {
    return this.getCachedPrices()[symbol.toUpperCase()] ?? null;
  }

  getCachedPrices(): TokenPrices {
    return Date.now() - this.lastFetchTime < this.CACHE_TTL_MS ? { ...this.cachedPrices } : {};
  }
}

export const priceService = new PriceService();
