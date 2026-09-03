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
  deployAccount,
  sendTransaction,
  defaultStorage,
  type DeployAccountResult,
  type ImportWalletOptions,
  type UnlockedWallet,
  type WalletDeploymentStatus,
  type WalletNetworkId,
  type WalletRegistryEntry,
  type WalletStorage,
} from "./index";
import {
  resolveWalletPrivacyConfig,
  WalletPrivacySession,
  type PrivacyOperationResult,
  type WalletPrivacyConfig,
} from "./privacy";

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

/** Safe privacy-capability status — never exposes the viewing key or any secret material. */
export interface PrivacyCapability {
  available: boolean;
  status: "unavailable" | "idle" | "loading" | "available" | "error";
  reason: string | null;
  /**
   * STRK20 registration state for the wallet's viewing key. `null` when unknown (not yet probed
   * or privacy unavailable). A wallet can be `available` but not yet `registered` — the first
   * shield auto-registers the viewing key on-chain.
   */
  registered: boolean | null;
}

/** Honest lifecycle of the most recent STRK20 privacy operation. Never contains secrets. */
export interface PrivacyOpState {
  operation: "shield" | "privateTransfer" | "withdraw" | "register" | null;
  phase:
    | "idle"
    | "preparing"
    | "approving"
    | "proving"
    | "submitted"
    | "pending"
    | "success"
    | "reverted"
    | "rejected"
    | "failed";
  transactionHash: string | null;
  message: string | null;
}

export const IDLE_PRIVACY_OP: PrivacyOpState = {
  operation: null,
  phase: "idle",
  transactionHash: null,
  message: null,
};

export interface WalletRuntimeView {
  network: WalletNetworkId;
  wallets: WalletRegistryEntry[];
  selectedWalletId: string | null;
  /** Safe unlocked-session view (null when locked). */
  account: WalletAccountView | null;
  isUnlocked: boolean;
  deploymentStatus: WalletDeploymentStatus;
  publicBalances: PublicBalanceRow[];
  /** Safe STRK20 privacy capability + private balances. Never exposes viewing keys. */
  privacy: PrivacyCapability;
  privateBalances: PublicBalanceRow[];
  /** Honest lifecycle of the latest STRK20 privacy operation (never proof/note/secret data). */
  privacyOp: PrivacyOpState;
  /** In-memory activity for this session (never persisted, never on-chain-sensitive). */
  recentTransactions: RecentTransaction[];
  error: string | null;
}

