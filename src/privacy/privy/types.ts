export interface PrivyWalletRecord {
  id: string;
  address: string;
  public_key?: string;
  publicKey?: string;
  chain_type?: string;
  owner?: string;
  user_id?: string;
}

export interface PrivySigningClient {
  signHash(walletId: string, hashHex: string): Promise<unknown>;
}

export interface PrivySignerConfig {
  walletId: string;
  publicKey: string;
  client: PrivySigningClient;
}
