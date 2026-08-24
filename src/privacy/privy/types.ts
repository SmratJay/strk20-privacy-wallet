export interface PrivyWalletRecord {
  id: string;
  address: string;
  public_key?: string;
  publicKey?: string;
  chain_type?: string;
  owner?: string;
  user_id?: string;
}

export interface PrivyRawSignResult {
  signature: unknown;
}

export interface PrivyServerClient {
  verifyAuthToken(token: string): Promise<{ userId: string }>;
  wallets(): {
    create(input: { chain_type: "starknet"; user_id?: string }): Promise<PrivyWalletRecord>;
    get(id: string): Promise<PrivyWalletRecord>;
    rawSign(
      walletId: string,
      input: { params: { hash: string } },
    ): Promise<PrivyRawSignResult>;
  };
}

export interface PrivySigningClient {
  signHash(walletId: string, hashHex: string): Promise<unknown>;
}

export interface PrivySignerConfig {
  walletId: string;
  publicKey: string;
  client: PrivySigningClient;
}
