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
  splitU256,
  decodeShortString,
  resolveCreatedTokenFromReceipt,
  hash,
} from '@/services/launchService';

const PARAMS: LaunchCurveParams = {
  virtualBase: '30000000000000000000',
  virtualToken: '1000000000000000000000000000',
  graduationTarget: '120000000000000000000',
  feeBps: '100',
  creatorFeeBps: '25',
  protocolFeeBps: '25',
  maxTradeBps: '1000',
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
    totalSupply: '1000000000000000000000000000',
    params: PARAMS,
  };
}

function snapshot(entry: LaunchTokenEntry, over: Partial<any> = {}): TokenSnapshot {
  return {
    entry,
    metadata: { name: entry.name, symbol: entry.symbol, decimals: 18, totalSupply: 1n },
    curve: {
      virtualBase: 30n * 10n ** 18n,
      virtualToken: 1000000000000000000000000000n,
      baseReserve: 10n * 10n ** 18n,
      tokenReserve: 5n * 10n ** 23n,
      graduationTarget: 120n * 10n ** 18n,
      graduated: false,
      feeBps: 100n,
      creatorFeeBps: 25n,
      protocolFeeBps: 25n,
      maxTradeBps: 1000n,
      priceBase: 40n * 10n ** 18n,
      priceToken: 1000000000000000000000000000n - 5n * 10n ** 23n,
    },
    metrics: { price: 0.1, priceUsd: null, marketCap: 100, liquidity: 10, volume: 10, graduationPct: 20, graduated: false, holders: null },
    live: true,
    migrated: false,
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

  it('sorts trending by cumulative on-chain volume, descending', () => {
    const sorted = sortSnapshots(
      [
        snapshot(t0, { metrics: { volume: 5 } }),
        snapshot(t1, { metrics: { volume: 50 } }),
        snapshot(t2, { metrics: { volume: 30 } }),
      ],
      'trending',
    );
    expect(sorted.map((s) => s.entry.symbol)).toEqual(['ORANGE', 'PEPE', 'HAMSTR']);
  });

  it('sorts near-graduation progress first', () => {
    const sorted = sortSnapshots(
      [
        snapshot(t0, { metrics: { graduationPct: 80 } }),
        snapshot(t1, { metrics: { graduationPct: 10 } }),
        snapshot(t2, { metrics: { graduationPct: 40 } }),
      ],
      'graduation',
    );
    expect(sorted.map((s) => s.entry.symbol)).toEqual(['HAMSTR', 'PEPE', 'ORANGE']);
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

describe('decodeShortString (felt → ticker display)', () => {
  it('decodes STRKFTW from the raw RPC array result (callContract shape)', () => {
    // starknet.js returns a felt252 view as a 1-element array — this is exactly what the
    // token page received and wrongly displayed as 0x5354524B465457.
    expect(decodeShortString(['0x5354524b465457'])).toBe('STRKFTW');
    expect(decodeShortString(['0x5354524B465457'])).toBe('STRKFTW');
  });

  it('decodes STRKFTW from a bigint and from a bare hex string', () => {
    expect(decodeShortString(BigInt('0x5354524b465457'))).toBe('STRKFTW');
    expect(decodeShortString('0x5354524B465457')).toBe('STRKFTW');
  });

  it('leaves already-decoded strings and empty values intact', () => {
    expect(decodeShortString('STRKFTW')).toBe('STRKFTW');
    expect(decodeShortString('')).toBe('');
    expect(decodeShortString(null)).toBe('');
    expect(decodeShortString(undefined)).toBe('');
  });
});

describe('resolveCreatedTokenFromReceipt (race-safe creation)', () => {
  it('resolves the token address from the V2 TokenCreated event', () => {
    const selector = hash.getSelectorFromName('TokenCreated');
    const receipt = {
      events: [{
        keys: [selector],
        data: ['0x0', '0x123', '0xABCDEF', '0x456', '0x789'],
      }],
    };
    expect(resolveCreatedTokenFromReceipt(receipt)).toBe('0xabcdef');
  });

  it('does not guess a token when the creation event is absent', () => {
    expect(resolveCreatedTokenFromReceipt({ events: [] })).toBeNull();
  });
});

describe('normalizeAddress', () => {
  it('lowercases and hex-normalizes felt addresses', () => {
    expect(normalizeAddress('0xABC123')).toBe('0xabc123');
    expect(normalizeAddress('0x0')).toBe('0x0');
    expect(normalizeAddress('')).toBe('');
  });
});

describe('splitU256 (create calldata u256 serialization)', () => {
  it('splits a u256 into low/high felt strings that reconstruct the value', () => {
    const supply = 1073000000000000000000000000n;
    const [low, high] = splitU256(supply);
    const LOW_MASK = (1n << 128n) - 1n;
    expect(BigInt(low)).toBe(supply & LOW_MASK);
    expect(BigInt(high)).toBe(supply >> 128n);
    expect((BigInt(high) << 128n) + BigInt(low)).toBe(supply);
  });

  it('produces exactly two felts (never collapses a u256 into one felt)', () => {
    expect(splitU256(0n)).toEqual(['0', '0']);
    expect(splitU256(1n)).toEqual(['1', '0']);
    expect(splitU256(1n << 128n)).toEqual(['0', '1']);
    expect(splitU256(1073000000000000000000000000n)).toHaveLength(2);
  });
});
