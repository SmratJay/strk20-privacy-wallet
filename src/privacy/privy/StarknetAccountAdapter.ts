import { Account, RpcProvider, type CairoVersion } from "starknet";
import type { PrivySigningClient } from "./types";
import { StarknetPrivySigner } from "./StarknetPrivySigner";

export interface StarknetAccountAdapterOptions {
  address: string;
  walletId: string;
  publicKey: string;
  client: PrivySigningClient;
  provider: RpcProvider;
  cairoVersion?: CairoVersion;
}

/**
 * Builds a full starknet.js `Account` backed by a Privy signer, so the existing
 * `Account.execute(...)` submission path (and the STRK20 SDK's minimal
 * `{ address, signer }` identity) both work unchanged.
 */
export class StarknetAccountAdapter {
  static create(options: StarknetAccountAdapterOptions): Account {
    const signer = new StarknetPrivySigner({
      walletId: options.walletId,
      publicKey: options.publicKey,
      client: options.client,
    });
    return new Account({
      provider: options.provider,
      address: options.address,
      signer,
      cairoVersion: options.cairoVersion ?? "1",
    });
  }
}
