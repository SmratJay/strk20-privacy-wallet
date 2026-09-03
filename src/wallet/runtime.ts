import type { Call } from "starknet";
import { RpcProvider } from "starknet";
import { getNetworkConfig } from "@/config/networks";
import type { TokenInfo } from "@/config/networks";
import { privacyService } from "@/services/privacyService";
import {
  createWallet,
  importWallet,
  unlockWallet,
  lockWallet,
  listWallets,
  clearWalletById,
  getDeploymentStatus,
  sendTransaction,
  defaultStorage,
  type ImportWalletOptions,
  type UnlockedWallet,
  type WalletDeploymentStatus,
  type WalletNetworkId,
  type WalletRegistryEntry,
  type WalletStorage,
} from "./index";

/**
 * Wallet Core — application wallet runtime.
 *
 * The smallest clean bridge between the Orrange product UI and Wallet Core. It is framework
 * agnostic (headless-testable) and is the ONLY custody boundary the UI talks to. It owns:
 *
 *   network selection · wallet registry · selected walletId · unlocked session · create/import/
 *   unlock/lock/delete · deployment status · public balances · send · recent activity
 *
 * SECURITY INVARIANTS:
 *  - the raw `UnlockedWallet` (secret, signer, account) is held in a PRIVATE field and is NEVER
 *    part of the UI-facing state. `getState()` returns only a safe view:
 *      walletId, address, accountType, network, deploymentStatus, isUnlocked, …
 *  - the unlocked session is NEVER persisted; a page reload returns to "wallet exists → locked";
 *  - async results (deployment, balances, create/import/unlock) are guarded by
 *    `(walletId, network, generation)`, so a stale result from wallet A / network A can never
 *    update state after switching to wallet B / network B, or after locking;
 *  - there is NO Privy dependency and no legacy Wallet API connect path here.
 *
 * Legacy compatibility: the legacy `unlockWallet({ network, password })` (no walletId) path is
 * NEVER used by this runtime — every unlock is `unlockWallet({ network, walletId, password })`.
 */

export interface PublicBalanceRow {
  token: TokenInfo;
  balance: bigint;
  available: boolean;
}

/** Safe, UI-facing view of an unlocked wallet — never exposes secret/signer/account internals. */
export interface WalletAccountView {
  walletId: string;
  address: string;
  accountType: string;
  /** Public STARK public key (public on-chain data, not a secret). */
  publicKey: string;
}

export interface RecentTransaction {
  hash: string;
  at: number;
}

export interface WalletRuntimeView {
  network: WalletNetworkId;
  wallets: WalletRegistryEntry[];
  selectedWalletId: string | null;
  /** Safe unlocked-session view (null when locked). */
  account: WalletAccountView | null;
  isUnlocked: boolean;
  deploymentStatus: WalletDeploymentStatus;
  publicBalances: PublicBalanceRow[];
  /** In-memory activity for this session (never persisted, never on-chain-sensitive). */
  recentTransactions: RecentTransaction[];
  error: string | null;
}

export interface WalletRuntimeOptions {
  storage?: WalletStorage;
  /** TEST SEAM ONLY: inject a deterministic provider (never weakens custody/signing). */
  providerFactory?: (network: WalletNetworkId) => RpcProvider;
  /**
   * When true, the initial registry load is deferred to `init()` (called from a React effect).
   * This keeps server/prerender output deterministic (empty gate) so client hydration never
   * reads localStorage during render.
   */
  lazy?: boolean;
}

interface RuntimeGuard {
  generation: number;
  network: WalletNetworkId;
  walletId: string | null;
}

