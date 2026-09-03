import type { Call } from "starknet";
import { RpcProvider } from "starknet";
import { getNetworkConfig } from "@/config/networks";
import type { TokenInfo } from "@/config/networks";
import { chainBalances } from "@/chains/publicBalances";
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
import {
  StarknetPrivateExecutor,
  IDLE_PRIVATE_EXECUTION,
  type PrivateExecutionIntent,
  type PrivateExecutionOpState,
  type PrivateExecutionReceipt,
} from "@/privacy/execution";
import { listPrivateIdentities as listWalletPrivateIdentities } from "@/privacy/identity";
import type { PrivateIdentity } from "@/privacy/identity";

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
  /** The discovery snapshot block a private balance was read at (numeric), when known. */
  asOfBlock?: number | null;
  /** True when the private-balance discovery snapshot lags the chain head (indexer syncing). */
  syncing?: boolean;
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
  /** Kind of activity, for UI labeling. Never contains secrets. */
  kind?: 'public' | 'shield' | 'privateTransfer' | 'withdraw' | 'register';
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
  /**
   * Proving-chain maturity of the wallet's account. After a fresh deployment the chain must
   * advance `PROVING_SAFETY_MARGIN` blocks past the deploy block before the STRK20 pool can
   * validate proofs referencing that state. `waiting` means "honestly not ready yet", never
   * "privacy failed". `unknown` when the deploy block is not known this session.
   */
  maturity: "unknown" | "waiting" | "ready";
  /** The block at which proving/private ops become safe (`deployedAtBlock + margin`), when known. */
  maturityReadyAtBlock: number | null;
  /** The latest known chain head, when read. */
  currentBlock: number | null;
  /** True when the discovery indexer's snapshot lags the chain head (private balances may not include the newest notes yet). */
  syncing: boolean;
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
  /** Honest lifecycle of the latest PRIVATE EXECUTION (application action). Never secrets. */
  executionOp: PrivateExecutionOpState;
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

/**
 * The chain must advance this many blocks past the deploy block before the STRK20 pool accepts
 * proofs (mirrors `PROVING_SAFETY_MARGIN` in the adapter). Balances/ops are honest-but-waiting
 * until then — never a generic "privacy failed".
 */
const MATURITY_BLOCKS = 10;

/** Indexer lag (chain head - snapshot block) above which a private balance is reported "syncing". */
const SYNC_TOLERANCE_BLOCKS = 3;

