/**
 * @file src/extended/config.ts
 * @description Environment-driven configuration for the Extended Exchange integration.
 *
 * MAINNET is the primary and default network. All values are overridable via
 * NEXT_PUBLIC_* env vars. Server-only credentials (EXTENDED_*) are never exposed to
 * the browser. Mainnet values were verified against the official docs and live API
 * (2026-08): see docs/EXTENDED_MAINNET_VERIFICATION.md.
 */

import type { ExtendedStarknetDomain } from './crypto';

export interface ExtendedEnvironment {
  /** Base URL for the REST API (mainnet). */
  apiBaseUrl: string;
  /** Base URL for onboarding/auth endpoints. */
  onboardingUrl: string;
  /** Public WebSocket stream base URL. */
  streamUrl: string;
  /** Auth host value signed into AccountRegistration / Login messages. */
  authHost: string;
  /** EIP-712 signing domain (EVM path). */
  signingDomain: string;
  /** SNIP-12 StarkNet domain used for message separation. */
  starknetDomain: ExtendedStarknetDomain;
  /** Collateral asset decimals (USDC). */
  collateralDecimals: number;
  /** Default taker fee rate (5 bps). */
  takerFeeRate: string;
  /** Starknet perpetuals contract used for on-chain USDC deposits. */
  depositContractAddress: string;
  /** Native Starknet USDC (ERC-20) token address on the same chain. */
  usdcTokenAddress: string;
  /** Starknet chain id constant (e.g. SN_MAIN). */
  chainId: string;
  /** Explorer base for transaction links. */
  explorerUrl: string;
}

/** Official STARKNET_MAINNET_CONFIG values (from the Extended Python SDK + live API). */
export const EXTENDED_MAINNET: ExtendedEnvironment = {
  apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
  onboardingUrl: 'https://api.starknet.extended.exchange',
  streamUrl: 'wss://api.starknet.extended.exchange/stream.extended.exchange/v1',
  authHost: 'extended.exchange',
  signingDomain: 'extended.exchange',
  starknetDomain: { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 },
  collateralDecimals: 6,
  takerFeeRate: '0.0005',
  depositContractAddress: '0x062da0780fae50d68cecaa5a051606dc21217ba290969b302db4dd99d2e9b470',
  usdcTokenAddress: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
  chainId: 'SN_MAIN',
  explorerUrl: 'https://voyager.online',
};

/** Official STARKNET_TESTNET_CONFIG values (from the Extended Python SDK + live API). */
export const EXTENDED_TESTNET: ExtendedEnvironment = {
  apiBaseUrl: 'https://api.starknet.sepolia.extended.exchange/api/v1',
  onboardingUrl: 'https://api.starknet.sepolia.extended.exchange',
  streamUrl: 'wss://starknet.sepolia.extended.exchange/stream.extended.exchange/v1',
  authHost: 'starknet.sepolia.extended.exchange',
  signingDomain: 'starknet.sepolia.extended.exchange',
  starknetDomain: { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 },
  collateralDecimals: 6,
  takerFeeRate: '0.0005',
  depositContractAddress: '0x062da0780fae50d68cecaa5a051606dc21217ba290969b302db4dd99d2e9b470',
  usdcTokenAddress: '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343',
  chainId: 'SN_SEPOLIA',
  explorerUrl: 'https://sepolia.voyager.online',
};

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** Resolve the active environment. Mainnet is the default and the primary network. */
export function getExtendedEnvironment(): ExtendedEnvironment {
  const base = fromEnv(
    'NEXT_PUBLIC_EXTENDED_API_BASE_URL',
    EXTENDED_MAINNET.apiBaseUrl,
  );
  const isMainnet = !base.includes('sepolia');

  const mainnet: ExtendedEnvironment = {
    ...EXTENDED_MAINNET,
    apiBaseUrl: base,
    onboardingUrl: fromEnv('NEXT_PUBLIC_EXTENDED_ONBOARDING_URL', EXTENDED_MAINNET.onboardingUrl),
    signingDomain: fromEnv('NEXT_PUBLIC_EXTENDED_SIGNING_DOMAIN', EXTENDED_MAINNET.signingDomain),
    authHost: fromEnv('NEXT_PUBLIC_EXTENDED_AUTH_HOST', EXTENDED_MAINNET.authHost),
    streamUrl: fromEnv('NEXT_PUBLIC_EXTENDED_STREAM_URL', EXTENDED_MAINNET.streamUrl),
    depositContractAddress: fromEnv(
      'NEXT_PUBLIC_EXTENDED_DEPOSIT_CONTRACT',
      EXTENDED_MAINNET.depositContractAddress,
    ),
    usdcTokenAddress: fromEnv(
      'NEXT_PUBLIC_EXTENDED_USDC_TOKEN',
      EXTENDED_MAINNET.usdcTokenAddress,
    ),
  };
  if (isMainnet) return mainnet;

  return {
    ...EXTENDED_TESTNET,
    apiBaseUrl: base,
    onboardingUrl: fromEnv('NEXT_PUBLIC_EXTENDED_ONBOARDING_URL', EXTENDED_TESTNET.onboardingUrl),
    signingDomain: fromEnv('NEXT_PUBLIC_EXTENDED_SIGNING_DOMAIN', EXTENDED_TESTNET.signingDomain),
    authHost: fromEnv('NEXT_PUBLIC_EXTENDED_AUTH_HOST', EXTENDED_TESTNET.authHost),
    streamUrl: fromEnv('NEXT_PUBLIC_EXTENDED_STREAM_URL', EXTENDED_TESTNET.streamUrl),
    depositContractAddress: fromEnv(
      'NEXT_PUBLIC_EXTENDED_DEPOSIT_CONTRACT',
      EXTENDED_TESTNET.depositContractAddress,
    ),
    usdcTokenAddress: fromEnv(
      'NEXT_PUBLIC_EXTENDED_USDC_TOKEN',
      EXTENDED_TESTNET.usdcTokenAddress,
    ),
  };
}

/** Build a full WebSocket stream URL for a market-data path (e.g. orderbooks/BTC-USD). */
export function streamUrl(path: string, env?: ExtendedEnvironment): string {
  const e = env ?? getExtendedEnvironment();
  const base = e.streamUrl.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}