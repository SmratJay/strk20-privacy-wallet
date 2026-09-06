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
import {
  PrivateSwapService,
  IDLE_PRIVATE_SWAP,
  type PrivateSwapIntent,
  type PrivateSwapOpState,
  type PrivateSwapQuote,
  type PrivateSwapReceipt,
} from "@/features/private-swap";
import {
  NearIntentAdapter,
  nearIntentPhaseForStatus,
  IDLE_NEAR_INTENT,
  type CrossChainPrivateIntent,
  type CrossChainNetworkConfig,
  type NearIntentOpState,
  type NearIntentPrepared,
  type NearIntentQuote,
  type NearIntentReceipt,
  type NearIntentReadiness,
  type NearIntentStatus,
} from "@/features/near-intents";
import {
  PrivacyHub,
  NearIntentProvider,
  type PrivacyHubIntent,
  type PrivacyHubQuote,
  type PrivacyHubReceipt,
  type PrivacyHubStatus,
} from "@/features/privacy-hub";

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
  /** Honest lifecycle of the latest PRIVATE SWAP (shadow-account swap application action). */
  swapOp: PrivateSwapOpState;
  /** Honest lifecycle of the latest PRIVATE CROSS-CHAIN intent (NEAR Intents routing). */
  nearIntentOp: NearIntentOpState;
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
  /** TEST SEAM ONLY: inject a cross-chain network config (to force settlement in tests). */
  crossChainConfig?: CrossChainNetworkConfig | null;
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
  /** TEST SEAM ONLY: cross-chain network config override (never a public-execution fallback). */
  private readonly crossChainConfig: CrossChainNetworkConfig | null;
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
    this.crossChainConfig = options.crossChainConfig ?? null;
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
      swapOp: IDLE_PRIVATE_SWAP,
      nearIntentOp: IDLE_NEAR_INTENT,
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
      swapOp: IDLE_PRIVATE_SWAP,
      nearIntentOp: IDLE_NEAR_INTENT,
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
      swapOp: IDLE_PRIVATE_SWAP,
      nearIntentOp: IDLE_NEAR_INTENT,
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
      swapOp: IDLE_PRIVATE_SWAP,
      nearIntentOp: IDLE_NEAR_INTENT,
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
      swapOp: IDLE_PRIVATE_SWAP,
      nearIntentOp: IDLE_NEAR_INTENT,
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

  // ─────────────────────────── Private swap (feature-level consumer) ───────────────────────────

  /**
   * Fetch a REAL on-chain private-swap quote for the active wallet (bound to the live application
   * state + pair + amount). Never trusts a UI-supplied output amount. The effective private
   * execution fee is surfaced here so the UI can show it before confirmation.
   */
  async quotePrivateSwap(intent: PrivateSwapIntent): Promise<PrivateSwapQuote> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to quote a private swap.");
    const privacy = this.requirePrivacySession();
    const service = new PrivateSwapService({ wallet: session, privacySession: privacy, network: this.view.network });
    return service.quote(intent);
  }

  /**
   * Execute a REAL private swap through the existing shadow-account path (feature consumer).
   *
   *   private STRK → shadow identity → real shadow account → swap application → private result
   *
   * The swap feature produces the exact application calls; the EXISTING shadow path
   * (`WalletPrivacySession.executeShadowApplication` → `shadowAccountInvoke` →
   * `shadowAccounts(appName).invoke` → private paymaster) executes them. The root wallet is never
   * the swap application's caller, never the outer tx sender.
   *
   * Lifecycle (visible in `swapOp`):
   *   quoting → preparing → funding → proving → relaying → pending → success / reverted / rejected /
   *   failed / unknown. Success is NEVER claimed before on-chain reconciliation; an unknown
   *   paymaster submission is reported honestly, never as success.
   */
  async executePrivateSwap(intent: PrivateSwapIntent, confirmedQuote?: PrivateSwapQuote): Promise<PrivateSwapReceipt> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to swap privately.");
    const privacy = this.requirePrivacySession();
    const guard = this.captureGuard();
    const appName = intent.appName.trim();
    const sellSymbol = this.tokenSymbolFor(intent.sellToken);
    const buySymbol = this.tokenSymbolFor(intent.buyToken);
    this.setView({
      swapOp: {
        phase: "quoting",
        sellTokenSymbol: sellSymbol,
        buyTokenSymbol: buySymbol,
        sellAmount: intent.sellAmount,
        minOutput: confirmedQuote?.minOutput ?? null,
        estimatedBuy: confirmedQuote?.buyAmount ?? null,
        feeStrk: confirmedQuote?.feeStrk ?? null,
        appName,
        nonce: intent.nonce.toString(),
        swapContract: confirmedQuote?.swapContract ?? null,
        shadowAddress: null,
        transactionHash: null,
        message: null,
      },
      error: null,
    });
    try {
      // The service re-quotes and re-validates right before proving; a stale quote throws here.
      const service = new PrivateSwapService({ wallet: session, privacySession: privacy, network: this.view.network });
      this.setView({ swapOp: { ...this.view.swapOp, phase: "preparing" } });
      const receipt = await service.execute(intent, confirmedQuote);
      if (!this.isCurrent(guard)) return receipt;
      this.setView({
        swapOp: {
          ...this.view.swapOp,
          phase: "pending",
          swapContract: receipt.swapContract,
          shadowAddress: receipt.shadowAddress,
          transactionHash: receipt.transactionHash,
          minOutput: receipt.minOutput,
          message: null,
        },
        recentTransactions: [
          { hash: receipt.transactionHash, at: Date.now(), kind: "privateTransfer" as const },
          ...this.view.recentTransactions,
        ].slice(0, 20),
      });
      await this.waitForSwapFinality(receipt.transactionHash, guard);
      return receipt;
    } catch (err) {
      if (!this.isCurrent(guard)) throw err;
      const unknown = err instanceof Error && /unknown|reconcile|unreachable|unreadable/i.test(err.message);
      this.setView({
        swapOp: {
          ...this.view.swapOp,
          phase: unknown ? "unknown" : "failed",
          message: err instanceof Error ? err.message : "Private swap failed.",
        },
      });
      throw err;
    }
  }

  /** Poll the RPC for the final status of a submitted private swap. Honest: never fabricates success. */
  private async waitForSwapFinality(transactionHash: string, guard: RuntimeGuard): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.setView({ swapOp: { ...this.view.swapOp, phase: "pending", transactionHash, message: null } });
    const result = await this.pollTransactionPhase(transactionHash, guard, session.provider);
    if (!result) return;
    this.setView({
      swapOp: {
        ...this.view.swapOp,
        phase: result.phase,
        transactionHash,
        message: result.phase === "reverted" ? "Private swap reverted on-chain." : result.message,
      },
    });
  }

  // ─────────────────────── Private cross-chain (NEAR Intents routing) ───────────────────────

  private requireNearIntentAdapter(): NearIntentAdapter {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to route cross-chain intents.");
    const privacy = this.requirePrivacySession();
    return new NearIntentAdapter({
      wallet: session,
      privacySession: privacy,
      network: this.view.network,
      config: this.crossChainConfig ?? undefined,
    });
  }

  /**
   * Fetch a REAL dry cross-chain quote from the NEAR Intents 1Click API (pricing only, no deposit
   * address reserved). The quote is bound to the route + amount + destination address and never
   * trusted from the UI.
   */
  async quoteCrossChain(intent: CrossChainPrivateIntent): Promise<NearIntentQuote> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to quote cross-chain intents.");
    const adapter = this.requireNearIntentAdapter();
    return adapter.quote(intent);
  }

  /** RESERVE a NEAR Intents deposit address (publish step) for a confirmed cross-chain quote. */
  async createCrossChainIntent(
    intent: CrossChainPrivateIntent,
    confirmedQuote?: NearIntentQuote,
  ): Promise<NearIntentPrepared> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to create cross-chain intents.");
    const guard = this.captureGuard();
    const adapter = this.requireNearIntentAdapter();
    const prepared = await adapter.createIntent(intent, confirmedQuote);
    if (!this.isCurrent(guard)) return prepared;
    this.setView({
      nearIntentOp: {
        ...IDLE_NEAR_INTENT,
        phase: "intent-created",
        sourceSymbol: intent.sourceAsset.toUpperCase(),
        destinationSymbol: intent.destinationAsset.toUpperCase(),
        sourceAmount: intent.sourceAmount,
        amountOut: prepared.amountOut,
        depositAddress: prepared.depositAddress,
        destinationAddress: intent.destinationAddress,
        message: null,
      },
      error: null,
    });
    return prepared;
  }

  /** Poll the NEAR Intents status for a deposit address (reconcile without re-executing). */
  async getCrossChainStatus(depositAddress: string): Promise<NearIntentStatus> {
    const adapter = this.requireNearIntentAdapter();
    return adapter.status(depositAddress);
  }

  /**
   * LIVE cross-chain readiness check (pre-flight). Returns a structured result WITHOUT funding —
   * the caller (UI/preflight) can stop before any deposit is created/funded. Never a public fallback.
   */
  async checkCrossChainReadiness(intent: CrossChainPrivateIntent): Promise<NearIntentReadiness> {
    const adapter = this.requireNearIntentAdapter();
    return adapter.checkReadiness(intent);
  }

  // ─────────────────────── Cross-chain PrivacyHub (orchestration bridge) ───────────────────────

  /**
   * The PrivacyHub orchestrates a typed hub intent over the EXISTING near-intents provider. This
   * bridge is thin and headless: it returns plain results and owns no route/provider/destination
   * logic (all of that lives in `src/features/privacy-hub`). Reuses the near-intents adapter.
   */
  private requirePrivacyHub(): PrivacyHub {
    const adapter = this.requireNearIntentAdapter();
    return new PrivacyHub({ providers: { "near-intents": new NearIntentProvider(adapter) } });
  }

  async quotePrivacyHub(intent: PrivacyHubIntent): Promise<PrivacyHubQuote> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to quote cross-chain intents.");
    const hub = this.requirePrivacyHub();
    return hub.quote(intent);
  }

  async executePrivacyHub(intent: PrivacyHubIntent, quote?: PrivacyHubQuote): Promise<PrivacyHubReceipt> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to execute cross-chain intents.");
    const hub = this.requirePrivacyHub();
    const prepared = await hub.prepare(intent, quote ?? null);
    return hub.execute(intent, prepared);
  }

  async getPrivacyHubStatus(reference: string, providerId?: string): Promise<PrivacyHubStatus> {
    const hub = this.requirePrivacyHub();
    return hub.status(reference, providerId);
  }

  /**
   * Execute a REAL cross-chain intent: the shadow account transfers private STRK to the reserved
   * NEAR Intents deposit address, then the runtime tracks the NEAR settlement to a terminal state.
   *
   *   private STRK → shadow identity → shadow account → NEAR deposit → solver → USDC (Base)
   *
   * The root wallet is never the on-chain depositor (the shadow account is); the outer tx is
   * relayed by the private paymaster; NEAR is routing/settlement only (privacy stays in STRK20).
   *
   * Lifecycle (visible in `nearIntentOp`):
   *   preparing → awaiting-source-deposit → source-confirming → solver-executing
   *     → success / refunded / failed / unknown
   * Success is NEVER claimed before the NEAR service reconciles destination settlement (SUCCESS).
   */
  async executeCrossChainIntent(
    intent: CrossChainPrivateIntent,
    prepared: NearIntentPrepared,
    options?: { trackTimeoutMs?: number; pollMs?: number },
  ): Promise<NearIntentReceipt> {
    const session = this.session;
    if (!session) throw new Error("Wallet is locked. Unlock it to execute cross-chain intents.");
    const adapter = this.requireNearIntentAdapter();
    const guard = this.captureGuard();
    this.setView({
      nearIntentOp: {
        ...IDLE_NEAR_INTENT,
        phase: "preparing",
        sourceSymbol: intent.sourceAsset.toUpperCase(),
        destinationSymbol: intent.destinationAsset.toUpperCase(),
        sourceAmount: intent.sourceAmount,
        amountOut: prepared.amountOut ?? null,
        depositAddress: prepared.depositAddress ?? null,
        destinationAddress: intent.destinationAddress,
        message: null,
      },
      error: null,
    });
    try {
      const receipt = await adapter.execute(intent, prepared, {
        trackTimeoutMs: options?.trackTimeoutMs,
        pollMs: options?.pollMs,
        onPhase: (update) => {
          if (!this.isCurrent(guard)) return;
          this.setView({
            nearIntentOp: {
              ...this.view.nearIntentOp,
              phase: update.phase,
              status: update.status ?? this.view.nearIntentOp.status,
              amountOut: update.amountOut ?? this.view.nearIntentOp.amountOut,
              message: null,
            },
          });
        },
      });
      if (!this.isCurrent(guard)) return receipt;
      const refunded = receipt.status === "REFUNDED" || receipt.status === "INCOMPLETE_DEPOSIT" || receipt.status === "FAILED";
      this.setView({
        nearIntentOp: {
          ...this.view.nearIntentOp,
          phase: nearIntentPhaseForStatus(receipt.status),
          depositAddress: receipt.depositAddress,
          destinationAddress: receipt.destinationAddress,
          amountOut: receipt.amountOut,
          shadowAddress: receipt.shadowAddress,
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          destinationTxHashes: receipt.destinationChainTxHashes,
          refundedAmount: refunded ? (receipt.refundedAmount > 0n ? receipt.refundedAmount : receipt.sourceAmount) : null,
          refundReason: receipt.refundReason,
          message:
            receipt.status === "REFUNDED"
              ? "Refunded to the Shadow Account — recovery required (not yet returned to the private balance)."
              : refunded
                ? "Swap failed; recovery to the Shadow Account required."
                : null,
        },
        recentTransactions: [
          { hash: receipt.transactionHash, at: Date.now(), kind: "privateTransfer" as const },
          ...this.view.recentTransactions,
        ].slice(0, 20),
      });
      return receipt;
    } catch (err) {
      if (!this.isCurrent(guard)) throw err;
      const unknown = err instanceof Error && /reconcile|settle within|could not reconcile/i.test(err.message);
      this.setView({
        nearIntentOp: {
          ...this.view.nearIntentOp,
          phase: unknown ? "unknown" : "failed",
          message: err instanceof Error ? err.message : "Cross-chain intent failed.",
        },
      });
      throw err;
    }
  }
}