export interface WalletRuntimeOptions {
  storage?: WalletStorage;
  /** TEST SEAM ONLY: inject a deterministic provider (never weakens custody/signing). */
  providerFactory?: (network: WalletNetworkId) => RpcProvider;
  /** TEST SEAM ONLY: inject a deterministic account adapter (deploy/probe) for tests. */
  accountAdapterFactory?: (publicKey: string, address?: string) => import("./account").AccountAdapter;
  /** TEST SEAM ONLY: inject a deterministic privacy config (prover/discovery) for tests. */
  privacyConfig?: WalletPrivacyConfig | null;
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

/** How long to wait for a submitted STRK20 operation's on-chain finality before declaring it "pending". */
const PRIVACY_FINALITY_TIMEOUT_MS = 120_000;

/** How long to wait for a STRK20 discovery/registration call before reporting an honest error. */
const DISCOVERY_TIMEOUT_MS = 20_000;

/** Bound an async call so a hung discovery/proving service never leaves the UI spinning forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

function providerFor(network: WalletNetworkId, factory?: (n: WalletNetworkId) => RpcProvider): RpcProvider {
  if (factory) return factory(network);
  return new RpcProvider({ nodeUrl: getNetworkConfig(network).rpcUrls[0] });
}

export class WalletRuntime {
  /** Raw custody session — private. Never exposed through `getState()`. */
  private session: UnlockedWallet | null = null;
  /** Wallet-native STRK20 privacy session (in-memory viewing key) — private. */
  private privacySession: WalletPrivacySession | null = null;
  private view: WalletRuntimeView;
  private readonly storage: WalletStorage;
  private readonly providerFactory?: (n: WalletNetworkId) => RpcProvider;
  private readonly accountAdapterFactory?: (publicKey: string, address?: string) => import("./account").AccountAdapter;
  private readonly privacyConfig: WalletPrivacyConfig | null;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  constructor(options: WalletRuntimeOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.providerFactory = options.providerFactory;
    this.accountAdapterFactory = options.accountAdapterFactory;
    this.privacyConfig =
      options.privacyConfig !== undefined ? options.privacyConfig : resolveWalletPrivacyConfig("sepolia");
    this.view = {
      network: "sepolia",
      wallets: [],
      selectedWalletId: null,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privacy: {
        available: this.privacyConfig !== null,
        status: this.privacyConfig !== null ? "idle" : "unavailable",
        reason: this.privacyConfig !== null ? null : "STRK20 proving/discovery services are not configured.",
        registered: null,
      },
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
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

  /**
   * UI-facing state — a SAFE view. No secret, signer, or account internals are exposed.
   *
   * IMPORTANT: returns a stable reference between updates (`this.view` is replaced wholesale on
   * every mutation), which is what lets React's `useSyncExternalStore` observe changes correctly.
   * Consumers MUST treat the returned object as read-only.
   */
  getState(): WalletRuntimeView {
    return this.view;
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
    if (this.privacySession) this.privacySession.dispose();
    this.privacySession = null;
    this.session = null;
    const privacyConfig = this.privacyConfig !== null ? resolveWalletPrivacyConfig(network) : null;
    this.view = {
      network,
      wallets,
      selectedWalletId: wallets[0]?.walletId ?? null,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privacy: {
        available: privacyConfig !== null,
        status: privacyConfig !== null ? "idle" : "unavailable",
        reason: privacyConfig !== null ? null : "STRK20 proving/discovery services are not configured.",
        registered: null,
      },
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      recentTransactions: [],
      error: null,
    };
    this.emit();
  }

  private setActiveSession(wallet: UnlockedWallet): void {
    this.invalidate();
    this.session = wallet;
    if (this.privacySession) this.privacySession.dispose();
    const privacyConfig = this.privacyConfig !== null ? resolveWalletPrivacyConfig(this.view.network) : null;
    this.privacySession =
      privacyConfig !== null
        ? new WalletPrivacySession(wallet, this.view.network, privacyConfig, this.storage, {
            onApprovalStatus: () => {
              this.setView({ privacyOp: { ...this.view.privacyOp, phase: "approving" } });
            },
          })
        : null;
    this.setView({
      selectedWalletId: wallet.walletId,
      account: this.accountView(wallet),
      isUnlocked: true,
      deploymentStatus: "unknown",
      publicBalances: [],
      privacy: {
        available: this.privacySession !== null,
        status: this.privacySession !== null ? "idle" : "unavailable",
        reason: this.privacySession !== null ? null : "STRK20 proving/discovery services are not configured.",
        registered: null,
      },
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
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
    if (this.privacySession) this.privacySession.dispose();
    this.privacySession = null;
    this.invalidate();
    this.session = null;
    this.setView({
      selectedWalletId: walletId,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
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
        adapterFactory: this.accountAdapterFactory,
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
        adapterFactory: this.accountAdapterFactory,
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
        adapterFactory: this.accountAdapterFactory,
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
    if (this.privacySession) this.privacySession.dispose();
    this.privacySession = null;
    this.invalidate();
    this.session = null;
    this.setView({
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
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

  /**
   * Deploy the active wallet's account with the Wallet Core local signer (fail-closed).
   *
   * Lifecycle (visible in `deploymentStatus`):
   *   unknown → (refuse: RPC/class-hash must be verified first)
   *   not_deployed → pending (Deploying) → finalizing (Confirming) → deployed (Ready)
   *   deployed → early-return (reconciled)
   * Any RPC error, wrong class hash, or finality timeout reconciles with the chain and NEVER
   * claims "deployed" unless the on-chain probe verifies the class hash.
   */
  async deploy(options?: import("./index").DeployAccountOptions): Promise<DeployAccountResult> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to deploy the account.");
    const guard = this.captureGuard();
    this.setView({ deploymentStatus: "pending", error: null });
    try {
      const result = await deployAccount(session, this.storage, {
        ...options,
        onStatus: (status) => {
          if (!this.isCurrent(guard)) return;
          this.setView({ deploymentStatus: status });
        },
      });
      if (!this.isCurrent(guard)) return result;
      this.setView({ deploymentStatus: "deployed" });
      return result;
    } catch (err) {
      if (!this.isCurrent(guard)) throw err;
      // Fail-closed reconciliation: never silently claim "not deployed" on an RPC error.
      let status: WalletDeploymentStatus = "unknown";
      try {
        status = await getDeploymentStatus(session, this.storage);
      } catch {
        status = "unknown";
      }
      this.setView({
        deploymentStatus: status,
        error: err instanceof Error ? err.message : "Account deployment failed.",
      });
      throw err;
    }
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

  // ─────────────────────────── STRK20 privacy (wallet-native) ───────────────────────────

  private requirePrivacySession(): WalletPrivacySession {
    if (!this.session) throw new Error("Wallet is locked. Unlock it to use privacy.");
    if (!this.privacySession) {
      throw new Error("STRK20 privacy is unavailable: proving/discovery services are not configured.");
    }
    return this.privacySession;
  }

  /**
   * Probe the STRK20 registration state of the active wallet's viewing key. Honest status only:
   *   - operator not configured            → unavailable (registered: null)
   *   - discovery reachable                → registered true/false
   *   - discovery/proving service failing  → status "error" + reason (registered: null)
   * A wallet can be privacy-`available` but `unregistered` — the first shield auto-registers it.
   */
  async refreshPrivacyRegistration(): Promise<boolean | null> {
    if (!this.session) return null;
    if (!this.privacySession) {
      this.setView({
        privacy: {
          available: false,
          status: "unavailable",
          reason: "STRK20 proving/discovery services are not configured.",
          registered: null,
        },
      });
      return null;
    }
    const guard = this.captureGuard();
    this.setView({ privacy: { ...this.view.privacy, status: "loading", reason: null } });
    try {
      const networkConfig = getNetworkConfig(this.view.network);
      const token = networkConfig.tokens[0]?.address;
      if (!token) return null;
      const registered =
        (await withTimeout(
          this.privacySession.getPrivacyRegistration(token),
          DISCOVERY_TIMEOUT_MS,
          "STRK20 registration discovery",
        )) === "registered";
      if (!this.isCurrent(guard)) return null;
      this.setView({ privacy: { available: true, status: "available", reason: null, registered } });
      return registered;
    } catch (err) {
      if (!this.isCurrent(guard)) return null;
      this.setView({
        privacy: {
          available: true,
          status: "error",
          reason: err instanceof Error ? err.message : "STRK20 privacy registration check failed.",
          registered: null,
        },
      });
      return null;
    }
  }

  /** Private balances via the wallet-native viewing key + STRK20 discovery. Never fakes zeroes. */
  async refreshPrivateBalances(): Promise<PublicBalanceRow[]> {
    const session = this.session;
    if (!session) {
      this.setView({
        privateBalances: [],
        privacy: { available: false, status: "idle", reason: null, registered: null },
      });
      return [];
    }
    if (!this.privacySession) {
      this.setView({
        privateBalances: [],
        privacy: {
          available: false,
          status: "unavailable",
          reason: "STRK20 proving/discovery services are not configured.",
          registered: null,
        },
      });
      return [];
    }
    const guard = this.captureGuard();
    this.setView({ privacy: { ...this.view.privacy, status: "loading", reason: null } });
    try {
      const networkConfig = getNetworkConfig(this.view.network);
      const rows: PublicBalanceRow[] = [];
      for (const token of networkConfig.tokens) {
        const balance = await withTimeout(
          this.privacySession.getPrivateBalance(token.address),
          DISCOVERY_TIMEOUT_MS,
          "STRK20 private balance discovery",
        );
        rows.push({ token, balance, available: true });
      }
      if (!this.isCurrent(guard)) return [];
      this.setView({
        privateBalances: rows,
        privacy: { ...this.view.privacy, status: "available", reason: null },
      });
      return rows;
    } catch (err) {
      if (!this.isCurrent(guard)) return [];
      this.setView({
        privacy: {
          available: true,
          status: "error",
          reason: err instanceof Error ? err.message : "STRK20 private balance discovery failed.",
          registered: this.view.privacy.registered,
        },
      });
      return [];
    }
  }

  /**
   * Run a STRK20 privacy operation with an honest lifecycle, then wait for on-chain finality.
   * Never reports success before the reconciliation confirms it. Safe results only — the UI never
   * sees viewing keys, notes, proofs, or secrets.
   */
  private async runPrivacyOp(
    operation: PrivacyOpState["operation"],
    run: (privacy: WalletPrivacySession) => Promise<PrivacyOperationResult>,
  ): Promise<PrivacyOperationResult> {
    const privacy = this.requirePrivacySession();
    const guard = this.captureGuard();
    this.setView({ privacyOp: { operation, phase: "preparing", transactionHash: null, message: null } });
    try {
      const result = await run(privacy);
      if (!this.isCurrent(guard)) return result;
      this.setView({
        privacy: { ...this.view.privacy, status: "available", reason: null },
        privacyOp: { operation, phase: "submitted", transactionHash: result.transactionHash, message: null },
        recentTransactions: [
          { hash: result.transactionHash, at: Date.now() },
          ...this.view.recentTransactions,
        ].slice(0, 20),
      });
      await this.waitForPrivacyFinality(result.transactionHash, guard, operation);
      return result;
    } catch (err) {
      if (!this.isCurrent(guard)) throw err;
      this.setView({
        privacyOp: {
          operation,
          phase: "failed",
          transactionHash: null,
          message: err instanceof Error ? err.message : "STRK20 operation failed.",
        },
      });
      throw err;
    }
  }

  /** Poll the RPC for the final status of a submitted privacy operation. Honest: never fabricates success. */
  private async waitForPrivacyFinality(
    transactionHash: string,
    guard: RuntimeGuard,
    operation: PrivacyOpState["operation"],
  ): Promise<void> {
    const session = this.session;
    if (!session) return;
    const provider = session.provider;
    this.setView({ privacyOp: { operation, phase: "pending", transactionHash, message: null } });
    try {
      const receipt = (await Promise.race([
        provider.waitForTransaction(transactionHash, { retryInterval: 4000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Finality timeout")), PRIVACY_FINALITY_TIMEOUT_MS),
        ),
      ])) as { execution_status?: unknown; status?: unknown; revert_reason?: unknown };
      if (!this.isCurrent(guard)) return;
      const exec = receipt.execution_status ?? receipt.status;
      const phase: PrivacyOpState["phase"] =
        exec === "REVERTED"
          ? "reverted"
          : exec === "REJECTED"
            ? "rejected"
            : exec === "SUCCEEDED" || exec === "ACCEPTED_ON_L2"
              ? "success"
              : "pending";
      this.setView({
        privacyOp: {
          operation,
          phase,
          transactionHash,
          message: phase === "reverted" ? "STRK20 transaction reverted on-chain." : null,
        },
      });
    } catch (err) {
      if (!this.isCurrent(guard)) return;
      // A finality timeout must NOT be reported as success — leave it honestly "pending".
      this.setView({
        privacyOp: {
          operation,
          phase: "pending",
          transactionHash,
          message: err instanceof Error && /Finality timeout/.test(err.message)
            ? "Submitted — finality not yet confirmed on-chain."
            : "Could not confirm on-chain finality.",
        },
      });
    }
  }

  async shield(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("shield", (privacy) => privacy.shield(token, amountBase));
  }

  async privateTransfer(token: string, amountBase: bigint, recipient: string): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("privateTransfer", (privacy) => privacy.privateTransfer(token, amountBase, recipient));
  }

  async withdraw(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("withdraw", (privacy) => privacy.withdraw(token, amountBase));
  }

  /** Create a PrivateIdentity for the active wallet. Requires the shadow anonymizer to be configured. */
  async createPrivateIdentity(purpose: string, opts?: { dappName?: string }): Promise<import("@/privacy/identity").PrivateIdentity> {
    const privacy = this.requirePrivacySession();
    const guard = this.captureGuard();
    const anonymizerAddress = (process.env.SHADOW_ACCOUNT_ANONYMIZER_ADDRESS ?? "").trim();
    if (!anonymizerAddress) {
      throw new Error("Private identity creation requires the shadow-account anonymizer to be configured.");
    }
    const poolContractAddress = getNetworkConfig(this.view.network).poolAddress;
    const identity = await privacy.createPrivateIdentity(purpose, {
      anonymizerAddress,
      poolContractAddress,
      dappName: opts?.dappName,
    });
    if (!this.isCurrent(guard)) return identity;
    return identity;
  }
}