/**
 * @file src/config/launch.ts
 * @description UMBRA LAUNCH configuration: networks, base asset, factory + demo registry.
 *
 * Mainnet-first. Contract addresses are injected via env so the app reads real on-chain
 * state once contracts are deployed; until then the seeded registry drives the UI with
 * live reads disabled (never fabricated balances).
 */

export interface LaunchCurveParams {
  /** Virtual base reserve (smallest unit). Defaults to 15 STRK. */
  virtualBase: string;
  /** Virtual token reserve (smallest unit). Defaults to 1_073_000_000e18. */
  virtualToken: string;
  /** Real base accumulated to graduate (smallest unit). Defaults to 50 STRK. */
  graduationTarget: string;
  /** Fee basis points. Defaults to 100 (1%). */
  feeBps: string;
}

export interface LaunchSocials {
  x?: string;
  telegram?: string;
  website?: string;
}

export interface LaunchTokenEntry {
  id: string;
  symbol: string;
  name: string;
  emoji: string;
  /** ERC20 memecoin address. */
  token: string;
  /** BondingCurve address. */
  curve: string;
  /** PrivateCurveExecutor address. */
  executor: string;
  /** Total supply (smallest unit). */
  totalSupply: string;
  params: LaunchCurveParams;
  /** Optional factory-issued metadata URI. */
  metadataUri?: string;
  creator?: string;
}

export interface LaunchNetworkConfig {
  chainId: 'SN_MAIN' | 'SN_SEPOLIA';
  /** STRK20 privacy pool address for the network. */
  poolAddress: string;
  /** Base asset for memecoins (STRK). */
  baseAsset: string;
  baseAssetDecimals: number;
  /** TokenFactory address (empty until deployed). */
  factory: string;
  /** GraduationRouter address (empty until deployed). */
  router: string;
  /**
   * Block to start BondingCurve Buy/Sell event scans from for cumulative volume.
   * Should be set to a block before the TokenFactory deployment on the network so every
   * factory-launched curve's full trade history is covered. 0 disables volume reads.
   */
  eventScanStartBlock: number;
  /** Seeded demo registry used when the factory is not deployed/configured. */
  registry: LaunchTokenEntry[];
}

export const STRK_MAINNET =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
export const STRK_SEPOLIA =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

export const MAINNET_UMBRA_POOL =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';
export const SEPOLIA_UMBRA_POOL =
  '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91';

const DEFAULT_PARAMS: LaunchCurveParams = {
  virtualBase: '15000000000000000000', // 15 STRK
  virtualToken: '1073000000000000000000000000', // 1,073,000,000 tokens
  graduationTarget: '50000000000000000000', // 50 STRK
  feeBps: '100', // 1%
};

const DEFAULT_TOTAL_SUPPLY = '1073000000000000000000000000';

/**
 * On-chain metadata reference stored in TokenFactory.metadata_uri. It is a short felt that
 * marks a token as using the ORRANGE launch metadata store; the full description/image/
 * socials payload lives off-chain in the /api/launch/metadata store, keyed by token address.
 * Kept deliberately tiny (≤31 chars) so it fits in a felt short string.
 */
export const LAUNCH_METADATA_REF = 'orrange://meta';

/** Create-form defaults (identical to the factory default curve the deploy script uses). */
export const CREATE_DEFAULTS = {
  decimals: 18,
  totalSupply: DEFAULT_TOTAL_SUPPLY,
  virtualBase: DEFAULT_PARAMS.virtualBase,
  virtualToken: DEFAULT_PARAMS.virtualToken,
  graduationTarget: DEFAULT_PARAMS.graduationTarget,
  feeBps: DEFAULT_PARAMS.feeBps,
};

/** Addresses are read from env so a real deployment can be wired without code changes. */
function envFactory(): { factory: string; router: string } {
  return {
    factory: process.env.NEXT_PUBLIC_UMBRA_FACTORY || '',
    router: process.env.NEXT_PUBLIC_UMBRA_ROUTER || '',
  };
}

function envFactorySepolia(): { factory: string; router: string } {
  return {
    factory:
      process.env.NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY || process.env.NEXT_PUBLIC_UMBRA_FACTORY || '',
    router: process.env.NEXT_PUBLIC_UMBRA_ROUTER || '',
  };
}

/**
 * Build the seeded demo registry. Env overrides let an actual deployed curve/executor drive
 * live reads; empty addresses keep the UI in a clear "pending deployment" state.
 */
function seedRegistry(base: string, prefix: string): LaunchTokenEntry[] {
  const mk = (
    id: string,
    symbol: string,
    name: string,
    emoji: string,
    suffix: string,
  ): LaunchTokenEntry => ({
    id,
    symbol,
    name,
    emoji,
    token: process.env[`${prefix}${suffix}_TOKEN`] || '',
    curve: process.env[`${prefix}${suffix}_CURVE`] || '',
    executor: process.env[`${prefix}${suffix}_EXECUTOR`] || '',
    totalSupply: DEFAULT_TOTAL_SUPPLY,
    params: DEFAULT_PARAMS,
    metadataUri: `umbra://${id.toLowerCase()}`,
  });
  return [mk('hamstr', 'HAMSTR', 'Hampton the Hamster', '🐹', 'HAMSTR'), mk('orange', 'ORANGE', 'Orange the Cat', '🍊', 'ORANGE')];
}

export const LAUNCH_NETWORKS: Record<'mainnet' | 'sepolia', LaunchNetworkConfig> = {
  mainnet: {
    chainId: 'SN_MAIN',
    poolAddress: MAINNET_UMBRA_POOL,
    baseAsset: STRK_MAINNET,
    baseAssetDecimals: 18,
    factory: envFactory().factory,
    router: envFactory().router,
    eventScanStartBlock: 0, // no factory on mainnet yet — volume reads disabled
    registry: seedRegistry(STRK_MAINNET, 'NEXT_PUBLIC_UMBRA_'),
  },
  sepolia: {
    chainId: 'SN_SEPOLIA',
    poolAddress: SEPOLIA_UMBRA_POOL,
    baseAsset: STRK_SEPOLIA,
    baseAssetDecimals: 18,
    factory: envFactorySepolia().factory,
    router: envFactorySepolia().router,
    // A few blocks before the Sepolia TokenFactory deployment (block 14247451) so every
    // factory-launched curve's Buy/Sell events are scanned for cumulative volume.
    eventScanStartBlock: 14247000,
    registry: seedRegistry(STRK_SEPOLIA, 'NEXT_PUBLIC_UMBRA_'),
  },
};

export function getLaunchNetwork(networkId: 'mainnet' | 'sepolia'): LaunchNetworkConfig {
  return LAUNCH_NETWORKS[networkId] ?? LAUNCH_NETWORKS.mainnet;
}

/** True when a token entry has real on-chain addresses to read from. */
export function isTokenLive(entry: LaunchTokenEntry): boolean {
  return Boolean(entry.curve && entry.token && entry.executor);
}