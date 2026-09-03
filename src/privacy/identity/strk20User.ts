import type { AccountInterface } from "starknet";
import type { UnlockedWallet } from "@/wallet";

/**
 * Privacy Core — STRK20 user bridge.
 *
 * The STRK20 privacy layer consumes the Wallet Core's generic account/signer. An imported
 * (or created) `UnlockedWallet` exposes a starknet.js `Account` with a LOCAL signer — exactly
 * what the existing STRK20 adapter needs. This is the path:
 *
 *   Imported Wallet → Wallet Core account/signer → STRK20 adapter
 *
 * never:
 *
 *   (no Privy / embedded-wallet lane exists)
 *
 * The viewing key is supplied by the STRK20 privacy layer at call time; it is never stored here.
 */

export interface Strk20WalletUser {
  account: AccountInterface;
  address: string;
  viewingKey: bigint;
}

export function buildStrk20User(wallet: UnlockedWallet, viewingKey: bigint): Strk20WalletUser {
  return {
    account: wallet.account,
    address: wallet.address,
    viewingKey,
  };
}