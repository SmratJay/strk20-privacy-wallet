import { describe, it, expect } from 'vitest';
import {
  computePriceFromReserves,
  replayPricePoints,
  maxTradeTokenOut,
  buildCreateCalldata,
  computeMetrics,
} from '@/services/launchService';
import { DEFAULT_PARAMS } from '@/config/launch';

const ONE = 10n ** 18n;
const SUPPLY = 1_000_000_000n * ONE;
const VIRTUAL_BASE = 30n * ONE;
const VIRTUAL_TOKEN = SUPPLY;

function curveState(over: Partial<any> = {}) {
  return {
    virtualBase: VIRTUAL_BASE,
    virtualToken: VIRTUAL_TOKEN,
    baseReserve: 0n,
    tokenReserve: 0n,
    graduationTarget: 120n * ONE,
    graduated: false,
    feeBps: 100n,
    creatorFeeBps: 25n,
    protocolFeeBps: 25n,
    maxTradeBps: 1000n,
    priceBase: VIRTUAL_BASE,
    priceToken: VIRTUAL_TOKEN,
    ...over,
  };
}

const metadata = {
  name: 'HAMSTR',
  symbol: 'HAMSTR',
  decimals: 18,
  totalSupply: SUPPLY,
};

describe('computePriceFromReserves (exact on-chain price reconstruction)', () => {
  it('starts at virtualBase / virtualToken (no trades yet)', () => {
    const p = computePriceFromReserves(VIRTUAL_BASE, VIRTUAL_TOKEN, 0n, 0n);
    expect(p).toBeCloseTo(3e-8, 12);
  });

  it('rises after a buy (base reserve up, token reserve up)', () => {
    const p0 = computePriceFromReserves(VIRTUAL_BASE, VIRTUAL_TOKEN, 0n, 0n)!;
    const p1 = computePriceFromReserves(VIRTUAL_BASE, VIRTUAL_TOKEN, ONE, ONE / 33n)!;
    expect(p1).toBeGreaterThan(p0);
  });

  it('returns null when the token side is exhausted (post-graduation boundary)', () => {
    expect(computePriceFromReserves(VIRTUAL_BASE, VIRTUAL_TOKEN, 0n, VIRTUAL_TOKEN)).toBeNull();
  });
});

describe('replayPricePoints (chart data from real Buy/Sell events)', () => {
  const buyEvents = [
    // data[5]=base_after, data[6]=token_after per the V2 Buy event layout.
    { block_number: '100', keys: ['0xb', 'x'], data: ['0', '0', '1000000000000000000', '0', '0', '1000000000000000000', '33333333333333333333'] },
    { block_number: '101', keys: ['0xb', 'x'], data: ['0', '0', '2000000000000000000', '0', '0', '2000000000000000000', '66000000000000000000'] },
    { block_number: '102', keys: ['0xb', 'x'], data: ['0', '0', '3000000000000000000', '0', '0', '3000000000000000000', '98000000000000000000'] },
  ];

  it('reconstructs an increasing price series oldest → newest', () => {
    const points = replayPricePoints(buyEvents, VIRTUAL_BASE, VIRTUAL_TOKEN, 120);
    expect(points).toHaveLength(3);
    expect(points[0].block).toBeLessThan(points[1].block);
    expect(points[1].price).toBeGreaterThan(points[0].price);
    expect(points[2].price).toBeGreaterThan(points[1].price);
    // block numbers preserved for the x-axis
    expect(points.map((p) => p.block)).toEqual([100, 101, 102]);
  });

  it('caps to the most recent `limit` points (last N)', () => {
    const points = replayPricePoints(buyEvents, VIRTUAL_BASE, VIRTUAL_TOKEN, 2);
    expect(points).toHaveLength(2);
    expect(points[0].block).toBe(101);
    expect(points[1].block).toBe(102);
  });

  it('skips events whose post-trade token reserve exceeds the virtual reserve', () => {
    const points = replayPricePoints(
      [{ keys: ['x'], data: ['0', '0', '0', '0', '0', '0', String(VIRTUAL_TOKEN + 1n)] }],
      VIRTUAL_BASE,
      VIRTUAL_TOKEN,
    );
    expect(points).toHaveLength(0);
  });
});

describe('maxTradeTokenOut (V2 anti-whale cap)', () => {
  it('caps a single buy at 10% of the virtual token reserve', () => {
    const curve = curveState();
    expect(maxTradeTokenOut(curve)).toBe((VIRTUAL_TOKEN * 1000n) / 10000n);
  });
});

describe('computeMetrics with V2 curve', () => {
  it('is unit-correct: market cap uses human-readable supply', () => {
    const curve = curveState({
      baseReserve: 10n * ONE,
      tokenReserve: 5n * 10n ** 23n, // 500,000 tokens
      priceBase: 40n * ONE,
      priceToken: VIRTUAL_TOKEN - 5n * 10n ** 23n,
    });
    const m = computeMetrics(curve, metadata, 'mainnet', 0n);
    expect(m.liquidity).toBeCloseTo(10, 5);
    expect(m.graduationPct).toBeCloseTo(10 / 120 * 100, 5); // 10 STRK / 120 target
    expect(m.marketCap).toBeLessThan(1_000_000);
  });

  it('reports graduation at 100% only when the curve is actually graduated', () => {
    const m = computeMetrics(curveState({ graduated: true, baseReserve: 120n * ONE }), metadata, 'mainnet');
    expect(m.graduated).toBe(true);
    expect(m.graduationPct).toBe(100);
  });
});

describe('buildCreateCalldata (V2 factory params)', () => {
  it('serializes 12 flat params with the u256 supply split [low, high]', () => {
    const calldata = buildCreateCalldata({
      name: 'HAMSTR',
      symbol: 'HSTR',
      decimals: 18,
      metadataUri: 'orrange://meta',
      totalSupply: SUPPLY.toString(),
      virtualBase: DEFAULT_PARAMS.virtualBase,
      virtualToken: DEFAULT_PARAMS.virtualToken,
      graduationTarget: DEFAULT_PARAMS.graduationTarget,
      feeBps: DEFAULT_PARAMS.feeBps,
      creatorFeeBps: DEFAULT_PARAMS.creatorFeeBps,
      protocolFeeBps: DEFAULT_PARAMS.protocolFeeBps,
      maxTradeBps: DEFAULT_PARAMS.maxTradeBps,
    });
    // name, symbol, decimals, metadataUri, supply[low], supply[high], then 7 curve params.
    // The u256 total_supply serializes to 2 felts, so the flat calldata is 13 felts long.
    expect(calldata).toHaveLength(13);
    const LOW_MASK = (1n << 128n) - 1n;
    expect(BigInt(calldata[4])).toBe(SUPPLY & LOW_MASK);
    expect(BigInt(calldata[5])).toBe(SUPPLY >> 128n);
    expect(calldata[10]).toBe('25'); // creator fee bps
    expect(calldata[11]).toBe('25'); // protocol fee bps
    expect(calldata[12]).toBe('1000'); // max trade bps
  });
});