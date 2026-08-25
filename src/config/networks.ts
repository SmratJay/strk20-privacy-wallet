export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  default?: boolean;
}

export type NetworkId = 'mainnet' | 'sepolia';

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  label: string;
  chainId: string;
  poolAddress: string;
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
    rpcUrls: [
      // STRK20 proof transactions (SNIP-36 proof_facts/proof) require an RPC node on spec
      // 0.10.1+. cartridge.gg reports 0.9.0 and starknet.js throws snip36RequiresRPC010 there,
      // so use a 0.10.2 node first and keep cartridge as a read fallback.
      'https://rpc.starknet.lava.build',
      process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia',
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
