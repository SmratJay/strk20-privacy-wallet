/**
 * @file src/config/launch.ts
 * @description ORRANGE LAUNCHPAD V2 configuration — Starknet Sepolia only.
 *
 * V2 removes the V1 demo registry and mainnet config: the app reads only the live on-chain
 * TokenFactory V2. There is no seeded/mocked market. Contract addresses are injected via env
 * so a real deployment can be wired without code changes.
 *
 * Curve V2 economics (locked via scripts/launch_sim.mjs):
 *   - supply 1,000,000,000 tokens (18 dp)
 *   - virtual base 30 STRK, virtual token reserve = supply
 *   - graduation at 120 STRK of real base reserve (auto-graduates on the crossing trade)
 *   - total fee 1%: creator 0.25% + protocol 0.25% + 0.5% retained as liquidity
 *   - max single buy = 10% of the virtual token reserve (anti-whale)
 */

export interface LaunchCurveParams {
  /** Virtual base reserve (smallest unit). */
  virtualBase: string;
  /** Virtual token reserve (smallest unit). */
  virtualToken: string;
  /** Real base accumulated to graduate (smallest unit). */
  graduationTarget: string;
  /** Total fee basis points (1% = 100). */
  feeBps: string;
  /** Creator share of the fee, in bps of the base amount. */
  creatorFeeBps: string;
  /** Protocol share of the fee, in bps of the base amount. */
  protocolFeeBps: string;
  /** Max single buy as a fraction (bps) of the virtual token reserve. */
  maxTradeBps: string;
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
  /** BondingCurve V2 address. */
  curve: string;
  /** PrivateCurveExecutor V2 address. */
  executor: string;
  /** Total supply (smallest unit). */
  totalSupply: string;
  params: LaunchCurveParams;
  /** Optional factory-issued metadata URI. */
  metadataUri?: string;
  creator?: string;
}

export interface LaunchNetworkConfig {
  chainId: 'SN_SEPOLIA';
  /** STRK20 privacy pool address for the network. */
  poolAddress: string;
  /** Base asset for memecoins (STRK). */
  baseAsset: string;
  baseAssetDecimals: number;
  /** TokenFactory V2 address (empty until deployed). */
  factory: string;
  /** GraduationRouter V2 address (empty until deployed). */
  router: string;
  /**
   * Block to start BondingCurve Buy/Sell event scans from for cumulative volume, price
   * history and the trades feed. Set to a block before the V2 TokenFactory deployment so
   * every factory-launched curve's full trade history is covered. 0 disables event reads.
   */
  eventScanStartBlock: number;
}

export const STRK_SEPOLIA =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

export const SEPOLIA_UMBRA_POOL =
  '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91';

/** V2 curve parameters (locked via scripts/launch_sim.mjs — see header). */
export const DEFAULT_PARAMS: LaunchCurveParams = {
  virtualBase: '30000000000000000000', // 30 STRK
  virtualToken: '1000000000000000000000000000', // 1,000,000,000 tokens (18 dp)
  graduationTarget: '120000000000000000000', // 120 STRK
  feeBps: '100', // 1% total
  creatorFeeBps: '25', // 0.25% -> creator
  protocolFeeBps: '25', // 0.25% -> protocol treasury
  maxTradeBps: '1000', // 10% of virtual token reserve per buy
};

export const DEFAULT_TOTAL_SUPPLY = '1000000000000000000000000000';

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
  creatorFeeBps: DEFAULT_PARAMS.creatorFeeBps,
  protocolFeeBps: DEFAULT_PARAMS.protocolFeeBps,
  maxTradeBps: DEFAULT_PARAMS.maxTradeBps,
};

/** Addresses are read from env so a real deployment can be wired without code changes. */
function envFactorySepolia(): { factory: string; router: string } {
  return {
    factory: process.env.NEXT_PUBLIC_UMBRA_SEPOLIA_FACTORY || '',
    router: process.env.NEXT_PUBLIC_UMBRA_ROUTER || '',
  };
}

const SEPOLIA_CONFIG: LaunchNetworkConfig = {
  chainId: 'SN_SEPOLIA',
  poolAddress: SEPOLIA_UMBRA_POOL,
  baseAsset: STRK_SEPOLIA,
  baseAssetDecimals: 18,
  factory: envFactorySepolia().factory,
  router: envFactorySepolia().router,
  // Set just before the V2 TokenFactory deployment on Sepolia (factory block 14275969) so
  // every factory-launched curve's Buy/Sell events are scanned for volume/price/trades.
  eventScanStartBlock: 14275950,
};

/**
 * Launch is Sepolia-only in V2. A mainnet lookup returns the same Sepolia config (pages
 * gate on the wallet network anyway); there is no mainnet launch market.
 */
export const LAUNCH_NETWORKS: Record<'mainnet' | 'sepolia', LaunchNetworkConfig> = {
  sepolia: SEPOLIA_CONFIG,
  mainnet: { ...SEPOLIA_CONFIG, factory: '', router: '' },
};

export function getLaunchNetwork(networkId: 'mainnet' | 'sepolia'): LaunchNetworkConfig {
  return LAUNCH_NETWORKS[networkId] ?? LAUNCH_NETWORKS.sepolia;
}

/** True when a token entry has real on-chain addresses to read from. */
export function isTokenLive(entry: LaunchTokenEntry): boolean {
  return Boolean(entry.curve && entry.token && entry.executor);
}