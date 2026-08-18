import { NETWORKS, DEFAULT_NETWORK_ID, getNetworkConfig } from './networks';

export * from './networks';

export const MAINNET_DEFAULT_NETWORK = NETWORKS[DEFAULT_NETWORK_ID];

// Dynamic helper accessors (Whitepaper Section 2.1 & 17.1)
export function getActivePoolAddress(networkId: string = DEFAULT_NETWORK_ID): string {
  return getNetworkConfig(networkId).poolAddress;
}

export function getActiveRpcUrl(networkId: string = DEFAULT_NETWORK_ID): string {
  return getNetworkConfig(networkId).rpcUrls[0];
}

export function getActiveChainId(networkId: string = DEFAULT_NETWORK_ID): string {
  return getNetworkConfig(networkId).chainId;
}

// Backward-compatible fallback references
export const STRK20_POOL_ADDRESS = MAINNET_DEFAULT_NETWORK.poolAddress;
export const CHAIN_ID = MAINNET_DEFAULT_NETWORK.chainId;
export const ALCHEMY_RPC_URL = MAINNET_DEFAULT_NETWORK.rpcUrls[0];

