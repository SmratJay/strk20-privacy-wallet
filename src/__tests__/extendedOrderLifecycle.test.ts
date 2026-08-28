/**
 * @file src/__tests__/extendedOrderLifecycle.test.ts
 * @description Verifies the order lifecycle and error/reconciliation states on the
 * server client: market order request shape, cancellation, reduced credentials,
 * account snapshot reconciliation (per-partial-failure), and deposit history.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExtendedServerClient, credentialsFromSession } from '../extended/server';
import { ExtendedClient } from '../extended/client';
import { EXTENDED_MAINNET } from '../extended/config';
import type { Fees, Market, PlacedOrder } from '../extended/types';

const MARKET: Market = {
  name: 'BTC-USD',
  type: 'PERPETUAL',
  assetName: 'BTC',
  assetPrecision: 5,
  collateralAssetName: 'USD',
  collateralAssetPrecision: 6,
  active: true,
  status: 'ACTIVE',
  isRfq: false,
  isOffHours: false,
  marketStats: {
    dailyVolume: '1000', dailyVolumeBase: '1', dailyPriceChange: '1', dailyPriceChangePercentage: '1',
    dailyLow: '1', dailyHigh: '2', lastPrice: '1.5', askPrice: '1.5', bidPrice: '1.5',
    markPrice: '1.5', indexPrice: '1.5', fundingRate: '0', nextFundingRate: 0,
    openInterest: '10', openInterestBase: '10',
  },
  tradingConfig: {
    minOrderSize: '0.0001', minOrderSizeChange: '0.00001', minPriceChange: '1',
    maxMarketOrderValue: '100000', maxLimitOrderValue: '100000', maxPositionValue: '100000',
    maxLeverage: '50', maxNumOrders: '200', openInterestLimit: '0', limitPriceCap: '0.1',
    limitPriceFloor: '0.1', hourlyFundingRateCap: '0.5',
  },
  l2Config: { type: 'STARKX', collateralId: '0x1', collateralResolution: 1000000, syntheticId: '0x4254432d3600000000000000000000', syntheticResolution: 1000000 },
};

const FEES: Fees[] = [{ market: 'BTC-USD', makerFeeRate: '0.0002', takerFeeRate: '0.0005', builderFeeRate: '0' }];
const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 };

const CREDS = {
  apiKey: 'key-1',
  starkPrivateKey: '0x' + 123456789n.toString(16),
  starkPublicKey: '0x1',
  vaultId: 503769,
  accountId: 123,
  cookies: [],
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ status: status < 400 ? 'OK' : 'ERROR', data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Extended order lifecycle + reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('places a market order and reconciles the account snapshot', async () => {
    let posted = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/info/markets')) return jsonResponse(200, [MARKET]);
      if (url.includes('/user/fees')) return jsonResponse(200, FEES);
      if (url.includes('/info/starknet')) return jsonResponse(200, DOMAIN);
      if (url.includes('/user/order') && init?.method === 'POST') {
        posted = String(init.body ?? '');
        return jsonResponse(200, { id: 11, externalId: '22' } as PlacedOrder);
      }
      if (url.includes('/user/order/') && init?.method === 'DELETE') return jsonResponse(200, {});
      if (url.includes('/user/balance')) return jsonResponse(200, { collateralName: 'USD', balance: '100', equity: '100', availableForTrade: '90', availableForWithdrawal: '90', unrealisedPnl: '0', withdrawableUnrealisedPnl: '0', initialMargin: '10', marginRatio: '0.1', exposure: '10', leverage: '10' });
      if (url.includes('/user/positions')) return jsonResponse(200, []);
      if (url.includes('/user/orders/history')) return jsonResponse(200, []);
      if (url.includes('/user/orders')) return jsonResponse(200, []);
      if (url.includes('/user/deposits')) return jsonResponse(200, []);
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = new ExtendedServerClient(CREDS);
    const placed = await server.placeOrder({ market: 'BTC-USD', side: 'BUY', qty: '0.001', price: '78000', type: 'MARKET', timeInForce: 'IOC' });
    expect(placed.id).toBe(11);
    const body = JSON.parse(posted) as Record<string, any>;
    expect(body.market).toBe('BTC-USD');
    expect(body.type).toBe('MARKET');
    expect(body.timeInForce).toBe('IOC');
    expect(body.settlement.starkKey).toBe('0x1');

    await server.cancelOrder(11);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/user/order/11'),
      expect.objectContaining({ method: 'DELETE' }),
    );

    const snapshot = await server.getAccountSnapshot();
    expect(snapshot.balance?.collateralName).toBe('USD');
    expect(snapshot.positions).toEqual([]);
  });

  it('reconciles partial account-read failures without throwing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/user/balance')) return jsonResponse(200, { collateralName: 'USD', balance: '1', equity: '1', availableForTrade: '1', availableForWithdrawal: '1', unrealisedPnl: '0', withdrawableUnrealisedPnl: '0', initialMargin: '0', marginRatio: '0', exposure: '0', leverage: '0' });
      if (url.includes('/user/positions')) throw new Error('boom');
      if (url.includes('/user/orders/history')) return jsonResponse(200, []);
      if (url.includes('/user/orders')) return jsonResponse(200, []);
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = new ExtendedServerClient(CREDS);
    const snapshot = await server.getAccountSnapshot();
    expect(snapshot.balance?.balance).toBe('1');
    expect(snapshot.positions).toEqual([]); // positions read failed → empty, no throw
  });

  it('fails closed when trading credentials are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const server = new ExtendedServerClient({ apiKey: null, starkPrivateKey: null, starkPublicKey: null, vaultId: null, accountId: null, cookies: [] });
    await expect(server.placeOrder({ market: 'BTC-USD', side: 'BUY', qty: '1', price: '1' })).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives credentials from an onboarded session (cookies + L2 key)', () => {
    const creds = credentialsFromSession({
      token: 'sess_x',
      wallet: '0xabc',
      l2Key: { privateKey: '0xpriv', publicKey: '0xpub' },
      cookies: ['x10_session=abc'],
      accountId: 7,
      vaultId: 700,
      createdAt: 0,
    });
    expect(creds?.starkPrivateKey).toBe('0xpriv');
    expect(creds?.cookies).toEqual(['x10_session=abc']);
    expect(creds?.vaultId).toBe(700);
    expect(creds?.apiKey).toBeNull();
    const server = new ExtendedServerClient(creds!);
    expect(server.configured).toEqual({ read: true, trade: true });
    expect(server.isSessionMode).toBe(true);
  });

  it('exposes the mainnet public candles + trades endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/info/candles/BTC-USD/trades')) {
        return jsonResponse(200, [{ o: '1', c: '2', h: '2', l: '1', v: '3', T: 123 }]);
      }
      if (url.includes('/info/markets/BTC-USD/trades')) {
        return jsonResponse(200, [{ i: 1, m: 'BTC-USD', S: 'BUY', tT: 'TRADE', T: 123, p: '1', q: '2' }]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ExtendedClient({ env: EXTENDED_MAINNET, apiKey: undefined });
    const candles = await client.getCandles('BTC-USD', 'trades', '1m', 100);
    expect(candles[0].c).toBe('2');
    const trades = await client.getTrades('BTC-USD');
    expect(trades[0].S).toBe('BUY');
  });
});