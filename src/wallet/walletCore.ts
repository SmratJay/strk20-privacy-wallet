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
  READY_ACCOUNT_CONFIG,
  ReadyAccountAdapter,
  isReadyAccountSupported,
  waitForDeploymentFinality,
  type AccountAdapter,
  type AccountDeploymentProbe,
} from "./account";
import type { WalletNetworkId } from "./types";

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

export type { WalletNetworkId } from "./types";
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

export interface DeployAccountOptions {
  /** Finality-wait tuning (primarily for tests; production uses the module defaults). */
  finalityPollMs?: number;
  finalityTimeoutMs?: number;
}

function makeProvider(network: WalletNetworkId): RpcProvider {
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

function makeAdapter(network: WalletNetworkId, publicKey: string, factory?: (pk: string) => AccountAdapter): AccountAdapter {
  if (factory) return factory(publicKey);
  // Network-aware account configuration: never derive an account using a network-agnostic
  // default class hash. Unsupported networks fail closed.
  const config = READY_ACCOUNT_CONFIG[network];
  if (!config?.supported) {
    throw new Error(
      `Account contract is not available on ${network}. Only networks with a verified Ready account configuration are supported.`,
    );
  }
  return new ReadyAccountAdapter(publicKey, config.classHash);
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
  // Fail fast on unsupported networks before spending PBKDF2 work on decrypt.
  if (!options.adapterFactory && !isReadyAccountSupported(options.network)) {
    throw new Error(
      `Account contract is not available on ${options.network}. Only networks with a verified Ready account configuration are supported.`,
    );
  }
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
 * finality. Tracks deployment state in the public store. Idempotent and safe:
 *  - "deployed"     → returns early.
 *  - "unknown"      → refuses to deploy (RPC failure or class-hash mismatch must never
 *                     authorize a deployment).
 *  - "not_deployed" → submits DEPLOY_ACCOUNT and waits for on-chain finality.
 */
export async function deployAccount(
  wallet: UnlockedWallet,
  storage?: WalletStorage,
  options?: DeployAccountOptions,
): Promise<DeployAccountResult> {
  const store = storage ?? defaultStorage();
  const finalityOpts =
    options?.finalityPollMs !== undefined || options?.finalityTimeoutMs !== undefined
      ? { pollMs: options.finalityPollMs, timeoutMs: options.finalityTimeoutMs }
      : undefined;
  const probe = await wallet.adapter.probeDeployment(wallet.provider);
  if (probe === "deployed") {
    updateDeploymentStatus(store, wallet.network, "deployed");
    return { transactionHash: "", contractAddress: wallet.address };
  }
  if (probe === "unknown") {
    updateDeploymentStatus(store, wallet.network, "unknown");
    throw new Error(
      "Could not verify on-chain account state; refusing to deploy. Check the RPC and retry.",
    );
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
    await waitForDeploymentFinality(wallet.provider, deployedAtBlock, undefined, finalityOpts);
    updateDeploymentStatus(store, wallet.network, "deployed");
  } catch (err) {
    // Finality was not confirmed. Reconcile with the chain and NEVER claim deployed unless the
    // on-chain probe actually verifies the class hash.
    const recheck = await wallet.adapter.probeDeployment(wallet.provider).catch(
      () => "unknown" as AccountDeploymentProbe,
    );
    if (recheck === "deployed") {
      updateDeploymentStatus(store, wallet.network, "deployed");
    } else {
      updateDeploymentStatus(store, wallet.network, recheck === "not_deployed" ? "finalizing" : "unknown");
    }
    throw err;
  }
  return deployment;
}

/** Reconcile the on-chain deployment status against the store. Never guesses. */
export async function getDeploymentStatus(
  wallet: UnlockedWallet,
  storage?: WalletStorage,
): Promise<WalletDeploymentStatus> {
  const store = storage ?? defaultStorage();
  const probe = await wallet.adapter.probeDeployment(wallet.provider);
  const status: WalletDeploymentStatus =
    probe === "deployed" ? "deployed" : probe === "not_deployed" ? "not_deployed" : "unknown";
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

/**
 * A signer that has been revoked. Every signing path in starknet.js routes through `signRaw`,
 * so overriding it to throw invalidates the whole signing session. `getPubKey` is revoked too
 * so a locked wallet cannot even claim a key.
 */
class LockedSigner extends Signer {
  protected override async signRaw(_msgHash: string): Promise<Signature> {
    throw new Error("Wallet is locked. Unlock it to sign transactions.");
  }

  override async getPubKey(): Promise<string> {
    throw new Error("Wallet is locked.");
  }
}

/**
 * Lock an unlocked wallet: invalidate the active signing session. The in-memory secret is
 * blanked AND both the wallet's signer and the Account's signer are replaced with a revoked
 * signer so no signing operation can succeed until the wallet is unlocked again.
 */
export function lockWallet(wallet: UnlockedWallet): void {
  const locked = new LockedSigner();
  wallet.signer = locked;
  (wallet.account as { signer?: unknown }).signer = locked;
  (wallet as { secret?: string }).secret = "";
}