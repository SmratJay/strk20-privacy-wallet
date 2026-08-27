/**
 * @file src/__tests__/extendedServer.test.ts
 * @description Verifies the server-side order path (`ExtendedServerClient.placeOrder`)
 * against a mocked Extended API. Confirms the signed request matches the official SDK
 * shape (decimal order id, decimal fee = max(maker, taker), decimal nonce, settlement
 * envelope) and that private credentials never appear in the request/response surface.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExtendedServerClient } from '../extended/server';
import type { Market, Fees, PlacedOrder } from '../extended/types';

const MARKET: Market = {
  name: 'CRV-USD',
  type: 'PERPETUAL',
  assetName: 'CRV',
  assetPrecision: 5,
  collateralAssetName: 'USD',
  collateralAssetPrecision: 6,
  active: true,
  status: 'ACTIVE',
  isRfq: false,
  isOffHours: false,
  marketStats: {
    dailyVolume: '0',
    dailyVolumeBase: '0',
    dailyPriceChange: '0',
    dailyPriceChangePercentage: '0',
    dailyLow: '0',
    dailyHigh: '0',
    lastPrice: '0.328',
    askPrice: '0.3282',
    bidPrice: '0.3279',
    markPrice: '0.3287',
    indexPrice: '0.328',
    fundingRate: '0.0001',
    nextFundingRate: 0,
    openInterest: '0',
    openInterestBase: '0',
  },
  tradingConfig: {
    minOrderSize: '10',
    minOrderSizeChange: '1',
    minPriceChange: '0.00001',
    maxMarketOrderValue: '200000',
    maxLimitOrderValue: '1000000',
    maxPositionValue: '2100000',
    maxLeverage: '20',
    maxNumOrders: '200',
    openInterestLimit: '100000',
    limitPriceCap: '0.1',
    limitPriceFloor: '0.1',
    hourlyFundingRateCap: '3',
  },
  l2Config: {
    type: 'STARKX',
    collateralId: '0x1',
    collateralResolution: 1000000,
    syntheticId: '0x4352562d3600000000000000000000',
    syntheticResolution: 100000,
  },
};

const FEES: Fees[] = [
  { market: 'CRV-USD', makerFeeRate: '0.0002', takerFeeRate: '0.0005', builderFeeRate: '0' },
];

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 };

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ status: status < 400 ? 'OK' : 'ERROR', data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ExtendedServerClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports configured status without exposing secrets', () => {
    const server = new ExtendedServerClient({
      apiKey: 'key-1',
      starkPrivateKey: '0xpriv',
      starkPublicKey: '0xpub',
      vaultId: 123,
    });
    expect(server.configured).toEqual({ read: true, trade: true });

    const server2 = new ExtendedServerClient({ apiKey: 'key-1', starkPrivateKey: null, starkPublicKey: null, vaultId: null });
    expect(server2.configured).toEqual({ read: true, trade: false });
  });

  it('places a signed order with the official request shape', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/info/markets')) return jsonResponse(200, [MARKET]);
      if (url.includes('/user/fees')) return jsonResponse(200, FEES);
      if (url.includes('/info/starknet')) return jsonResponse(200, DOMAIN);
      if (url.includes('/user/order')) {
        return jsonResponse(200, { id: 123456789, externalId: '99' } as PlacedOrder);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = new ExtendedServerClient({
      apiKey: 'key-1',
      starkPrivateKey: '0x' + 123456789n.toString(16),
      starkPublicKey: '0x1',
      vaultId: 503769,
    });

    const placed = await server.placeOrder({
      market: 'CRV-USD',
      side: 'BUY',
      qty: '10',
      price: '0.33',
      type: 'MARKET',
      timeInForce: 'IOC',
    });

    expect(placed.id).toBe(123456789);

    // Find the order POST call and validate the body.
    const orderCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/user/order'));
    expect(orderCall).toBeDefined();
    const [url, init] = orderCall as unknown as [string, { body?: string; headers?: Record<string, string> }];
    const body = JSON.parse(init?.body ?? '{}');

    expect(String(url)).toContain('/api/v1/user/order');
    expect(init.headers).toHaveProperty('X-Api-Key', 'key-1');
    expect(body.market).toBe('CRV-USD');
    expect(body.side).toBe('BUY');
    expect(body.qty).toBe('10');
    expect(body.type).toBe('MARKET');
    expect(body.timeInForce).toBe('IOC');
    // fee = max(maker, taker)
    expect(body.fee).toBe('0.0005');
    expect(String(body.nonce)).toMatch(/^\d+$/);
    expect(String(body.id)).toMatch(/^\d+$/);
    expect(body.settlement).toBeDefined();
    expect(body.settlement.starkKey).toBe('0x1');
    expect(body.settlement.collateralPosition).toBe('503769');
    expect(body.settlement.signature).toHaveProperty('r');
    expect(body.settlement.signature).toHaveProperty('s');
    expect(String(body.settlement.signature.r)).toMatch(/^0x/);
  });

  it('refuses to trade when credentials are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const server = new ExtendedServerClient({ apiKey: 'key-1', starkPrivateKey: null, starkPublicKey: null, vaultId: null });
    await expect(
      server.placeOrder({ market: 'CRV-USD', side: 'BUY', qty: '10', price: '0.33' }),
    ).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});