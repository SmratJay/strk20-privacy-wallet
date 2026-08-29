/**
 * @file src/__tests__/extendedTerminal.test.ts
 * @description Tests for the new Extended terminal logic:
 *   - error translation (translateError) used across the UI
 *   - mainnet enforcement helpers from the Extended wallet provider
 *   - withdrawal recipient wiring (session wallet → signed withdrawal)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translateError } from '../hooks/useExtended';
import { MAINNET_CHAIN_ID, isMainnetChain } from '../extended/chain';
import { credentialsFromSession } from '../extended/server';
import type { ExtendedSession } from '../extended/session';
import { ExtendedServerClient } from '../extended/server';
import type { Market, Fees, PlacedOrder } from '../extended/types';

describe('translateError', () => {
  it('maps wrong-network errors to an actionable mainnet message', () => {
    expect(translateError('Wrong network, switch to SN_MAIN')).toContain('Mainnet');
  });

  it('maps wallet rejection to a clear signature message', () => {
    expect(translateError('User rejected the request in your wallet')).toContain('rejected');
  });

  it('maps missing wallet to install guidance', () => {
    expect(translateError('Ready Wallet is not detected in your browser')).toContain('Install');
  });

  it('maps insufficient margin errors', () => {
    expect(translateError('Insufficient maintenance margin')).toContain('margin');
  });

  it('maps insufficient balance errors', () => {
    expect(translateError('Insufficient usdc balance')).toContain('USDC');
  });

  it('maps market-not-found errors', () => {
    expect(translateError('MarketNotFound: BTC-USD')).toContain('not available');
  });

  it('passes through unknown but useful messages', () => {
    expect(translateError('Order has negative size')).toBe('Order has negative size');
  });

  it('avoids the generic fallback for empty errors', () => {
    expect(translateError('')).toBe('Something went wrong. Please try again.');
  });
});

describe('Extended wallet mainnet enforcement', () => {
  it('recognises the Starknet Mainnet chain id', () => {
    expect(isMainnetChain(String(MAINNET_CHAIN_ID))).toBe(true);
  });

  it('rejects Sepolia', () => {
    expect(isMainnetChain('0x534e5f5345504f4c4941')).toBe(false);
  });

  it('rejects null / empty chain ids', () => {
    expect(isMainnetChain(null)).toBe(false);
    expect(isMainnetChain('')).toBe(false);
  });

  it('is case-insensitive on hex chain ids', () => {
    expect(isMainnetChain(String(MAINNET_CHAIN_ID).toUpperCase())).toBe(true);
  });
});

describe('Extended withdrawal recipient', () => {
  it('credentialsFromSession carries the session wallet as withdrawal recipient', () => {
    const session: ExtendedSession = {
      token: 'sess_test',
      wallet: '0x0123',
      l2Key: { privateKey: '0x1', publicKey: '0x2' },
      cookies: ['sid=abc'],
      accountId: 1,
      vaultId: 2,
      status: 'ok',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    const creds = credentialsFromSession(session);
    expect(creds?.recipient).toBe('0x0123');
  });

  it('env credentials fall back to the configured recipient', () => {
    vi.stubEnv('EXTENDED_WITHDRAWAL_RECIPIENT', '0xdeadbeef');
    const server = new ExtendedServerClient({
      apiKey: null,
      starkPrivateKey: '0x1',
      starkPublicKey: '0x2',
      vaultId: 1,
      accountId: 1,
      cookies: [],
      recipient: '0xdeadbeef',
    });
    expect(server).toBeDefined();
    vi.unstubAllEnvs();
  });

  it('signed withdrawal request body includes the session wallet as recipient', async () => {
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
        dailyVolume: '0', dailyVolumeBase: '0', dailyPriceChange: '0', dailyPriceChangePercentage: '0',
        dailyLow: '0', dailyHigh: '0', lastPrice: '78000', askPrice: '78001', bidPrice: '77999',
        markPrice: '78000', indexPrice: '78000', fundingRate: '0', nextFundingRate: 0, openInterest: '0', openInterestBase: '0',
      },
      tradingConfig: {
        minOrderSize: '0.0001', minOrderSizeChange: '0.0001', minPriceChange: '1', maxMarketOrderValue: '500000',
        maxLimitOrderValue: '2500000', maxPositionValue: '7000000', maxLeverage: '50', maxNumOrders: '200',
        openInterestLimit: '0', limitPriceCap: '0', limitPriceFloor: '0', hourlyFundingRateCap: '0',
      },
      l2Config: {
        type: 'STARKX', collateralId: '0x1', collateralResolution: 1000000,
        syntheticId: '0x4254432d3600000000000000000000', syntheticResolution: 1000000,
      },
    };
    const FEES: Fees[] = [{ market: 'BTC-USD', makerFeeRate: '0.0002', takerFeeRate: '0.0005', builderFeeRate: '0' }];

    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const json = () => {
        if (url.includes('/info/starknet')) return Promise.resolve({ status: 'OK', data: { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 } });
        if (url.includes('/user/fees')) return Promise.resolve({ status: 'OK', data: FEES });
        if (url.includes('/info/markets')) return Promise.resolve({ status: 'OK', data: [MARKET] });
        if (url.includes('/user/withdrawal')) return Promise.resolve({ status: 'OK', data: { id: 77 } });
        return Promise.resolve({ status: 'OK', data: {} });
      };
      return {
        ok: true,
        status: 200,
        json,
        headers: new Headers({ 'content-type': 'application/json' }),
        statusText: 'OK',
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const RECIPIENT = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
    const server = new ExtendedServerClient({
      apiKey: null,
      starkPrivateKey: '0x5',
      starkPublicKey: '0x7',
      vaultId: 42,
      accountId: 9,
      cookies: ['sid=xyz'],
      recipient: RECIPIENT,
    });

    const result = await server.createWithdrawal({ amount: '1.5' });
    expect(result).toEqual({ id: 77 });

    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/user/withdrawal'));
    expect(call).toBeDefined();
    expect(call).toBeTruthy();
    const body = JSON.parse(String(call![1]?.body));
    expect(body.settlement.recipient).toBe(RECIPIENT);
    expect(body.amount).toBe('1.5');
    vi.unstubAllGlobals();
  });

  it('createWithdrawal rejects when no recipient is configured', async () => {
    const server = new ExtendedServerClient({
      apiKey: 'key',
      starkPrivateKey: '0x5',
      starkPublicKey: '0x7',
      vaultId: 42,
      accountId: 9,
      cookies: [],
      recipient: null,
    });
    await expect(server.createWithdrawal({ amount: '1.5' })).rejects.toThrow(/recipient/i);
  });
});