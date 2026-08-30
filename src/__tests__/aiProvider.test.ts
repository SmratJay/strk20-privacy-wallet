import { describe, it, expect } from 'vitest';
import { extractJsonObject } from '@/ai/provider';
import { STATIC_PRICES_USD, isLiquidSymbol } from '@/ai/prices';

describe('extractJsonObject (AI provider response parsing)', () => {
  it('extracts a JSON object from a bare response', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('extracts from a markdown code fence with prose around it', () => {
    const text = 'Here you go:\n```json\n{"intent":"report","action":{"type":"report"}}\n```\nDone.';
    expect(JSON.parse(extractJsonObject(text)).intent).toBe('report');
  });

  it('handles nested objects and strings containing braces', () => {
    const json = '{"reason":"keep {at least} $1,000 liquid","action":{"type":"private_transfer","amount":"150.25"}}';
    const parsed = JSON.parse(extractJsonObject(json));
    expect(parsed.reason).toBe('keep {at least} $1,000 liquid');
    expect(parsed.action.amount).toBe('150.25');
  });

  it('throws when there is no JSON object', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
  });

  it('throws on unbalanced braces', () => {
    expect(() => extractJsonObject('{"a": 1')).toThrow();
  });
});

describe('prices (static fallback + liquidity classification)', () => {
  it('pins stablecoins at $1', () => {
    expect(STATIC_PRICES_USD.USDC).toBe(1);
    expect(STATIC_PRICES_USD.USDT).toBe(1);
  });

  it('classifies STRK/ETH/USDC/USDT as liquid', () => {
    for (const s of ['STRK', 'ETH', 'USDC', 'USDT']) {
      expect(isLiquidSymbol(s)).toBe(true);
    }
    expect(isLiquidSymbol('HAMSTR')).toBe(false);
  });
});