/**
 * @file src/__tests__/extendedSettlement.test.ts
 * @description Verifies order settlement signing and Stark amount rounding against the
 * official SDK's order-building semantics.
 */

import { describe, it, expect } from 'vitest';
import { buildOrderRequest, buildOrderSettlement, settlementExpiration } from '../extended/settlement';
import { mulDec, mulDecInt, roundToInt, addDec } from '../extended/amount';
import type { Market } from '../extended/types';

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 };

const BTC_USD: Market = {
  name: 'BTC-USD',
  type: 'PERPETUAL',
  assetName: 'BTC',
  assetPrecision: 6,
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
    lastPrice: '40000',
    askPrice: '40005',
    bidPrice: '39998',
    markPrice: '40000',
    indexPrice: '39940',
    fundingRate: '0.001',
    nextFundingRate: 0,
    openInterest: '0',
    openInterestBase: '0',
  },
  tradingConfig: {
    minOrderSize: '0.001',
    minOrderSizeChange: '0.001',
    minPriceChange: '0.001',
    maxMarketOrderValue: '1000000',
    maxLimitOrderValue: '5000000',
    maxPositionValue: '10000000',
    maxLeverage: '50',
    maxNumOrders: '200',
    openInterestLimit: '10000000',
    limitPriceCap: '0.05',
    limitPriceFloor: '0.05',
    hourlyFundingRateCap: '2',
  },
  l2Config: {
    type: 'STARKX',
    collateralId: '0x1',
    collateralResolution: 1000000,
    syntheticId: '0x4254432d3130000000000000000000',
    syntheticResolution: 10000000000,
  },
};

const PRIV = '0x' + 123456789n.toString(16);

describe('extended amount math', () => {
  it('multiplies decimals exactly', () => {
    expect(mulDec('0.1', '40000')).toBe('4000');
    expect(mulDec('0.0005', '4000')).toBe('2');
    expect(mulDec('1.25', '2.5')).toBe('3.125');
  });

  it('multiplies decimal by integer exactly', () => {
    expect(mulDecInt('0.1', 10000000000)).toBe('1000000000');
    expect(mulDecInt('4000', 1000000)).toBe('4000000000');
  });

  it('adds decimals exactly', () => {
    expect(addDec('0.0005', '0')).toBe('0.0005');
    expect(addDec('1.1', '2.2')).toBe('3.3');
  });

  it('rounds UP away from zero and DOWN toward zero', () => {
    expect(roundToInt('1.1', 'UP')).toBe(2n);
    expect(roundToInt('1.1', 'DOWN')).toBe(1n);
    expect(roundToInt('1.0', 'UP')).toBe(1n);
    expect(roundToInt('1.0', 'DOWN')).toBe(1n);
  });
});

describe('extended order settlement', () => {
  it('computes settlement expiration as ceil((expire + 14 days) / 1s)', () => {
    const expireMs = 1_700_000_000_000;
    const expected = Math.ceil((expireMs + 14 * 86_400_000) / 1000);
    expect(settlementExpiration(expireMs).toString()).toBe(BigInt(expected).toString());
  });

  it('rounds a BUY to up, signs negative quote', () => {
    const res = buildOrderSettlement({
      market: BTC_USD,
      side: 'BUY',
      qty: '0.1',
      price: '40000',
      vaultId: 123,
      privateKey: PRIV,
      publicKey: '0x1',
      nonce: 456,
      expireTimeMs: 1_700_000_000_000,
      domain: DOMAIN,
    });
    // base = 0.1 * 1e10 = 1e9; quote = 0.1*40000 * 1e6 = 4e9 (negated on BUY); fee = 0.0005*4000*1e6 = 2e6
    expect(res.baseAmount).toBe(1_000_000_000n);
    expect(res.quoteAmount).toBe(-4_000_000_000n);
    expect(res.feeAmount).toBe(2_000_000n);
    expect(res.settlement.signature.r).toMatch(/^0x/);
    expect(res.settlement.signature.s).toMatch(/^0x/);
    expect(res.settlement.collateralPosition).toBe('123');
  });

  it('rounds a SELL to down, signs negative base', () => {
    const res = buildOrderSettlement({
      market: BTC_USD,
      side: 'SELL',
      qty: '0.1',
      price: '40000',
      vaultId: 123,
      privateKey: PRIV,
      publicKey: '0x1',
      nonce: 456,
      expireTimeMs: 1_700_000_000_000,
      domain: DOMAIN,
    });
    expect(res.baseAmount).toBe(-1_000_000_000n);
    expect(res.quoteAmount).toBe(4_000_000_000n);
  });

  it('builds a complete order request body', () => {
    const body = buildOrderRequest({
      market: BTC_USD,
      side: 'BUY',
      qty: '0.1',
      price: '40000',
      type: 'LIMIT',
      timeInForce: 'GTT',
      vaultId: 123,
      privateKey: PRIV,
      publicKey: '0x1',
      nonce: 456,
      expireTimeMs: 1_700_000_000_000,
      domain: DOMAIN,
    });
    expect(body.market).toBe('BTC-USD');
    expect(body.type).toBe('LIMIT');
    expect(body.side).toBe('BUY');
    expect(body.qty).toBe('0.1');
    expect(body.nonce).toBe('456');
    expect(body.fee).toBe('0.0005');
    expect(body.selfTradeProtectionLevel).toBe('ACCOUNT');
    expect((body.settlement as { collateralPosition: string }).collateralPosition).toBe('123');
  });

  it('uses IOC time-in-force for market orders', () => {
    const body = buildOrderRequest({
      market: BTC_USD,
      side: 'SELL',
      qty: '0.1',
      price: '39000',
      type: 'MARKET',
      timeInForce: 'IOC',
      vaultId: 123,
      privateKey: PRIV,
      publicKey: '0x1',
      domain: DOMAIN,
    });
    expect(body.type).toBe('MARKET');
    expect(body.timeInForce).toBe('IOC');
  });
});