function providerFor(network: WalletNetworkId, factory?: (n: WalletNetworkId) => RpcProvider): RpcProvider {
  if (factory) return factory(network);
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

export class WalletRuntime {
  /** Raw custody session — private. Never exposed through `getState()`. */
  private session: UnlockedWallet | null = null;
  private view: WalletRuntimeView;
  private readonly storage: WalletStorage;
  private readonly providerFactory?: (n: WalletNetworkId) => RpcProvider;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(options: WalletRuntimeOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.providerFactory = options.providerFactory;
    this.view = {
      network: "sepolia",
      wallets: [],
      selectedWalletId: null,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      recentTransactions: [],
      error: null,
    };
    if (!options.lazy) this.reloadForNetwork(this.view.network);
  }

  /** Load the registry for the current network. Called from a React effect for `lazy` runtimes. */
  init(): void {
    this.reloadForNetwork(this.view.network);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** UI-facing state — a SAFE view. No secret, signer, or account internals are exposed. */
  getState(): WalletRuntimeView {
    return { ...this.view };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setView(patch: Partial<WalletRuntimeView>): void {
    this.view = { ...this.view, ...patch };
    this.emit();
  }

  private captureGuard(): RuntimeGuard {
    return { generation: this.generation, network: this.view.network, walletId: this.session?.walletId ?? null };
  }

  private isCurrent(guard: RuntimeGuard): boolean {
    return (
      guard.generation === this.generation &&
      guard.network === this.view.network &&
      guard.walletId === (this.session?.walletId ?? null)
    );
  }

  /** Invalidate all in-flight async work (called on network/wallet switch, lock, delete, reload). */
  private invalidate(): void {
    this.generation++;
  }

  private accountView(wallet: UnlockedWallet): WalletAccountView {
    return {
      walletId: wallet.walletId,
      address: wallet.address,
      accountType: wallet.accountType,
      publicKey: wallet.publicKey,
    };
  }

  private reloadForNetwork(network: WalletNetworkId): void {
    this.invalidate();
    const wallets = listWallets({ network, storage: this.storage });
    this.session = null;
    this.view = {
      network,
      wallets,
      selectedWalletId: wallets[0]?.walletId ?? null,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      recentTransactions: [],
      error: null,
    };
    this.emit();
  }

  private setActiveSession(wallet: UnlockedWallet): void {
    this.invalidate();
    this.session = wallet;
    this.setView({
      selectedWalletId: wallet.walletId,
      account: this.accountView(wallet),
      isUnlocked: true,
      deploymentStatus: "unknown",
      publicBalances: [],
      error: null,
    });
  }

  /** Select a network. Unsupported networks are rejected (never enabled). */
  setNetwork(network: WalletNetworkId): void {
    if (network === this.view.network) return;
    if (network === "mainnet") {
      this.setView({ error: "Starknet Mainnet is not enabled for Wallet Core accounts yet." });
      return;
    }
    this.reloadForNetwork(network);
  }

  selectWallet(walletId: string): void {
    const entry = this.view.wallets.find((w) => w.walletId === walletId);
    if (!entry) return;
    // Selecting a wallet always returns to the locked state and invalidates in-flight work.
    if (this.session) lockWallet(this.session);
    this.invalidate();
    this.session = null;
    this.setView({
      selectedWalletId: walletId,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      error: null,
    });
  }

  async create(password: string): Promise<UnlockedWallet> {
    this.setView({ error: null });
    const guard = this.captureGuard();
    try {
      const wallet = await createWallet({
        network: this.view.network,
        password,
        storage: this.storage,
        provider: providerFor(this.view.network, this.providerFactory),
      });
      // Stale (the user switched network/wallet/locked while creating): the wallet was persisted
      // to storage and will appear in the (already reloaded) registry; do NOT adopt it as active.
      if (!this.isCurrent(guard)) return wallet;
      this.reloadForNetwork(this.view.network);
      this.setActiveSession(wallet);
      this.setView({ deploymentStatus: "not_deployed" });
      void this.refreshDeployment();
      return wallet;
    } catch (err) {
      this.setView({ error: err instanceof Error ? err.message : "Wallet creation failed." });
      throw err;
    }
  }

  async import(input: Omit<ImportWalletOptions, "network" | "storage">): Promise<UnlockedWallet> {
    this.setView({ error: null });
    const guard = this.captureGuard();
    try {
      const result = await importWallet({
        ...input,
        network: this.view.network,
        storage: this.storage,
        provider: providerFor(this.view.network, this.providerFactory),
      });
      if (!this.isCurrent(guard)) return result.wallet;
      this.reloadForNetwork(this.view.network);
      this.setActiveSession(result.wallet);
      this.setView({
        deploymentStatus: result.accountKind === "existing" ? "deployed" : "not_deployed",
      });
      void this.refreshDeployment();
      return result.wallet;
    } catch (err) {
      this.setView({ error: err instanceof Error ? err.message : "Import failed." });
      throw err;
    }
  }

  async unlock(password: string): Promise<UnlockedWallet> {
    this.setView({ error: null });
    const walletId = this.view.selectedWalletId;
    if (!walletId) {
      const err = new Error("Select a wallet to unlock first.");
      this.setView({ error: err.message });
      throw err;
    }
    const guard = this.captureGuard();
    try {
      const wallet = await unlockWallet({
        network: this.view.network,
        walletId,
        password,
        storage: this.storage,
        provider: providerFor(this.view.network, this.providerFactory),
      });
      if (!this.isCurrent(guard)) return wallet;
      this.setActiveSession(wallet);
      void this.refreshDeployment();
      return wallet;
    } catch (err) {
      this.setView({ error: err instanceof Error ? err.message : "Unlock failed." });
      throw err;
    }
  }

  lock(): void {
    if (this.session) lockWallet(this.session);
    this.invalidate();
    this.session = null;
    this.setView({
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      recentTransactions: [],
      error: null,
    });
  }

  deleteWallet(walletId: string): void {
    clearWalletById(this.storage, this.view.network, walletId);
    if (this.session && this.session.walletId === walletId) lockWallet(this.session);
    this.reloadForNetwork(this.view.network);
  }

  async refreshDeployment(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const guard = this.captureGuard();
    const status = await getDeploymentStatus(session, this.storage);
    // Ignore stale results: wallet switched, network switched, or locked while awaiting.
    if (!this.isCurrent(guard)) return;
    this.setView({ deploymentStatus: status });
  }

  /** Public balances via RPC for the unlocked wallet address. No Privy. */
  async refreshPublicBalances(): Promise<PublicBalanceRow[]> {
    const session = this.session;
    if (!session) {
      this.setView({ publicBalances: [] });
      return [];
    }
    const guard = this.captureGuard();
    const networkConfig = getNetworkConfig(this.view.network);
    const results = await privacyService.fetchBalances(session.address, undefined, networkConfig);
    // Ignore stale results (wallet/network switched or locked while awaiting).
    if (!this.isCurrent(guard)) return [];
    const rows: PublicBalanceRow[] = results.map((entry) => ({
      token: entry.token,
      balance: entry.publicBalance,
      available: entry.publicBalanceAvailable,
    }));
    this.setView({ publicBalances: rows });
    return rows;
  }

  /** Sign + submit an ordinary public transaction with the Wallet Core local signer. */
  async send(call: Call): Promise<{ transactionHash: string }> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to send transactions.");
    const guard = this.captureGuard();
    const result = await sendTransaction(session, call);
    if (!this.isCurrent(guard)) return result;
    this.setView({
      recentTransactions: [{ hash: result.transactionHash, at: Date.now() }, ...this.view.recentTransactions].slice(0, 20),
    });
    return result;
  }
}