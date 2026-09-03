import { hash, ec, constants } from "starknet";
import { getNetworkConfig } from "@/config/networks";
import { Strk20Adapter, STRK_TOKEN_ADDRESS, type Strk20User, type Strk20ExecuteReceipt } from "@/privacy/strk20";
import { createPrivateIdentity, type PrivateIdentity } from "@/privacy/identity";
import type { UnlockedWallet, WalletNetworkId } from "./index";
import type { WalletStorage } from "./storage";

/**
 * Wallet Core — wallet-native STRK20 privacy.
 *
 * KEY HIERARCHY (never conflated):
 *   MASTER WALLET KEY    → controls the Starknet account (Wallet Core secret)
 *   STRK20 VIEWING KEY   → discovers/decrypts private notes (derived here, in memory only)
 *   EXECUTION IDENTITY   → isolates a specific privacy execution context (PrivateIdentity)
 *
 * VIEWING-KEY DERIVATION — FROZEN CONSTRUCTION
 *   Name:      ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1
 *   Formula:   viewingKey = canonicalize( poseidon( masterSecretScalar, starknetKeccak(domain) ) )
 *   domain     = "ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1:<network>"
 *
 *   Rationale: the STRK20 protocol REQUIRES a deterministically reproducible secret per wallet
 *   (privacy state — the registered viewing key, private notes — is recovered after every unlock),
 *   and the pool/sdk consume a field element. We retain and FREEZE this construction:
 *   - it is deterministic (same wallet + network ⇒ same key), so privacy state is recoverable;
 *   - changing it now would create a SECOND, incompatible derivation and orphan any wallet whose
 *     viewing key is already registered in the pool. A standard HKDF/HMAC-SHA-256 construction
 *     would be cryptographically defensible for NEW deployments but is intentionally NOT adopted
 *     here to preserve recovery for existing wallets. Do NOT introduce a second derivation.
 *
 *   Input key material: the wallet's master signing secret (the same scalar that owns the
 *     Ready/Braavos account). Deterministic per wallet; different wallets (or a different secret)
 *     produce different keys.
 *   Domain separation: a fixed Wallet Core domain string, hashed via starknetKeccak. The network
 *     is embedded in the domain so the same wallet on two networks never shares a privacy identity
 *     (prevents wrong-network privacy state).
 *   Network separation: `VIEWING_KEY_DOMAIN_PREFIX + ":" + network` — sepolia keys are distinct
 *     from mainnet keys for the same wallet.
 *   Salt/context: none beyond the domain (determinism is required for recovery).
 *   Output canonicalization: the poseidon output is reduced to the STRK20-accepted range
 *     `[1, floor(Stark curve order / 2)]` (`canonicalizeViewingKey`). The SDK/pool reject
 *     non-canonical keys (`PRIVATE_KEY_NOT_CANONICAL`). The upper-half reflection to `n - k`
 *     preserves the derived public identity (the curve is symmetric about the x-axis).
 *   Recovery behavior: the key is never persisted — it is re-derived from the decrypted master
 *     secret on every unlock, so privacy state survives reloads as long as the password is known.
 *
 * SECURITY:
 *   - the viewing key is derived in memory from the in-memory session secret and is NEVER
 *     persisted, logged, sent to Privy, or sent to any backend;
 *   - it lives only inside a `WalletPrivacySession`; locking the wallet discards the session (and
 *     with it the viewing key); unlocking re-derives it;
 *   - it is never placed in `PrivateIdentity` persistence;
 *   - it is not exposed through the runtime/UI state and has no public accessor on the session
 *     (the adapter receives it via an internal provider closure).
 */

export const VIEWING_KEY_DOMAIN_PREFIX = "ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1";

/** Canonicalize a scalar to the STRK20 viewing-key range `[1, floor(n/2)]`. */
export function canonicalizeViewingKey(k: bigint): bigint {
  const n = ec.starkCurve.CURVE.n;
  const max = n / 2n;
  let key = k % n;
  if (key === 0n) key = 1n;
  if (key > max) key = n - key;
  return key;
}

/** Domain separation for the viewing key: `PREFIX:<network>`, hashed via starknetKeccak. */
export function viewingKeyDomain(network: WalletNetworkId): bigint {
  return hash.starknetKeccak(`${VIEWING_KEY_DOMAIN_PREFIX}:${network}`);
}

/** Derive the wallet-native STRK20 viewing key from the master secret (deterministic). */
export function deriveWalletViewingKey(secret: string, network: WalletNetworkId): bigint {
  const scalar = BigInt(secret);
  const domain = viewingKeyDomain(network);
  return canonicalizeViewingKey(BigInt(hash.computePoseidonHash(scalar, domain)));
}

export interface WalletPrivacyConfig {
  poolContractAddress: string;
  proverUrl: string;
  discoveryUrl: string;
  feeTokenAddress?: string;
}

/**
 * True when the proving/discovery infrastructure is configured (otherwise privacy is unavailable).
 *
 * NOTE: env vars MUST be read via literal `process.env.NEXT_PUBLIC_*` member expressions so
 * Next.js can inline them into client bundles. Reading through an aliased `env = process.env`
 * parameter defeats that inlining and privacy would appear "unavailable" in the browser even
 * though the operator services are configured. An explicit `env` argument is still honored for
 * tests/deterministic probing.
 */
