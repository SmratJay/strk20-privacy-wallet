export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  default?: boolean;
}

/**
 * Strip trailing slashes from an endpoint URL so the STRK20 SDK can safely append path
 * segments (e.g. `${base}/v1/sync/outgoing_state`). The indexer rejects double-slashes
 * (HTTP 404) when the base already ends in `/`, so a clean single-slash base is required.
 * Also normalizes the prover base URL (no path is appended there, but consistency is free).
 */
export function normalizeEndpointUrl(url: string | undefined): string {
  return (url ?? "").replace(/\/+$/, "");
}

export type NetworkId = 'mainnet' | 'sepolia';

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  label: string;
  chainId: string;
  poolAddress: string;
  /**
   * STRK20 shadow-account anonymizer contract (RC5-compatible) for this network. This is PUBLIC
   * contract configuration (never a server secret). Empty string means the anonymizer is not
   * configured for this network → private-identity creation reports explicitly unavailable.
   * Network-scoped so a network can never accidentally use another network's address.
   */
  shadowAccountAnonymizerAddress: string;
  rpcUrls: string[];
  avnuBaseUrl: string;
  explorerUrl: string;
  faucetUrl?: string;
  tokens: TokenInfo[];
}

export const MAINNET_TOKENS: TokenInfo[] = [
  {
    symbol: 'STRK',
    name: 'Starknet Token',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
    icon: '⚡',
    default: true,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
    icon: '🔷',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    decimals: 6,
    icon: '💵',
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
    decimals: 6,
    icon: '🟢',
  },
];

export const SEPOLIA_TOKENS: TokenInfo[] = [
  {
    symbol: 'STRK',
    name: 'Starknet Token (Sepolia)',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
    icon: '⚡',
    default: true,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum (Sepolia)',
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
    icon: '🔷',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Sepolia)',
    address: '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343',
    decimals: 6,
    icon: '💵',
  },
];

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: 'mainnet',
    name: 'Starknet Mainnet',
    label: 'Mainnet',
    chainId: 'SN_MAIN',
    poolAddress:
      process.env.NEXT_PUBLIC_STRK20_POOL ||
      '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    shadowAccountAnonymizerAddress: process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_MAINNET || '',
    rpcUrls: [
      'https://api.cartridge.gg/x/starknet/mainnet',
      process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://free-rpc.nethermind.io/mainnet-juno',
      'https://free-rpc.nethermind.io/mainnet-juno',
    ],
    avnuBaseUrl: 'https://starknet.api.avnu.fi',
    explorerUrl: 'https://voyager.online',
    tokens: MAINNET_TOKENS,
  },
  sepolia: {
    id: 'sepolia',
    name: 'Starknet Sepolia',
    label: 'Sepolia Testnet',
    chainId: 'SN_SEPOLIA',
    poolAddress:
      process.env.NEXT_PUBLIC_STRK20_SEPOLIA_POOL ||
      '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
    shadowAccountAnonymizerAddress: process.env.NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA || '',
    rpcUrls: [
      // Public Sepolia RPCs. The old Alchemy fallback key was removed because it no longer
      // serves. rpcUrls[0] must support RPC spec >= 0.10.1 (STRK20 SNIP-36 proof transactions
      // throw snip36RequiresRPC010 below it); PublicNode and dRPC both report 0.10.2.
      // `NEXT_PUBLIC_STARKNET_RPC_URL` still overrides for deployments that run their own node.
      process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://starknet-sepolia-rpc.publicnode.com',
      'https://starknet-sepolia.drpc.org',
      // cartridge reports spec 0.9.0 — fine for public-balance reads, never for proof submission.
      'https://api.cartridge.gg/x/starknet/sepolia',
    ],
    avnuBaseUrl: 'https://starknet.api.avnu.fi',
    explorerUrl: 'https://sepolia.voyager.online',
    faucetUrl: 'https://starknet-faucet.vercel.app',
    tokens: SEPOLIA_TOKENS,
  },
};

export const DEFAULT_NETWORK_ID: NetworkId = 'mainnet';
export const NOTE_MATURITY_BLOCKS = 10;
export const ESTIMATED_POOL_FEE_STRK = '4';

export function normalizeNetworkId(networkId?: string): 'SN_SEPOLIA' | 'SN_MAIN' {
  if (!networkId) return 'SN_SEPOLIA';
  const lower = networkId.toLowerCase();
  if (lower.includes('main')) return 'SN_MAIN';
  return 'SN_SEPOLIA';
}

export function getNetworkConfig(networkId: string = DEFAULT_NETWORK_ID): NetworkConfig {
  const norm = normalizeNetworkId(networkId);
  const key = norm === 'SN_MAIN' ? 'mainnet' : 'sepolia';
  return NETWORKS[key] || NETWORKS.sepolia;
}
