import { Account, RpcProvider, Signer } from "starknet";
import type { Call, InvocationsSignerDetails, Signature } from "starknet";
import { getNetworkConfig } from "@/config/networks";
import {
  canonicalizeSecret,
  generateSecretKey,
  getPublicKey,
} from "./crypto";
import {
  decryptSecret,
  deserializeKeystore,
  encryptSecret,
  serializeKeystore,
  type EncryptedKeystore,
} from "./keystore";
import {
  clearWallet as clearStorage,
  defaultStorage,
  readKeystore,
  updateDeploymentStatus,
  writeKeystore,
  writePublicState,
  type PublicWalletState,
  type WalletStorage,
} from "./storage";
import {
  ReadyAccountAdapter,
  waitForDeploymentFinality,
  type AccountAdapter,
} from "./account";

/**
 * Wallet Core — the self-custodial Starknet wallet facade.
 *
 * Owns the full wallet lifecycle: key generation, encrypted storage, account derivation,
 * deployment, signing, transaction submission, and recovery/export. The signing secret is held
 * ONLY in memory on an `UnlockedWallet` and is derived again from the encrypted keystore on
 * every unlock. No server, no Privy, no external wallet, no Wallet API — a local signer and the
 * starknet.js Account built on it do all signing.
 *
 * STRK20 privacy is intentionally absent here: Wallet Core knows nothing about viewing keys or
 * notes. The STRK20 layer consumes `UnlockedWallet.account` / `.signer` as a plain signing
 * interface.
 */

export type WalletNetworkId = "mainnet" | "sepolia";
export type WalletDeploymentStatus = PublicWalletState["deploymentStatus"];

export interface UnlockedWallet {
  network: WalletNetworkId;
  accountType: string;
  publicKey: string;
  address: string;
  keystore: EncryptedKeystore;
  /** In-memory signing secret. NEVER persisted, NEVER logged, NEVER sent anywhere. */
  secret: string;
  signer: Signer;
  account: Account;
  adapter: AccountAdapter;
  provider: RpcProvider;
}

export interface CreateWalletOptions {
  network: WalletNetworkId;
  password: string;
  storage?: WalletStorage;
  provider?: RpcProvider;
  adapterFactory?: (publicKey: string) => AccountAdapter;
}

export interface UnlockWalletOptions {
  network: WalletNetworkId;
  password: string;
  storage?: WalletStorage;
  provider?: RpcProvider;
  adapterFactory?: (publicKey: string) => AccountAdapter;
}

export interface DeployAccountResult {
  transactionHash: string;
  contractAddress: string;
}

