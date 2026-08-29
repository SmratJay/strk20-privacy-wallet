/**
 * @file src/extended/chain.ts
 * @description Starknet network helpers for the Extended perps terminal. Pure module
 * (no JSX) so it can be unit-tested and shared by the browser wallet provider.
 */

import { constants } from 'starknet';

/** Starknet Mainnet chain id (hex). Any other chain is treated as "wrong network". */
export const MAINNET_CHAIN_ID = constants.StarknetChainId.SN_MAIN;

/** True when the given chain id is Starknet Mainnet (hex comparison, case-insensitive). */
export function isMainnetChain(chainId: string | null | undefined): boolean {
  if (!chainId) return false;
  return String(chainId).toLowerCase() === String(MAINNET_CHAIN_ID).toLowerCase();
}