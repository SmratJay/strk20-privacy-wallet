import { describe, it, expect } from 'vitest';
import {
  LaunchTokenEntry,
  LaunchCurveParams,
} from '@/config/launch';
import {
  TokenSnapshot,
  matchTokenEntry,
  sortSnapshots,
  filterSnapshots,
  launchMetadataRef,
  decodeMetadataRef,
  normalizeAddress,
} from '@/services/launchService';

const PARAMS: LaunchCurveParams = {
  virtualBase: '15000000000000000000',
  virtualToken: '1073000000000000000000000000',
  graduationTarget: '50000000000000000000',
  feeBps: '100',
};

function entry(id: string, symbol: string, tokenAddr: string): LaunchTokenEntry {
  return {
    id,
    symbol,
    name: `${symbol} Coin`,
    emoji: '🪙',
    token: tokenAddr,
    curve: `0xcur${id}`,
    executor: `0xexe${id}`,
    totalSupply: '1073000000000000000000000000',
    params: PARAMS,
  };
}

function snapshot(entry: LaunchTokenEntry, over: Partial<any> = {}): TokenSnapshot {
  return {
    entry,
    metadata: { name: entry.name, symbol: entry.symbol, decimals: 18, totalSupply: 1n },
    curve: {
      virtualBase: 15n * 10n ** 18n,
      virtualToken: 1073000000000000000000000000n,
      baseReserve: 10n * 10n ** 18n,
      tokenReserve: 5n * 10n ** 23n,
      graduationTarget: 50n * 10n ** 18n,
      graduated: false,
      feeBps: 100n,
      priceBase: 25n * 10n ** 18n,
      priceToken: 1073000000000000000000000000n - 5n * 10n ** 23n,
    },
    metrics: { price: 0.1, priceUsd: 0.0001, marketCap: 100, liquidity: 10, volume: 10, graduationPct: 20, graduated: false, holders: null },
    live: true,
    ...over,
  };
}

const t0 = entry('0', 'HAMSTR', '0x1234abcdef');
const t1 = entry('1', 'ORANGE', '0x0abc');
const t2 = entry('2', 'PEPE', '0xdeadbeef');

describe('matchTokenEntry (Explore → /launch/[token] resolution)', () => {
  const list = [t0, t1, t2];

  it('resolves by factory id', () => {
    expect(matchTokenEntry(list, '1')?.symbol).toBe('ORANGE');
    expect(matchTokenEntry(list, '0')?.symbol).toBe('HAMSTR');
  });

  it('resolves by symbol case-insensitively', () => {
    expect(matchTokenEntry(list, 'hamstr')?.id).toBe('0');
    expect(matchTokenEntry(list, 'PePe')?.id).toBe('2');
  });

  it('resolves by the real token contract address', () => {
    expect(matchTokenEntry(list, '0x1234ABCDEF')?.id).toBe('0');
    expect(matchTokenEntry(list, '0xdeadbeef')?.id).toBe('2');
  });

  it('returns null for unknown keys', () => {
    expect(matchTokenEntry(list, 'nope')).toBeNull();
    expect(matchTokenEntry(list, '')).toBeNull();
    expect(matchTokenEntry([], '1')).toBeNull();
  });
});

describe('sortSnapshots (Explore ordering)', () => {
  it('sorts newest by descending factory id (creation order)', () => {
    const sorted = sortSnapshots(
      [snapshot(t0), snapshot(t1), snapshot(t2)],
      'newest',
    );
    expect(sorted.map((s) => s.entry.id)).toEqual(['2', '1', '0']);
  });

  it('sorts trending by on-chain real reserves (volume proxy), descending', () => {
    const sorted = sortSnapshots(
      [
        snapshot(t0, { curve: { baseReserve: 5n * 10n ** 18n } }),
        snapshot(t1, { curve: { baseReserve: 50n * 10n ** 18n } }),
        snapshot(t2, { curve: { baseReserve: 30n * 10n ** 18n } }),
      ],
      'trending',
    );
    expect(sorted.map((s) => s.entry.symbol)).toEqual(['ORANGE', 'PEPE', 'HAMSTR']);
  });

  it('sorts graduation by lowest progress first', () => {
    const sorted = sortSnapshots(
      [
        snapshot(t0, { metrics: { graduationPct: 80 } }),
        snapshot(t1, { metrics: { graduationPct: 10 } }),
        snapshot(t2, { metrics: { graduationPct: 40 } }),
      ],
      'graduation',
    );
    expect(sorted.map((s) => s.entry.symbol)).toEqual(['ORANGE', 'PEPE', 'HAMSTR']);
  });
});

describe('filterSnapshots (Explore search)', () => {
  const all = [snapshot(t0), snapshot(t1), snapshot(t2)];

  it('returns everything for an empty query', () => {
    expect(filterSnapshots(all, '')).toHaveLength(3);
    expect(filterSnapshots(all, '   ')).toHaveLength(3);
  });

  it('matches name and symbol, case-insensitively', () => {
    expect(filterSnapshots(all, 'orange').map((s) => s.entry.symbol)).toEqual(['ORANGE']);
    expect(filterSnapshots(all, 'hamstr').map((s) => s.entry.symbol)).toEqual(['HAMSTR']);
  });
});

describe('metadata reference (on-chain felt ↔ store)', () => {
  it('exposes a short reference that fits a felt short string', () => {
    const ref = launchMetadataRef();
    expect(ref.length).toBeLessThanOrEqual(31);
    expect(decodeMetadataRef(ref)).toBe(true);
  });

  it('decodes the felt returned by the factory get_metadata view', () => {
    // The RPC returns the felt as a bigint whose short-string value equals the ref.
    const asBigint = BigInt('0x' + Buffer.from(launchMetadataRef()).toString('hex'));
    expect(decodeMetadataRef(asBigint)).toBe(true);
    expect(decodeMetadataRef('0xdeadbeef')).toBe(false);
    expect(decodeMetadataRef(null)).toBe(false);
    expect(decodeMetadataRef('')).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('lowercases and hex-normalizes felt addresses', () => {
    expect(normalizeAddress('0xABC123')).toBe('0xabc123');
    expect(normalizeAddress('0x0')).toBe('0x0');
    expect(normalizeAddress('')).toBe('');
  });
});