export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  icon: string;
  default?: boolean;
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

export const STRK20_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_STRK20_POOL ||
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a';

export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || 'SN_MAIN';

export const ALCHEMY_RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-mainnet.public.blastapi.io';

export const NOTE_MATURITY_BLOCKS = 10;
export const DEFAULT_POOL_FEE_STRK = '4'; // Flat fee in STRK for private operations
