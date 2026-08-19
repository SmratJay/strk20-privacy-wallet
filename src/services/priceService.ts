/**
 * @file priceService.ts
 * @description Centralized Real-time Token Price Service (Whitepaper Sections 5 & 13)
 * Fetches real market rates with Binance + CoinGecko streaming and graceful fallback.
 */

export interface TokenPrices {
  [symbol: string]: number;
}

const DEFAULT_PRICES: TokenPrices = {
  BTC: 96420.0,
  ETH: 3418.0,
  STRK: 0.58,
  USDC: 1.0,
  USDT: 1.0,
};

class PriceService {
  private cachedPrices: TokenPrices = { ...DEFAULT_PRICES };
  private lastFetchTime: number = 0;
  private readonly CACHE_TTL_MS = 5 * 1000; // 5 seconds cache for fast live ticks

  /**
   * Get latest prices with automatic background refresh
   */
  async getPrices(): Promise<TokenPrices> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedPrices;
    }

    try {
      // 1. Try high-performance Binance Public API first (instant, real-time)
      const res = await fetch('https://api.binance.com/api/v3/ticker/price');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.symbol === 'BTCUSDT') this.cachedPrices.BTC = parseFloat(item.price);
            if (item.symbol === 'ETHUSDT') this.cachedPrices.ETH = parseFloat(item.price);
            if (item.symbol === 'STRKUSDT') this.cachedPrices.STRK = parseFloat(item.price);
          }
          this.cachedPrices.USDC = 1.0;
          this.cachedPrices.USDT = 1.0;
          this.lastFetchTime = now;
          return this.cachedPrices;
        }
      }
    } catch {
      // Fall through to CoinGecko
    }

    try {
      // 2. Fallback to CoinGecko API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,starknet,ethereum,usd-coin,tether&vs_currencies=usd',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          if (data.bitcoin?.usd) this.cachedPrices.BTC = Number(data.bitcoin.usd);
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
  getCachedPrice(symbol: string): number {
    return this.cachedPrices[symbol.toUpperCase()] || 1.0;
  }

  getCachedPrices(): TokenPrices {
    return { ...this.cachedPrices };
  }
}

export const priceService = new PriceService();
