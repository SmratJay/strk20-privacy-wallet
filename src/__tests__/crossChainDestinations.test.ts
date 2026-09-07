import { describe, expect, it, vi } from 'vitest';
import { NearIntentClient } from '@/features/near-intents/client';
import { isSolanaAddress, sameDestination, validateChainAddress } from '@/features/near-intents/address';
import { routesFromTokens } from '@/features/near-intents/registry';
import { NEAR_INTENT_STRK_ASSET_ID, NEAR_INTENT_BASE_USDC_ASSET_ID } from '@/features/near-intents/routes';
import { toPrivacyHubRoutes } from '@/features/privacy-hub/routes';

// Fixtures copied from the live public registry; production Solana IDs are resolved at runtime.
const registry = [
  { blockchain: 'starknet', symbol: 'STRK', decimals: 18, assetId: NEAR_INTENT_STRK_ASSET_ID },
  { blockchain: 'base', symbol: 'USDC', decimals: 6, assetId: NEAR_INTENT_BASE_USDC_ASSET_ID },
  { blockchain: 'sol', symbol: 'SOL', decimals: 9, assetId: 'nep141:sol.omft.near' },
  { blockchain: 'sol', symbol: 'USDC', decimals: 6, assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
];

describe('live-registry route model', () => {
  it('preserves the native fetch receiver in browsers', async () => {
    vi.stubGlobal('fetch', function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response('[]'));
    });
    try { expect(await new NearIntentClient().getTokens()).toEqual([]); }
    finally { vi.unstubAllGlobals(); }
  });
  it('preserves Base and resolves SOL/USDC using exact IDs and decimals', () => {
    const routes = routesFromTokens(registry);
    expect(routes).toHaveLength(3);
    expect(routes[0].id).toBe('starknet-strk-to-base-usdc');
    expect(routes.find(r => r.destinationToken.symbol === 'SOL')?.destinationToken.decimals).toBe(9);
    expect(routes.filter(r => r.destinationChain === 'solana').every(r => r.destinationAddressKind === 'solana' && r.destinationAsset === r.destinationAssetId)).toBe(true);
    expect(toPrivacyHubRoutes(routes).every(r => r.provider === 'near-intents' && r.privacy.includes('destination-public'))).toBe(true);
  });
  it('never creates unlisted meme routes or falls back on missing source/malformed registry', () => {
    expect(routesFromTokens(registry).some(r => ['BONK', 'WIF', 'POPCAT'].includes(r.destinationToken.symbol))).toBe(false);
    expect(routesFromTokens(registry.slice(1))).toEqual([]);
    expect(() => routesFromTokens({ error: 'unavailable' })).toThrow(/invalid/);
  });
  it('deduplicates registry IDs and excludes invalid decimals', () => {
    expect(routesFromTokens([...registry, registry[2], { ...registry[2], assetId: 'invalid', decimals: -1 }])).toHaveLength(3);
  });
});

describe('Solana address validation', () => {
  it('requires a 32-byte base58 encoding, not just plausible length', () => {
    expect(isSolanaAddress(registry[3].contractAddress!)).toBe(true);
    expect(isSolanaAddress('1'.repeat(32))).toBe(true);
    expect(isSolanaAddress('1'.repeat(31))).toBe(false);
    expect(isSolanaAddress('1'.repeat(33))).toBe(false);
    expect(isSolanaAddress('z'.repeat(44))).toBe(false);
    expect(isSolanaAddress('0'.repeat(32))).toBe(false);
    expect(validateChainAddress('0x' + '0'.repeat(40), 'evm')).not.toBeNull();
  });
  it('does not lowercase Solana destinations when binding quotes', () => {
    const address = registry[3].contractAddress!;
    expect(sameDestination(address, address.toLowerCase(), 'solana')).toBe(false);
    expect(sameDestination('0xaBc', '0xAbC', 'base')).toBe(true);
  });
});
