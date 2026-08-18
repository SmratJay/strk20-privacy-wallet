/**
 * @file priceService.ts
 * @description Centralized Real-time Token Price Service (Whitepaper Sections 5 & 13)
 * Fetches real market rates with caching and graceful offline fallback.
 */

export interface TokenPrices {
  [symbol: string]: number;
}

const DEFAULT_PRICES: TokenPrices = {
  STRK: 0.38,
  ETH: 1910.0,
  USDC: 1.0,
  USDT: 1.0,
};

class PriceService {
  private cachedPrices: TokenPrices = { ...DEFAULT_PRICES };
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute cache

  /**
   * Get latest prices with automatic background refresh
   */
  async getPrices(): Promise<TokenPrices> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedPrices;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=starknet,ethereum,usd-coin,tether&vs_currencies=usd',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          if (data.starknet?.usd) this.cachedPrices.STRK = Number(data.starknet.usd);
          if (data.ethereum?.usd) this.cachedPrices.ETH = Number(data.ethereum.usd);
          if (data['usd-coin']?.usd) this.cachedPrices.USDC = Number(data['usd-coin'].usd);
          if (data.tether?.usd) this.cachedPrices.USDT = Number(data.tether.usd);
          this.lastFetchTime = now;
        }
      }
    } catch {
      // Graceful fallback to default/cached prices
    }

    return this.cachedPrices;
  }

  /**
   * Synchronous cached getter for instant UI renders
   */
  getCachedPrices(): TokenPrices {
    return this.cachedPrices;
  }
}

export const priceService = new PriceService();
