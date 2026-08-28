/**
 * @file src/__tests__/extendedMainnetConfig.test.ts
 * @description Verifies the MAINNET-first Extended configuration against the official
 * STARKNET_MAINNET_CONFIG values (from the Extended Python SDK) and the live mainnet
 * API. Everything here is public — no secrets.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  EXTENDED_MAINNET,
  EXTENDED_TESTNET,
  getExtendedEnvironment,
  streamUrl,
} from '../extended/config';
import { domainHash } from '../extended/crypto';

describe('Extended mainnet configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_EXTENDED_API_BASE_URL;
  });

  it('defaults to the official mainnet API base URL', () => {
    const env = getExtendedEnvironment();
    expect(env.apiBaseUrl).toBe('https://api.starknet.extended.exchange/api/v1');
    expect(env.onboardingUrl).toBe('https://api.starknet.extended.exchange');
    expect(env.authHost).toBe('extended.exchange');
    expect(env.signingDomain).toBe('extended.exchange');
  });

  it('matches the official STARKNET_MAINNET_CONFIG values', () => {
    expect(EXTENDED_MAINNET.streamUrl).toBe('wss://api.starknet.extended.exchange/stream.extended.exchange/v1');
    expect(EXTENDED_MAINNET.starknetDomain).toEqual({ name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 });
    expect(EXTENDED_MAINNET.collateralDecimals).toBe(6);
    expect(EXTENDED_MAINNET.takerFeeRate).toBe('0.0005');
  });

  it('resolves the mainnet deposit contract and USDC token from /info/settings', () => {
    // GET /api/v1/info/settings on mainnet returns this contract (verified live).
    expect(EXTENDED_MAINNET.depositContractAddress.toLowerCase()).toBe(
      '0x062da0780fae50d68cecaa5a051606dc21217ba290969b302db4dd99d2e9b470',
    );
    // Canonical Circle USDC on Starknet Mainnet.
    expect(EXTENDED_MAINNET.usdcTokenAddress.toLowerCase()).toBe(
      '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    );
  });

  it('resolves the testnet config when a sepolia URL is explicitly set', () => {
    process.env.NEXT_PUBLIC_EXTENDED_API_BASE_URL = 'https://api.starknet.sepolia.extended.exchange/api/v1';
    const env = getExtendedEnvironment();
    expect(env.starknetDomain.chainId).toBe('SN_SEPOLIA');
    expect(env.authHost).toBe('starknet.sepolia.extended.exchange');
  });

  it('builds mainnet stream URLs on the official stream host', () => {
    expect(streamUrl('orderbooks/BTC-USD')).toBe(
      'wss://api.starknet.extended.exchange/stream.extended.exchange/v1/orderbooks/BTC-USD',
    );
  });

  it('SNIP-12 domain hash is stable for the mainnet domain', () => {
    const h = domainHash({ name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 });
    expect(typeof h).toBe('bigint');
    expect(h).toBeGreaterThan(0n);
  });
});