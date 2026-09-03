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
 * VIEWING-KEY DERIVATION (documented construction):
 *   viewingKey = canonicalize( poseidon( masterSecretScalar, starknetKeccak(domain) ) )
 *   domain     = "ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1:<network>"
 *
 *   - input key material: the wallet's master signing secret (the same scalar that owns the
 *     Ready/Braavos account). Deterministic per wallet, so the same wallet reproduces the same
 *     viewing key after every unlock (privacy state is recoverable). Different wallets (or a
 *     different secret) produce different keys.
 *   - domain separation: a fixed Wallet Core domain string, network-scoped so the same wallet on
 *     two networks never shares a privacy identity (prevents wrong-network privacy state).
 *   - salt/context: none beyond the domain (determinism is required for recovery).
 *   - output: a bigint in the STRK20-accepted range `[1, MAX_VIEWING_KEY]` where
 *     `MAX_VIEWING_KEY = floor(STARK curve order / 2)` — the SDK/pool reject non-canonical keys
 *     (`PRIVATE_KEY_NOT_CANONICAL`). The canonical reduction reflects upper-half scalars to
 *     `n - k`, which preserves the derived public identity (curve symmetric about the x-axis).
 *
 * SECURITY:
 *   - the viewing key is derived in memory from the in-memory session secret and is NEVER
 *     persisted, logged, sent to Privy, or sent to any backend;
 *   - it lives only inside a `WalletPrivacySession`; locking the wallet discards the session (and
 *     with it the viewing key); unlocking re-derives it;
 *   - it is never placed in `PrivateIdentity` persistence.
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

/** True when the proving/discovery infrastructure is configured (otherwise privacy is unavailable). */
export function resolveWalletPrivacyConfig(network: WalletNetworkId, env: Record<string, string | undefined> = process.env): WalletPrivacyConfig | null {
  const proverUrl = (env.NEXT_PUBLIC_STRK20_PROVER_URL ?? "").trim();
  const discoveryUrl = (env.NEXT_PUBLIC_STRK20_DISCOVERY_URL ?? "").trim();
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

/**
 * Wallet-native STRK20 privacy session — bound to one unlocked wallet on one network.
 * Holds the derived viewing key in memory for the lifetime of the session only.
 */
export class WalletPrivacySession {
  private readonly wallet: UnlockedWallet;
  private readonly network: WalletNetworkId;
  private readonly viewingKey: bigint;
  private readonly adapter: Strk20Adapter;
  private readonly storage: WalletStorage;

  constructor(wallet: UnlockedWallet, network: WalletNetworkId, config: WalletPrivacyConfig, storage: WalletStorage) {
    this.wallet = wallet;
    this.network = network;
    this.viewingKey = deriveWalletViewingKey(wallet.secret, network);
    this.storage = storage;
    const chainId =
      network === "mainnet" ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
    this.adapter = new Strk20Adapter({
      poolContractAddress: config.poolContractAddress,
      chainId,
      proverUrl: config.proverUrl,
      discoveryUrl: config.discoveryUrl,
      feeTokenAddress: config.feeTokenAddress,
    });
  }

  /** In-memory viewing key — internal only; never exposed through runtime state. */
  getViewingKey(): bigint {
    return this.viewingKey;
  }

  private user(): Strk20User {
    return {
      account: this.wallet.account,
      address: this.wallet.address,
      viewingKey: this.viewingKey,
    };
  }

  async getPrivateBalance(token: string): Promise<bigint> {
    return this.adapter.getPrivateBalance(this.user(), token);
  }

  async shield(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    const receipt = await this.adapter.shield(this.user(), token, amountBase);
    return toSafeResult(receipt);
  }

  async privateTransfer(token: string, amountBase: bigint, recipient: string): Promise<PrivacyOperationResult> {
    const receipt = await this.adapter.transfer(this.user(), token, amountBase, recipient);
    return toSafeResult(receipt);
  }

  async withdraw(token: string, amountBase: bigint): Promise<PrivacyOperationResult> {
    const receipt = await this.adapter.unshield(this.user(), token, amountBase);
    return toSafeResult(receipt);
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
        viewingKey: this.viewingKey,
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