export function resolveWalletPrivacyConfig(
  network: WalletNetworkId,
  env?: Record<string, string | undefined>,
): WalletPrivacyConfig | null {
  const proverUrl = (env?.NEXT_PUBLIC_STRK20_PROVER_URL ?? process.env.NEXT_PUBLIC_STRK20_PROVER_URL ?? "").trim();
  const discoveryUrl = (env?.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? "").trim();
  if (!proverUrl || !discoveryUrl) return null;
  const pool = getNetworkConfig(network).poolAddress;
  return {
    poolContractAddress: pool,
    proverUrl: proverUrl.replace(/\/+$/, ""),
    discoveryUrl: discoveryUrl.replace(/\/+$/, ""),
    feeTokenAddress: STRK_TOKEN_ADDRESS,
  };
}

export interface PrivacyOperationResult {
  transactionHash: string;
  status: "PENDING" | "SUCCESS" | "REVERTED" | "REJECTED";
}

/** Options for a wallet-native privacy session. */
export interface WalletPrivacySessionOptions {
  /** UX callback fired while the STRK20 allowance prerequisite is being handled. */
  onApprovalStatus?: (status: import("@/privacy/strk20").ApprovalStatus) => void;
}

/**
 * Wallet-native STRK20 privacy session — bound to one unlocked wallet on one network.
 * Holds the derived viewing key in memory for the lifetime of the session only.
 *
 * PRIVACY-OPERATION SERIALIZATION: privacy operations that mutate pool state
 * (shield / privateTransfer / withdraw / register) are serialized through a single
 * async mutex so two operations can never race on the same session (a cached
 * private-transfers context or the pool nonce is shared state). Read-only balance
 * discovery is NOT serialized (it is safe to run concurrently and must remain fast).
 */
export class WalletPrivacySession {
  private readonly wallet: UnlockedWallet;
  private readonly network: WalletNetworkId;
  private readonly viewingKey: bigint;
  private readonly adapter: Strk20Adapter;
  private readonly storage: WalletStorage;
  private readonly onApprovalStatus?: (status: import("@/privacy/strk20").ApprovalStatus) => void;
  /** Async mutex tail — the smallest promise chain that serializes mutating privacy ops. */
  private opTail: Promise<unknown> = Promise.resolve();

  constructor(
    wallet: UnlockedWallet,
    network: WalletNetworkId,
    config: WalletPrivacyConfig,
    storage: WalletStorage,
    options: WalletPrivacySessionOptions = {},
  ) {
    this.wallet = wallet;
    this.network = network;
    this.viewingKey = deriveWalletViewingKey(wallet.secret, network);
    this.storage = storage;
    this.onApprovalStatus = options.onApprovalStatus;
    const chainId =
      network === "mainnet" ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
    this.adapter = new Strk20Adapter({
      poolContractAddress: config.poolContractAddress,
      chainId,
      proverUrl: config.proverUrl,
      discoveryUrl: config.discoveryUrl,
      feeTokenAddress: config.feeTokenAddress,
      onApprovalStatus: (status) => this.onApprovalStatus?.(status),
    });
  }

  /** Internal: the in-memory viewing key. NOT part of the public surface — see `__viewingKey`. */
  private get viewingKeyInternal(): bigint {
    return this.viewingKey;
  }

  private user(): Strk20User {
    return {
      account: this.wallet.account,
      address: this.wallet.address,
      viewingKey: this.viewingKeyInternal,
    };
  }

  /** Serialize a mutating privacy operation behind the session mutex. */
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.opTail.then(run, run);
    // Keep the tail alive even when the operation rejects, so a failure never wedges the queue.
    this.opTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async getPrivateBalance(token: string): Promise<bigint> {
    return this.adapter.getPrivateBalance(this.user(), token);
  }

  /** Authoritative on-chain registration state of this wallet's viewing key. */
  async getPrivacyRegistration(token: string): Promise<"registered" | "unregistered"> {
    return this.adapter.getPrivacyRegistration(this.user(), token);
  }

  shield(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.serialize(async () => {
      const receipt = await this.adapter.shield(this.user(), token, amountBase);
      return toSafeResult(receipt);
    });
  }

  privateTransfer(token: string, amountBase: bigint, recipient: string): Promise<PrivacyOperationResult> {
    return this.serialize(async () => {
      const receipt = await this.adapter.transfer(this.user(), token, amountBase, recipient);
      return toSafeResult(receipt);
    });
  }

  withdraw(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    return this.serialize(async () => {
      const receipt = await this.adapter.unshield(this.user(), token, amountBase);
      return toSafeResult(receipt);
    });
  }

  /** Create a PrivateIdentity for this wallet. The viewing key is consumed transiently, never stored. */
  async createPrivateIdentity(
    purpose: string,
    opts: { anonymizerAddress: string; poolContractAddress: string; dappName?: string },
  ): Promise<PrivateIdentity> {
    return createPrivateIdentity(
      {
        owner: this.wallet.address,
        purpose,
        chain: this.network,
        viewingKey: this.viewingKeyInternal,
        anonymizerAddress: opts.anonymizerAddress,
        poolContractAddress: opts.poolContractAddress,
        dappName: opts.dappName,
      },
      this.storage,
    );
  }

  /** Best-effort wipe of the in-memory viewing key when the session is discarded. */
  dispose(): void {
    (this as unknown as { viewingKey?: bigint }).viewingKey = 0n;
  }
}

function toSafeResult(receipt: Strk20ExecuteReceipt): PrivacyOperationResult {
  return { transactionHash: receipt.transactionHash, status: receipt.status };
}