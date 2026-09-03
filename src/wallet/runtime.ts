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
 *   unlock/lock/delete · deployment status · public balances · send
 *
 * SECURITY INVARIANTS:
 *  - the unlocked session (which holds the signing secret in memory) is NEVER persisted; a page
 *    reload returns to "wallet exists → locked";
 *  - an unlocked secret never enters React state except through this runtime's session;
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

export interface WalletRuntimeState {
  network: WalletNetworkId;
  wallets: WalletRegistryEntry[];
  selectedWalletId: string | null;
  /** In-memory unlocked session. Never persisted. */
  session: UnlockedWallet | null;
  deploymentStatus: WalletDeploymentStatus;
  publicBalances: PublicBalanceRow[];
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

function providerFor(network: WalletNetworkId, factory?: (n: WalletNetworkId) => RpcProvider): RpcProvider {
  if (factory) return factory(network);
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

export class WalletRuntime {
  private state: WalletRuntimeState;
  private readonly storage: WalletStorage;
  private readonly providerFactory?: (n: WalletNetworkId) => RpcProvider;
  private readonly listeners = new Set<() => void>();

  constructor(options: WalletRuntimeOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.providerFactory = options.providerFactory;
    this.state = {
      network: "sepolia",
      wallets: [],
      selectedWalletId: null,
      session: null,
      deploymentStatus: "unknown",
      publicBalances: [],
      error: null,
    };
    if (!options.lazy) this.reloadForNetwork(this.state.network);
  }

  /** Load the registry for the current network. Called from a React effect for `lazy` runtimes. */
  init(): void {
    this.reloadForNetwork(this.state.network);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): WalletRuntimeState {
    return this.state;
  }

  private setState(patch: Partial<WalletRuntimeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private reloadForNetwork(network: WalletNetworkId): void {
    const wallets = listWallets({ network, storage: this.storage });
    this.setState({
      network,
      wallets,
      selectedWalletId: wallets[0]?.walletId ?? null,
      session: null,
      deploymentStatus: "unknown",
      publicBalances: [],
      error: null,
    });
  }

  /** Select a network. Unsupported networks are rejected (never enabled). */
  setNetwork(network: WalletNetworkId): void {
    if (network === this.state.network) return;
    if (network === "mainnet") {
      this.setState({ error: "Starknet Mainnet is not enabled for Wallet Core accounts yet." });
      return;
    }
    this.reloadForNetwork(network);
  }

  selectWallet(walletId: string): void {
    const entry = this.state.wallets.find((w) => w.walletId === walletId);
    if (!entry) return;
    // Selecting a different wallet always returns to the locked state.
    if (this.state.session && this.state.session.walletId !== walletId) {
      lockWallet(this.state.session);
    }
    this.setState({ selectedWalletId: walletId, session: null, deploymentStatus: "unknown" });
  }

  async create(password: string): Promise<UnlockedWallet> {
    this.setState({ error: null });
    try {
      const wallet = await createWallet({
        network: this.state.network,
        password,
        storage: this.storage,
        provider: providerFor(this.state.network, this.providerFactory),
      });
      this.reloadForNetwork(this.state.network);
      this.setState({ selectedWalletId: wallet.walletId, session: wallet, deploymentStatus: "not_deployed" });
      void this.refreshDeployment(wallet);
      return wallet;
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : "Wallet creation failed." });
      throw err;
    }
  }

  async import(input: Omit<ImportWalletOptions, "network" | "storage">): Promise<UnlockedWallet> {
    this.setState({ error: null });
    try {
      const result = await importWallet({
        ...input,
        network: this.state.network,
        storage: this.storage,
        provider: providerFor(this.state.network, this.providerFactory),
      });
      this.reloadForNetwork(this.state.network);
      this.setState({
        selectedWalletId: result.wallet.walletId,
        session: result.wallet,
        deploymentStatus: result.accountKind === "existing" ? "deployed" : "not_deployed",
      });
      void this.refreshDeployment(result.wallet);
      return result.wallet;
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : "Import failed." });
      throw err;
    }
  }

  async unlock(password: string): Promise<UnlockedWallet> {
    this.setState({ error: null });
    const walletId = this.state.selectedWalletId;
    if (!walletId) {
      const err = new Error("Select a wallet to unlock first.");
      this.setState({ error: err.message });
      throw err;
    }
    try {
      const wallet = await unlockWallet({
        network: this.state.network,
        walletId,
        password,
        storage: this.storage,
        provider: providerFor(this.state.network, this.providerFactory),
      });
      this.setState({ session: wallet, deploymentStatus: "unknown" });
      void this.refreshDeployment(wallet);
      return wallet;
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : "Unlock failed." });
      throw err;
    }
  }

  lock(): void {
    if (this.state.session) lockWallet(this.state.session);
    this.setState({ session: null, deploymentStatus: "unknown" });
  }

  deleteWallet(walletId: string): void {
    clearWalletById(this.storage, this.state.network, walletId);
    if (this.state.session && this.state.session.walletId === walletId) {
      lockWallet(this.state.session);
    }
    this.reloadForNetwork(this.state.network);
  }

  async refreshDeployment(wallet: UnlockedWallet = this.state.session!): Promise<void> {
    if (!wallet) return;
    const status = await getDeploymentStatus(wallet, this.storage);
    this.setState({ deploymentStatus: status });
  }

  /** Public balances via RPC for the unlocked wallet address. No Privy. */
  async refreshPublicBalances(): Promise<PublicBalanceRow[]> {
    const session = this.state.session;
    if (!session) {
      this.setState({ publicBalances: [] });
      return [];
    }
    const networkConfig = getNetworkConfig(this.state.network);
    const results = await privacyService.fetchBalances(session.address, undefined, networkConfig);
    const rows: PublicBalanceRow[] = results.map((entry) => ({
      token: entry.token,
      balance: entry.publicBalance,
      available: entry.publicBalanceAvailable,
    }));
    this.setState({ publicBalances: rows });
    return rows;
  }

  /** Sign + submit an ordinary public transaction with the Wallet Core local signer. */
  async send(call: Call): Promise<{ transactionHash: string }> {
    const session = this.state.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to send transactions.");
    return sendTransaction(session, call);
  }
}