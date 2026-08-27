/**
 * @file src/extended/config.ts
 * @description Environment-driven configuration for the Extended Exchange integration.
 *
 * Defaults point at Extended's official Starknet Sepolia (testnet) API. All values are
 * overridable via NEXT_PUBLIC_* env vars — no secrets are ever hard-coded or committed.
 */

import type { ExtendedStarknetDomain } from './crypto';

export interface ExtendedEnvironment {
  /** Base URL for the REST API (testnet). */
  apiBaseUrl: string;
  /** Base URL for onboarding endpoints. */
  onboardingUrl: string;
  /** EIP-712 signing domain name. */
  signingDomain: string;
  /** SNIP-12 StarkNet domain used for message separation. */
  starknetDomain: ExtendedStarknetDomain;
  /** Collateral asset decimals (USDC). */
  collateralDecimals: number;
  /** Default taker fee rate (5 bps). */
  takerFeeRate: string;
}

export const EXTENDED_TESTNET: ExtendedEnvironment = {
  apiBaseUrl: 'https://api.starknet.sepolia.extended.exchange/api/v1',
  onboardingUrl: 'https://api.starknet.sepolia.extended.exchange',
  signingDomain: 'starknet.sepolia.extended.exchange',
  starknetDomain: { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 },
  collateralDecimals: 6,
  takerFeeRate: '0.0005',
};

export const EXTENDED_MAINNET: ExtendedEnvironment = {
  apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
  onboardingUrl: 'https://api.starknet.extended.exchange',
  signingDomain: 'extended.exchange',
  starknetDomain: { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 },
  collateralDecimals: 6,
  takerFeeRate: '0.0005',
};

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** Resolve the active environment. Testnet is the default and the only network wired up. */
export function getExtendedEnvironment(): ExtendedEnvironment {
  const base = fromEnv(
    'NEXT_PUBLIC_EXTENDED_API_BASE_URL',
    'https://api.starknet.sepolia.extended.exchange/api/v1',
  );
  const isMainnet = base.includes('api.starknet.extended.exchange') && !base.includes('sepolia');

  if (isMainnet) return EXTENDED_MAINNET;

  return {
    ...EXTENDED_TESTNET,
    apiBaseUrl: base,
    onboardingUrl: fromEnv('NEXT_PUBLIC_EXTENDED_ONBOARDING_URL', EXTENDED_TESTNET.onboardingUrl),
    signingDomain: fromEnv('NEXT_PUBLIC_EXTENDED_SIGNING_DOMAIN', EXTENDED_TESTNET.signingDomain),
  };
}
