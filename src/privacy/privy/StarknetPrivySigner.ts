import { Signer, type Signature } from "starknet";
import type { PrivySignerConfig } from "./types";
import { normalizePrivySignature, normalizeStarkPublicKey } from "./signing";

/**
 * starknet.js Signer backed by a Privy Starknet embedded wallet.
 *
 * Privy holds the wallet key server-side, so the only primitive we delegate is
 * `signRaw(hash)`: every other method (transaction-hash computation) is inherited from
 * the standard `Signer` and is deterministic/key-free. This makes the signer a drop-in
 * for the STRK20 SDK, which consumes exactly `signer.signTransaction(...)`.
 */
export class StarknetPrivySigner extends Signer {
  private readonly walletId: string;
  private readonly publicKey: string;
  private readonly client: PrivySignerConfig["client"];

  constructor(config: PrivySignerConfig) {
    super(config.publicKey);
    this.walletId = config.walletId;
    this.publicKey = normalizeStarkPublicKey(config.publicKey);
    this.client = config.client;
  }

  override async getPubKey(): Promise<string> {
    return this.publicKey;
  }

  protected override async signRaw(msgHash: string): Promise<Signature> {
    const raw = await this.client.signHash(this.walletId, msgHash);
    return normalizePrivySignature(raw);
  }
}
