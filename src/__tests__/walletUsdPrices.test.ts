import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('wallet USD pricing', () => {
  it('uses the reported stablecoin price instead of assuming $1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ 'usd-coin': { usd: 0.997 }, tether: { usd: 0.998 }, starknet: { usd: 0.22 } }))));
    const { priceService } = await import('@/services/priceService');
    const prices = await priceService.getPrices();
    expect(prices.USDC).toBe(0.997);
    expect(prices.STRK).toBe(0.22);
    expect(prices.ETH).toBeNull();
  });
  it('returns unavailable on upstream failure, not fabricated prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const { priceService } = await import('@/services/priceService');
    expect(await priceService.getPrices()).toEqual({});
    expect(priceService.getCachedPrice('USDC')).toBeNull();
  });
});