function makeProvider(network: WalletNetworkId): RpcProvider {
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

function makeAdapter(network: WalletNetworkId, publicKey: string, factory?: (pk: string) => AccountAdapter): AccountAdapter {
  if (factory) return factory(publicKey);
  return new ReadyAccountAdapter(publicKey);
}

function buildUnlocked(
  network: WalletNetworkId,
  publicKey: string,
  secret: string,
  keystore: EncryptedKeystore,
  adapter: AccountAdapter,
  provider: RpcProvider,
): UnlockedWallet {
  const signer = new Signer(secret);
  const account = new Account({
    provider,
    address: adapter.address,
    signer,
    cairoVersion: "1",
  });
  return {
    network,
    accountType: adapter.type,
    publicKey,
    address: adapter.address,
    keystore,
    secret,
    signer,
    account,
    adapter,
    provider,
  };
}

function persist(storage: WalletStorage, network: WalletNetworkId, wallet: UnlockedWallet): void {
  writePublicState(storage, network, {
    accountType: wallet.accountType,
    address: wallet.address,
    publicKey: wallet.publicKey,
    network,
    deploymentStatus: "unknown",
    createdAt: wallet.keystore.createdAt,
  });
  writeKeystore(storage, network, serializeKeystore(wallet.keystore));
}

/**
 * Create a new wallet: generate a local key, derive the counterfactual account address,
 * encrypt the keystore with the password, and persist keystore + public state. Returns an
 * UNLOCKED wallet session (secret only in memory). Does NOT deploy — call `deployAccount`.
 */
export async function createWallet(options: CreateWalletOptions): Promise<UnlockedWallet> {
  const storage = options.storage ?? defaultStorage();
  const secret = canonicalizeSecret(generateSecretKey());
  const publicKey = getPublicKey(secret);
  const adapter = makeAdapter(options.network, publicKey, options.adapterFactory);
  const provider = options.provider ?? makeProvider(options.network);

  const keystore = await encryptSecret(secret, options.password, {
    publicKey,
    address: adapter.address,
    network: options.network,
    accountType: adapter.type,
  });

  const wallet = buildUnlocked(options.network, publicKey, secret, keystore, adapter, provider);
  persist(storage, options.network, wallet);
  return wallet;
}

/**
 * Load / unlock an existing wallet from the encrypted keystore. Reconstructs the signer and
 * account from the decrypted secret and verifies the address/public-key relationship. Throws
 * on a wrong password or a tampered keystore.
 */
export async function unlockWallet(options: UnlockWalletOptions): Promise<UnlockedWallet> {
  const storage = options.storage ?? defaultStorage();
  const raw = readKeystore(storage, options.network);
  if (!raw) {
    throw new Error(`No wallet exists on ${options.network}. Create one first.`);
  }
  const keystore = deserializeKeystore(raw);
  const secret = await decryptSecret(keystore, options.password);
  const publicKey = getPublicKey(secret);
  if (publicKey.toLowerCase() !== keystore.publicKey.toLowerCase()) {
    throw new Error("Wallet unlock failed: public key mismatch.");
  }
  const adapter = makeAdapter(options.network, publicKey, options.adapterFactory);
  if (adapter.address.toLowerCase() !== keystore.address.toLowerCase()) {
    throw new Error("Wallet unlock failed: account address mismatch.");
  }
  const provider = options.provider ?? makeProvider(options.network);
  return buildUnlocked(options.network, publicKey, secret, keystore, adapter, provider);
}

/**
 * Deploy the wallet's account contract (DEPLOY_ACCOUNT) with the LOCAL signer, then wait for
 * finality. Tracks deployment state in the public store. Idempotent: returns early when the
 * account is already deployed on-chain.
 */
export async function deployAccount(
  wallet: UnlockedWallet,
  storage?: WalletStorage,
): Promise<DeployAccountResult> {
  const store = storage ?? defaultStorage();
  if (await wallet.adapter.isDeployed(wallet.provider)) {
    updateDeploymentStatus(store, wallet.network, "deployed");
    return { transactionHash: "", contractAddress: wallet.address };
  }
  updateDeploymentStatus(store, wallet.network, "pending");
  const deployment = await wallet.adapter.deploy(wallet.account);
  const receipt = await wallet.provider.waitForTransaction(deployment.transactionHash, {
    retryInterval: 4000,
  });
  const exec =
    (receipt as { execution_status?: unknown })?.execution_status ??
    (receipt as { status?: unknown })?.status;
  if (exec === "REVERTED" || exec === "REJECTED") {
    updateDeploymentStatus(store, wallet.network, "error");
    throw new Error("Account deployment reverted on-chain.");
  }
  const deployedAtBlock = Number((receipt as { block_number?: unknown })?.block_number ?? 0);
  updateDeploymentStatus(store, wallet.network, "finalizing");
  try {
    await waitForDeploymentFinality(wallet.provider, deployedAtBlock);
    updateDeploymentStatus(store, wallet.network, "deployed");
  } catch (err) {
    updateDeploymentStatus(store, wallet.network, "deployed");
    throw err;
  }
  return deployment;
}

/** Reconcile the on-chain deployment status (class hash present) against the store. */
export async function getDeploymentStatus(
  wallet: UnlockedWallet,
  storage?: WalletStorage,
): Promise<WalletDeploymentStatus> {
  const store = storage ?? defaultStorage();
  const deployed = await wallet.adapter.isDeployed(wallet.provider);
  const status: WalletDeploymentStatus = deployed ? "deployed" : "not_deployed";
  updateDeploymentStatus(store, wallet.network, status);
  return status;
}

/**
 * Sign a transaction locally through the wallet's own key. No server, no Privy. The caller
 * supplies starknet.js `InvocationsSignerDetails`; the signer computes the tx hash and signs it.
 */
export async function signTransaction(
  wallet: UnlockedWallet,
  calls: Call[],
  details: InvocationsSignerDetails,
): Promise<Signature> {
  return wallet.signer.signTransaction(calls, details);
}

/**
 * Create, sign, and submit a Starknet transaction via the wallet's account (local signer).
 * Returns the transaction hash. Requires a deployed + funded account and a reachable RPC.
 */
export async function sendTransaction(
  wallet: UnlockedWallet,
  call: Call | Call[],
): Promise<{ transactionHash: string }> {
  const calls = Array.isArray(call) ? call : [call];
  const response = await wallet.account.execute(calls);
  return { transactionHash: response.transaction_hash };
}

/**
 * Export / recovery: reveal the signing secret. Guards the request with the password (decrypts
 * the keystore again), so this only works for someone who knows the password. The caller owns
 * the display/storage decision; the core never logs it.
 */
export async function exportSecret(wallet: UnlockedWallet, password: string): Promise<string> {
  const decrypted = await decryptSecret(wallet.keystore, password);
  return decrypted;
}

/** Remove the keystore + public state for a network. Returns true when something was removed. */
export function clearWallet(network: WalletNetworkId, storage?: WalletStorage): boolean {
  const store = storage ?? defaultStorage();
  const hadKeystore = readKeystore(store, network) !== null;
  clearStorage(store, network);
  return hadKeystore;
}

/** Best-effort in-memory wipe of the signing secret on a locked wallet object. */
export function lockWallet(wallet: UnlockedWallet): void {
  // The secret lives in a mutable field; blank it. Other fields are public/safe.
  (wallet as { secret?: string }).secret = "";
}