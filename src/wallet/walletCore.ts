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
  migrateLegacyWallet,
  readKeystore,
  readPublicState,
  readWalletKeystore,
  readWalletRegistry,
  updateDeploymentStatus,
  upsertWalletRegistryEntry,
  walletIdFor,
  writeKeystore,
  writePublicState,
  writeWalletKeystore,
  type PublicWalletState,
  type WalletRegistryEntry,
  type WalletStorage,
} from "./storage";
import {
  READY_ACCOUNT_CONFIG,
  ReadyAccountAdapter,
  isReadyAccountSupported,
  BraavosAccountAdapter,
  isBraavosAccountSupported,
  waitForDeploymentFinality,
  type AccountAdapter,
  type AccountDeploymentProbe,
  type OwnershipVerification,
} from "./account";
import type { WalletNetworkId } from "./types";

/**
 * Wallet Core — the self-custodial Starknet wallet facade.
 *
 * Owns the full wallet lifecycle: key generation, encrypted storage, account derivation,
 * deployment, signing, transaction submission, import of existing accounts, and recovery/export.
 * The signing secret is held ONLY in memory on an `UnlockedWallet` and is derived again from the
 * encrypted keystore on every unlock. No server, no Privy, no external wallet, no Wallet API — a
 * local signer and the starknet.js Account built on it do all signing.
 *
 * STRK20 privacy is intentionally absent here: Wallet Core knows nothing about viewing keys or
 * notes. The STRK20 layer consumes `UnlockedWallet.account` / `.signer` as a plain signing
 * interface.
 */

export type { WalletNetworkId } from "./types";
export type WalletDeploymentStatus = PublicWalletState["deploymentStatus"];

export type WalletAccountType = "ready-v0.4.0" | "braavos-v1.2.0";

export interface UnlockedWallet {
  network: WalletNetworkId;
  accountType: string;
  publicKey: string;
  address: string;
  /** Wallet identity (canonical account address) used for storage scoping. */
  walletId: string;
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
  adapterFactory?: (publicKey: string, address?: string) => AccountAdapter;
  /** Load a specific wallet from the registry; defaults to the legacy Stage 1 primary wallet. */
  walletId?: string;
}

export interface DeployAccountResult {
  transactionHash: string;
  contractAddress: string;
  /**
   * The block the account was deployed in, when this call performed the deployment. `undefined`
   * when the account was already deployed (early return) — the deploy block is then unknown.
   */
  deployedAtBlock?: number;
}

export interface DeployAccountOptions {
  /** Finality-wait tuning (primarily for tests; production uses the module defaults). */
  finalityPollMs?: number;
  finalityTimeoutMs?: number;
  /** UX callback fired at each deployment lifecycle stage. */
  onStatus?: (status: "pending" | "finalizing" | "deployed" | "error") => void;
}

function makeProvider(network: WalletNetworkId): RpcProvider {
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

function normalizeAddr(value: string): string {
  return "0x" + BigInt(value).toString(16);
}

/** True when an account type is verified for a network. */
export function isAccountTypeSupported(accountType: string, network: WalletNetworkId): boolean {
  if (accountType === "ready-v0.4.0") return isReadyAccountSupported(network);
  if (accountType === "braavos-v1.2.0") return isBraavosAccountSupported(network);
  return false;
}

/**
 * Build the account adapter for a stored/selected account type. Network-aware: never derives an
 * account using a network-agnostic default class hash. Unsupported networks/types fail closed.
 * `address` is required for non-derivable account types (Braavos).
 */
function makeAdapterForType(
  accountType: string,
  network: WalletNetworkId,
  publicKey: string,
  address?: string,
  factory?: (publicKey: string, address?: string) => AccountAdapter,
): AccountAdapter {
  if (factory) return factory(publicKey, address);
  if (accountType === "ready-v0.4.0") {
    const config = READY_ACCOUNT_CONFIG[network];
    if (!config?.supported) {
      throw new Error(`Ready accounts are not verified on ${network}.`);
    }
    return new ReadyAccountAdapter(publicKey, config.classHash);
  }
  if (accountType === "braavos-v1.2.0") {
    if (!isBraavosAccountSupported(network)) {
      throw new Error(`Braavos accounts are not verified on ${network}.`);
    }
    if (!address) {
      throw new Error("Braavos import requires the existing account address.");
    }
    return new BraavosAccountAdapter({ publicKey, address, network });
  }
  throw new Error(`Unsupported account type: ${accountType}.`);
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
    walletId: walletIdFor(adapter.address),
    keystore,
    secret,
    signer,
    account,
    adapter,
    provider,
  };
}