/** A fresh privacy capability default — never claims readiness it cannot verify. */
function idlePrivacy(available: boolean, reason: string | null): PrivacyCapability {
  return {
    available,
    status: available ? "idle" : "unavailable",
    reason,
    registered: null,
    maturity: "unknown",
    maturityReadyAtBlock: null,
    currentBlock: null,
    syncing: false,
  };
}

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
  /** Deploy block of the active session (set when this session deployed the account), for maturity. */
  private deployedAtBlock: number | null = null;

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
      privacy: idlePrivacy(
        this.privacyConfig !== null,
        this.privacyConfig !== null ? null : "STRK20 proving/discovery services are not configured.",
      ),
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      executionOp: IDLE_PRIVATE_EXECUTION,
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
    this.deployedAtBlock = null;
    const privacyConfig = this.privacyConfig !== null ? resolveWalletPrivacyConfig(network) : null;
    this.view = {
      network,
      wallets,
      selectedWalletId: wallets[0]?.walletId ?? null,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privacy: idlePrivacy(
        privacyConfig !== null,
        privacyConfig !== null ? null : "STRK20 proving/discovery services are not configured.",
      ),
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      executionOp: IDLE_PRIVATE_EXECUTION,
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
      privacy: idlePrivacy(
        this.privacySession !== null,
        this.privacySession !== null ? null : "STRK20 proving/discovery services are not configured.",
      ),
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      executionOp: IDLE_PRIVATE_EXECUTION,
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
    this.deployedAtBlock = null;
    this.setView({
      selectedWalletId: walletId,
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      executionOp: IDLE_PRIVATE_EXECUTION,
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
    this.deployedAtBlock = null;
    this.setView({
      account: null,
      isUnlocked: false,
      deploymentStatus: "unknown",
      publicBalances: [],
      privateBalances: [],
      privacyOp: IDLE_PRIVACY_OP,
      executionOp: IDLE_PRIVATE_EXECUTION,
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
      this.deployedAtBlock = result.deployedAtBlock ?? null;
      this.setView({ deploymentStatus: "deployed" });
      void this.refreshPrivacyMaturity();
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
    const results = await chainBalances.fetchBalances(session.address, networkConfig);
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
  async send(call: Call | Call[]): Promise<{ transactionHash: string }> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to send transactions.");
    const guard = this.captureGuard();
    const result = await sendTransaction(session, call);
    if (!this.isCurrent(guard)) return result;
    this.setView({
      recentTransactions: [
        { hash: result.transactionHash, at: Date.now(), kind: "public" as const },
        ...this.view.recentTransactions,
      ].slice(0, 20),
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
        privacy: idlePrivacy(false, "STRK20 proving/discovery services are not configured."),
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
      this.setView({ privacy: { ...this.view.privacy, status: "available", reason: null, registered } });
      return registered;
    } catch (err) {
      if (!this.isCurrent(guard)) return null;
      this.setView({
        privacy: {
          ...this.view.privacy,
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
        privacy: idlePrivacy(false, null),
      });
      return [];
    }
    if (!this.privacySession) {
      this.setView({
        privateBalances: [],
        privacy: idlePrivacy(false, "STRK20 proving/discovery services are not configured."),
      });
      return [];
    }
    const guard = this.captureGuard();
    this.setView({ privacy: { ...this.view.privacy, status: "loading", reason: null } });
    try {
      const networkConfig = getNetworkConfig(this.view.network);
      const rows: PublicBalanceRow[] = [];
      let currentBlock: number | null = null;
      try {
        currentBlock = await withTimeout(session.provider.getBlockNumber(), DISCOVERY_TIMEOUT_MS, "chain head");
      } catch {
        currentBlock = null;
      }
      let anySyncing = false;
      for (const token of networkConfig.tokens) {
        const snapshot = await withTimeout(
          this.privacySession.getPrivateBalanceSnapshot(token.address),
          DISCOVERY_TIMEOUT_MS,
          "STRK20 private balance discovery",
        );
        const asOfBlock = snapshot.asOfBlock;
        const syncing = Boolean(
          currentBlock !== null &&
            asOfBlock !== null &&
            asOfBlock > 0 &&
            currentBlock - asOfBlock > SYNC_TOLERANCE_BLOCKS,
        );
        if (syncing) anySyncing = true;
        rows.push({ token, balance: snapshot.balance, available: true, asOfBlock, syncing });
      }
      if (!this.isCurrent(guard)) return [];
      this.setView({
        privateBalances: rows,
        privacy: {
          ...this.view.privacy,
          status: "available",
          reason: null,
          currentBlock,
          syncing: anySyncing,
        },
      });
      return rows;
    } catch (err) {
      if (!this.isCurrent(guard)) return [];
      this.setView({
        privacy: {
          ...this.view.privacy,
          status: "error",
          reason: err instanceof Error ? err.message : "STRK20 private balance discovery failed.",
          registered: this.view.privacy.registered,
        },
      });
      return [];
    }
  }

  /**
   * Probe proving-chain maturity of the active wallet: after a deployment this session, the chain
   * must advance `MATURITY_BLOCKS` past the deploy block before STRK20 proofs can be validated.
   * Honest states — `waiting` (with the ready-at block) is NOT a failure, and `unknown` is used
   * whenever the deploy block is not known (imported/existing accounts) rather than claiming ready.
   */
  async refreshPrivacyMaturity(): Promise<void> {
    if (!this.session) return;
    if (this.deployedAtBlock === null) {
      this.setView({ privacy: { ...this.view.privacy, maturity: "unknown", currentBlock: null } });
      return;
    }
    const guard = this.captureGuard();
    const readyAt = this.deployedAtBlock + MATURITY_BLOCKS;
    try {
      const currentBlock = await withTimeout(
        this.session.provider.getBlockNumber(),
        DISCOVERY_TIMEOUT_MS,
        "chain head",
      );
      if (!this.isCurrent(guard)) return;
      this.setView({
        privacy: {
          ...this.view.privacy,
          maturity: currentBlock >= readyAt ? "ready" : "waiting",
          maturityReadyAtBlock: readyAt,
          currentBlock,
        },
      });
    } catch (err) {
      if (!this.isCurrent(guard)) return;
      // A failed head read cannot claim readiness; stay honestly "waiting" when we know a deploy
      // block, without inventing a block number.
      this.setView({
        privacy: { ...this.view.privacy, maturity: "waiting", maturityReadyAtBlock: readyAt, currentBlock: null },
      });
      void err;
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
          { hash: result.transactionHash, at: Date.now(), kind: operation ?? undefined },
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
    const result = await this.pollTransactionPhase(transactionHash, guard, provider);
    if (!result) return;
    this.setView({
      privacyOp: {
        operation,
        phase: result.phase,
        transactionHash,
        message: result.phase === "reverted" ? "STRK20 transaction reverted on-chain." : result.message,
      },
    });
  }

  /**
   * Poll a submitted transaction until finality (or an honest timeout). Returns null when the
   * poll was stale (wallet/network switched or locked) — the caller must not update state.
   * A finality timeout must NEVER be reported as success; it stays "pending".
   */
  private async pollTransactionPhase(
    transactionHash: string,
    guard: RuntimeGuard,
    provider: Pick<RpcProvider, "waitForTransaction">,
  ): Promise<{ phase: "pending" | "success" | "reverted" | "rejected"; message: string | null } | null> {
    try {
      const receipt = (await Promise.race([
        provider.waitForTransaction(transactionHash, { retryInterval: 4000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Finality timeout")), PRIVACY_FINALITY_TIMEOUT_MS),
        ),
      ])) as { execution_status?: unknown; status?: unknown; revert_reason?: unknown };
      if (!this.isCurrent(guard)) return null;
      const exec = receipt.execution_status ?? receipt.status;
      const phase: "pending" | "success" | "reverted" | "rejected" =
        exec === "REVERTED"
          ? "reverted"
          : exec === "REJECTED"
            ? "rejected"
            : exec === "SUCCEEDED" || exec === "ACCEPTED_ON_L2"
              ? "success"
              : "pending";
      return { phase, message: null };
    } catch (err) {
      if (!this.isCurrent(guard)) return null;
      // A finality timeout must NOT be reported as success — leave it honestly "pending".
      return {
        phase: "pending",
        message: err instanceof Error && /Finality timeout/.test(err.message)
          ? "Submitted — finality not yet confirmed on-chain."
          : "Could not confirm on-chain finality.",
      };
    }
  }

  async shield(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("shield", (privacy) => privacy.shield(token, amountBase));
  }

  /** Explicit STRK20 registration of the wallet's viewing key (serialized with other pool ops). */
  async register(): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("register", (privacy) => privacy.register());
  }

  async privateTransfer(token: string, amountBase: bigint, recipient: string): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("privateTransfer", (privacy) => privacy.privateTransfer(token, amountBase, recipient));
  }

  async withdraw(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.runPrivacyOp("withdraw", (privacy) => privacy.withdraw(token, amountBase));
  }

  /** Create a REAL STRK20 shadow identity for the active wallet. Requires the shadow anonymizer
   * for the active network. A fresh nonce yields a fresh shadow identity (never silently reused). */
  async createShadowIdentity(appName: string, nonce: bigint): Promise<import("@/privacy/identity").PrivateIdentity> {
    const privacy = this.requirePrivacySession();
    const guard = this.captureGuard();
    // Network-scoped PUBLIC contract config (never a server secret). The same network's address
    // is always used; a missing config reports explicit unavailability.
    const anonymizerAddress = getNetworkConfig(this.view.network).shadowAccountAnonymizerAddress.trim();
    if (!anonymizerAddress) {
      throw new Error(
        `Shadow identity creation is unavailable: no shadow-account anonymizer is configured for ${this.view.network}.`,
      );
    }
    const poolContractAddress = getNetworkConfig(this.view.network).poolAddress;
    const identity = await privacy.createShadowIdentity(appName, nonce, {
      anonymizerAddress,
      poolContractAddress,
    });
    if (!this.isCurrent(guard)) return identity;
    return identity;
  }

  /** Safe list of the active wallet's shadow identities on the active network (public metadata only). */
  listPrivateIdentities(): import("@/privacy/identity").PrivateIdentity[] {
    if (!this.session) return [];
    return listWalletPrivateIdentities(this.storage, this.view.network, this.session.address);
  }

  /** Best-effort human token symbol for the active network (UI label, never a secret). */
  private tokenSymbolFor(token: string): string | null {
    const tokenConfig = getNetworkConfig(this.view.network).tokens.find(
      (t) => t.address.toLowerCase() === token.toLowerCase(),
    );
    return tokenConfig?.symbol ?? null;
  }

  /**
   * Execute a REAL STRK20 shadow-account application action (the Wallet Core private-execution
   * surface).
   *
   * Requires an unlocked Wallet Core wallet + a live WalletPrivacySession. Captures the existing
   * walletId/network/generation guard so a stale/locked execution is refused. Runs through the
   * STRK20 shadow-account layer (never a public master-wallet fallback) and returns a SAFE
   * receipt. The outer transaction is relayed through the private paymaster so the root wallet is
   * not the on-chain tx sender.
   *
   * Lifecycle (visible in `executionOp`):
   *   preparing → proving → submitted → pending → success / reverted / rejected / failed
   * Success is NEVER claimed before on-chain reconciliation.
   */
  async executePrivate(intent: PrivateExecutionIntent): Promise<PrivateExecutionReceipt> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to execute private actions.");
    const privacy = this.requirePrivacySession();
    const guard = this.captureGuard();
    this.setView({
      executionOp: {
        phase: "preparing",
        action: intent.action,
        tokenSymbol: this.tokenSymbolFor(intent.token),
        amount: intent.amount,
        appName: intent.appName,
        nonce: intent.nonce.toString(),
        targetContract: intent.calls[0]?.contractAddress ?? null,
        shadowAddress: null,
        transactionHash: null,
        message: null,
      },
      error: null,
    });
    try {
      this.setView({ executionOp: { ...this.view.executionOp, phase: "proving" } });
      const executor = new StarknetPrivateExecutor({ wallet: session, privacySession: privacy });
      const receipt = await executor.execute(intent);
      if (!this.isCurrent(guard)) return receipt;
      this.setView({
        executionOp: {
          ...this.view.executionOp,
          phase: "submitted",
          targetContract: receipt.targetContract,
          shadowAddress: receipt.shadowAddress,
          transactionHash: receipt.transactionHash,
          message: null,
        },
        recentTransactions: [
          { hash: receipt.transactionHash, at: Date.now(), kind: "privateTransfer" as const },
          ...this.view.recentTransactions,
        ].slice(0, 20),
      });
      await this.waitForExecutionFinality(receipt.transactionHash, guard);
      return receipt;
    } catch (err) {
      if (!this.isCurrent(guard)) throw err;
      this.setView({
        executionOp: {
          ...this.view.executionOp,
          phase: "failed",
          message: err instanceof Error ? err.message : "Private execution failed.",
        },
      });
      throw err;
    }
  }

  /** Poll the RPC for the final status of a submitted private execution. Honest: never fabricates success. */
  private async waitForExecutionFinality(transactionHash: string, guard: RuntimeGuard): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.setView({ executionOp: { ...this.view.executionOp, phase: "pending", transactionHash, message: null } });
    const result = await this.pollTransactionPhase(transactionHash, guard, session.provider);
    if (!result) return;
    this.setView({
      executionOp: {
        ...this.view.executionOp,
        phase: result.phase,
        transactionHash,
        message: result.phase === "reverted" ? "Private execution reverted on-chain." : result.message,
      },
    });
  }
}