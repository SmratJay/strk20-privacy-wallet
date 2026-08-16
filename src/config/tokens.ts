import { NETWORKS, DEFAULT_NETWORK_ID } from './networks';

export * from './networks';

export const MAINNET_DEFAULT_NETWORK = NETWORKS[DEFAULT_NETWORK_ID];

export const STRK20_POOL_ADDRESS = MAINNET_DEFAULT_NETWORK.poolAddress;
export const CHAIN_ID = MAINNET_DEFAULT_NETWORK.chainId;
export const ALCHEMY_RPC_URL = MAINNET_DEFAULT_NETWORK.rpcUrls[0];