/**
 * Persist a wallet into the AUTHORITATIVE Stage 2 store: the network-scoped v2 registry plus the
 * network-scoped walletId keystore.
 *
 * The legacy Stage 1 keys (`orrange_wallet_public_<network>` / `orrange_wallet_keystore_<network>`)
 * are COMPATIBILITY-ONLY. They are written here ONLY as a deterministic bootstrap when no legacy
 * primary exists yet — so the FIRST wallet keeps the legacy `unlockWallet({ network, password })`
 * path working. Ordinary create/import of additional wallets NEVER rotates the legacy primary.
 * After this bootstrap, only `migrateLegacyWallet()`/`clearWalletById()` touch the legacy keys.
 */
function persist(storage: WalletStorage, network: WalletNetworkId, wallet: UnlockedWallet, source: "created" | "imported"): void {
  // Stage 2 authoritative store.
  writeWalletKeystore(storage, wallet.network, wallet.walletId, serializeKeystore(wallet.keystore));
  const entry: WalletRegistryEntry = {
    walletId: wallet.walletId,
    accountType: wallet.accountType,
    address: wallet.address,
    publicKey: wallet.publicKey,
    network,
    deploymentStatus: "unknown",
    createdAt: wallet.keystore.createdAt,
    source,
  };
  upsertWalletRegistryEntry(storage, network, entry);

  // Legacy compatibility bootstrap (once): only if no legacy primary exists yet.
  const hasLegacyPrimary = readPublicState(storage, network) !== null || readKeystore(storage, network) !== null;
  if (!hasLegacyPrimary) {
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
}

/**
 * Create a new wallet: generate a local key, derive the counterfactual account address,
 * encrypt the keystore with the password, and persist keystore + public state + registry.
 * Returns an UNLOCKED wallet session (secret only in memory). Does NOT deploy — call `deployAccount`.
 */
export async function createWallet(options: CreateWalletOptions): Promise<UnlockedWallet> {
  const storage = options.storage ?? defaultStorage();
  const secret = canonicalizeSecret(generateSecretKey());
  const publicKey = getPublicKey(secret);
  const adapter = makeAdapterForType("ready-v0.4.0", options.network, publicKey, undefined, options.adapterFactory);
  const provider = options.provider ?? makeProvider(options.network);

  const keystore = await encryptSecret(secret, options.password, {
    publicKey,
    address: adapter.address,
    network: options.network,
    accountType: adapter.type,
  });

  const wallet = buildUnlocked(options.network, publicKey, secret, keystore, adapter, provider);
  persist(storage, options.network, wallet, "created");
  return wallet;
}

/**
 * Load / unlock an existing wallet from the encrypted keystore. Reconstructs the signer and
 * account from the decrypted secret and verifies the address/public-key relationship. Throws
 * on a wrong password or a tampered keystore.
 *
 * AUTHORITY: passing `walletId` loads the EXACT requested wallet from the authoritative v2
 * registry keystore (`orrange_wallet_v2_keystore_<network>_<walletId>`). Omitting `walletId`
 * falls back to the legacy Stage 1 primary key — this is a COMPATIBILITY-ONLY path for existing
 * callers; new application code must always pass `walletId`.
 */
export async function unlockWallet(options: UnlockWalletOptions): Promise<UnlockedWallet> {
  const storage = options.storage ?? defaultStorage();
  const raw = options.walletId
    ? readWalletKeystore(storage, options.network, options.walletId)
    : readKeystore(storage, options.network);
  if (!raw) {
    throw new Error(
      options.walletId
        ? `No wallet exists for identity ${options.walletId} on ${options.network}.`
        : `No wallet exists on ${options.network}. Create or import one first.`,
    );
  }
  const keystore = deserializeKeystore(raw);
  if (keystore.network !== options.network) {
    throw new Error("Wallet unlock failed: keystore network does not match the selected network.");
  }
  // Fail fast on unsupported account types/networks before spending PBKDF2 work on decrypt.
  if (!options.adapterFactory && !isAccountTypeSupported(keystore.accountType, options.network)) {
    throw new Error(
      `Account type ${keystore.accountType} is not verified on ${options.network}.`,
    );
  }
  const secret = await decryptSecret(keystore, options.password);
  const publicKey = getPublicKey(secret);
  if (publicKey.toLowerCase() !== keystore.publicKey.toLowerCase()) {
    throw new Error("Wallet unlock failed: public key mismatch.");
  }
  const adapter = makeAdapterForType(keystore.accountType, options.network, publicKey, keystore.address, options.adapterFactory);
  if (adapter.address.toLowerCase() !== keystore.address.toLowerCase()) {
    throw new Error("Wallet unlock failed: account address mismatch.");
  }
  const provider = options.provider ?? makeProvider(options.network);
  return buildUnlocked(options.network, publicKey, secret, keystore, adapter, provider);
}

/**
 * List wallets on a network. Migrates any legacy Stage 1 wallet into the registry on first use.
 */
export function listWallets(options: { network: WalletNetworkId; storage?: WalletStorage }): WalletRegistryEntry[] {
  const storage = options.storage ?? defaultStorage();
  migrateLegacyWallet(storage, options.network);
  return readWalletRegistry(storage, options.network);
}

export interface ImportWalletOptions {
  network: WalletNetworkId;
  accountType: WalletAccountType;
  /** Raw signing secret of the existing account. NEVER persisted, NEVER sent anywhere. */
  secret: string;
  password: string;
  /**
   * Existing account address. REQUIRED for Braavos (not derivable from a key). For Ready it is
   * optional and, when provided, verified against the counterfactually derived address.
   */
  address?: string;
  storage?: WalletStorage;
  /**
   * TEST SEAM ONLY. Injects a deterministic account adapter so tests can exercise the full import
   * pipeline without network access. It NEVER disables ownership verification — `importWallet()`
   * always calls `adapter.verifyOwnership(...)` regardless of which adapter is supplied.
   */
  adapterFactory?: (publicKey: string, address?: string) => AccountAdapter;
  /**
   * TEST SEAM ONLY. Injects a provider for deterministic on-chain probing in tests. It does NOT
   * weaken or bypass ownership verification.
   */
  provider?: RpcProvider;
}

export interface ImportResult {
  wallet: UnlockedWallet;
  /** "existing" when the account is already deployed; "new-counterfactual" for an undeployed Ready account. */
  accountKind: "existing" | "new-counterfactual";
  /** Result of ownership verification. ALWAYS present — import cannot bypass verification. */
  ownership: OwnershipVerification;
}

/**
 * Import an existing Starknet wallet (Ready / Braavos) without changing its address.
 *
 * Ownership verification is MANDATORY and cannot be disabled: there is no production path that
 * imports a wallet without proving the key controls the account.
 *
 * Security properties:
 *  - the raw imported secret is validated and canonicalized locally, encrypted into the Wallet
 *    Core keystore, and NEVER persisted in plaintext, sent to a server, or logged;
 *  - the user-entered address and wallet type are NEVER trusted: the account is verified via
 *    (a) expected-address derivation (Ready), (b) on-chain deployment probe, and (c) on-chain
 *    ownership verification (SRC-5 / Braavos get_public_key);
 *  - mismatches REJECT the import — never silently "repair" it;
 *  - Braavos accounts are only importable when already deployed (no deployment, no derivation).
 */
export async function importWallet(options: ImportWalletOptions): Promise<ImportResult> {
  const storage = options.storage ?? defaultStorage();
  const secret = canonicalizeSecret(options.secret);
  const publicKey = getPublicKey(secret);
  const adapter = makeAdapterForType(options.accountType, options.network, publicKey, options.address, options.adapterFactory);
  const provider = options.provider ?? makeProvider(options.network);

  // Never trust a user-entered address: for derivable accounts (Ready) a provided address must
  // match the counterfactually derived address. For non-derivable accounts (Braavos) the address
  // is the adapter's address by construction.
  if (options.address && adapter.addressDerivable) {
    if (normalizeAddr(options.address) !== normalizeAddr(adapter.address)) {
      throw new Error(
        "Provided address does not match the account derived from this key. Import rejected.",
      );
    }
  }

  // Preserve the existing address — never create a new account.
  const probe = await adapter.probeDeployment(provider);
  if (probe === "unknown") {
    throw new Error(
      "Could not verify on-chain account state; refusing to import. Check the RPC and retry.",
    );
  }
  const accountKind: ImportResult["accountKind"] = probe === "deployed" ? "existing" : "new-counterfactual";
  if (options.accountType === "braavos-v1.2.0" && accountKind !== "existing") {
    throw new Error(
      "Braavos import requires an existing, already-deployed account. Braavos addresses are not derivable from a key.",
    );
  }

  // Ownership verification — the definitive gate. ALWAYS runs; a failure rejects the import
  // before anything is persisted.
  const account = new Account({ provider, address: adapter.address, signer: new Signer(secret), cairoVersion: "1" });
  const ownership = await adapter.verifyOwnership(account, provider);
  if (!ownership.verified) {
    throw new Error(
      `Import verification failed for ${options.accountType}: ${ownership.reason ?? "ownership could not be proven."}`,
    );
  }

  // Encrypt into the same keystore model as newly-created wallets; discard the raw input.
  const keystore = await encryptSecret(secret, options.password, {
    publicKey,
    address: adapter.address,
    network: options.network,
    accountType: adapter.type,
  });

  const wallet = buildUnlocked(options.network, publicKey, secret, keystore, adapter, provider);
  persist(storage, options.network, wallet, "imported");
  return { wallet, accountKind, ownership };
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
    options?.onStatus?.("deployed");
    return { transactionHash: "", contractAddress: wallet.address };
  }
  if (probe === "unknown") {
    updateDeploymentStatus(store, wallet.network, "unknown");
    options?.onStatus?.("error");
    throw new Error(
      "Could not verify on-chain account state; refusing to deploy. Check the RPC and retry.",
    );
  }
  updateDeploymentStatus(store, wallet.network, "pending");
  options?.onStatus?.("pending");
  const deployment = await wallet.adapter.deploy(wallet.account);
  const receipt = await wallet.provider.waitForTransaction(deployment.transactionHash, {
    retryInterval: 4000,
  });
  const exec =
    (receipt as { execution_status?: unknown })?.execution_status ??
    (receipt as { status?: unknown })?.status;
  if (exec === "REVERTED" || exec === "REJECTED") {
    updateDeploymentStatus(store, wallet.network, "error");
    options?.onStatus?.("error");
    throw new Error("Account deployment reverted on-chain.");
  }
  const deployedAtBlock = Number((receipt as { block_number?: unknown })?.block_number ?? 0);
  updateDeploymentStatus(store, wallet.network, "finalizing");
  options?.onStatus?.("finalizing");
  try {
    await waitForDeploymentFinality(wallet.provider, deployedAtBlock, undefined, finalityOpts);
    updateDeploymentStatus(store, wallet.network, "deployed");
    options?.onStatus?.("deployed");
  } catch (err) {
    // Finality was not confirmed. Reconcile with the chain and NEVER claim deployed unless the
    // on-chain probe actually verifies the class hash.
    const recheck = await wallet.adapter.probeDeployment(wallet.provider).catch(
      () => "unknown" as AccountDeploymentProbe,
    );
    if (recheck === "deployed") {
      updateDeploymentStatus(store, wallet.network, "deployed");
      options?.onStatus?.("deployed");
    } else {
      updateDeploymentStatus(store, wallet.network, recheck === "not_deployed" ? "finalizing" : "unknown");
      options?.onStatus?.(recheck === "not_deployed" ? "finalizing" : "error");
    }
    throw err;
  }
  return { ...deployment, deployedAtBlock };
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

/** Remove the legacy Stage 1 keys for a network. Returns true when a keystore existed. */
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