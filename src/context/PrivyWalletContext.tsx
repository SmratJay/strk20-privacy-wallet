"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Account, RpcProvider, constants } from "starknet";
import { usePrivy } from "@privy-io/react-auth";
import { StarknetAccountAdapter, fetchSigningClient } from "@/privacy/privy";
import {
  computeReadyAccountAddress,
  deployReadyAccount,
  isAccountDeployed,
  waitForDeploymentFinality,
} from "@/privacy/privy/ready";
import { PrivyStrk20Adapter, type Strk20ExecuteReceipt } from "@/privacy/adapter";
import {
  STRK_TOKEN_ADDRESS,
  type ApprovalStatus,
} from "@/privacy/privy/allowance";
import type { PrivateCurveTradeParams } from "@/privacy/adapter";
import { loadOrCreateViewingKey } from "@/privacy/privy/viewingKeyStore";
import { withRetry } from "@/privacy/privy/statusProbe";
import { getNetworkConfig, normalizeEndpointUrl } from "@/config/networks";
import { waitForStrk20Confirmation } from "@/services/strk20WalletApiService";

const SEPOLIA_POOL =
  process.env.NEXT_PUBLIC_STRK20_SEPOLIA_POOL ||
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const PROVER_URL = normalizeEndpointUrl(process.env.NEXT_PUBLIC_STRK20_PROVER_URL);
const DISCOVERY_URL = normalizeEndpointUrl(process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL);

/** How many times to retry a transient discovery failure (e.g. 503) before surfacing "error". */
const STATUS_RETRY_ATTEMPTS = 3;
/** Base backoff (ms) between privacy-status retries. */
const STATUS_RETRY_BASE_MS = 500;
/** Delay before a bounded background re-verify of privacy status (indexer catch-up). */
const STATUS_REVERIFY_DELAY_MS = 5000;

interface ResolvedWallet {
  id: string;
  address: string;
  publicKey: string;
}

/** Lifecycle of the derived Ready account's on-chain deployment. */
export type DeployStatus =
  | "UNKNOWN"
  | "NOT_DEPLOYED"
  | "DEPLOYING"
  | "FINALIZING"
  | "READY"
  | "ERROR";

/** Authoritative account-deployment status, reconciled against on-chain state. */
export type AccountStatus = "unknown" | "not_deployed" | "pending" | "enabled" | "error";

/** Authoritative STRK20 privacy-registration status, reconciled against pool state. */
export type PrivacyStatus = "unknown" | "disabled" | "pending" | "enabled" | "error";

export interface PrivyWalletContextValue {
  isAvailable: boolean;
  ready: boolean;
  authenticated: boolean;
  isConnecting: boolean;
  error: string | null;
  address: string | null;
  account: Account | null;
  viewingKey: bigint | null;
  /** True after the STRK20 viewing key has been registered on-chain for this user. */
  privateReceivingEnabled: boolean;
  /** Deployment lifecycle of the derived Ready account. */
  deployStatus: DeployStatus;
  /** True once the Ready account is deployed AND finalized (~10 blocks). */
  deployed: boolean;
  deploying: boolean;
  deployError: string | null;
  /** STRK allowance prerequisite progress (approving STRK for the privacy pool). */
  approvalStatus: ApprovalStatus;
  /** Authoritative account-deployment status (unknown/not_deployed/pending/enabled/error). */
  accountStatus: AccountStatus;
  /** Authoritative STRK20 privacy-registration status (unknown/disabled/pending/enabled/error). */
  privacyStatus: PrivacyStatus;
  /** Re-detect whether the derived Ready account is deployed on-chain. */
  refreshAccountDeploymentStatus: () => Promise<void>;
  /** Re-detect whether the STRK20 viewing key is registered in the pool. */
  refreshPrivacyRegistrationStatus: () => Promise<void>;
  /** Deploy the derived Ready account (if not deployed) and reconcile against chain state. */
  enableAccount: () => Promise<boolean>;
  /** Register the STRK20 viewing key in the pool (after ensuring the account is deployed). */
  enablePrivacy: () => Promise<boolean>;
  login: (opts?: { email?: string; google?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  /** Deploy the derived Ready account if not already deployed. Resolves true when READY. */
  deploy: () => Promise<boolean>;
  shield: (token: string, amountBase: bigint) => Promise<Strk20ExecuteReceipt>;
  unshield: (token: string, amountBase: bigint, recipient: string) => Promise<Strk20ExecuteReceipt>;
  transfer: (token: string, amountBase: bigint, recipient: string) => Promise<Strk20ExecuteReceipt>;
  /** Private trade through a launchpad PrivateCurveExecutor (curve BUY/SELL via STRK20). */
  privateTrade: (params: PrivateCurveTradeParams) => Promise<Strk20ExecuteReceipt>;
  register: () => Promise<Strk20ExecuteReceipt>;
  getPrivateBalance: (token: string) => Promise<bigint>;
}

const UNAVAILABLE: PrivyWalletContextValue = {
  isAvailable: false,
  ready: false,
  authenticated: false,
  isConnecting: false,
  error: null,
  address: null,
  account: null,
  viewingKey: null,
  privateReceivingEnabled: false,
  deployStatus: "UNKNOWN",
  deployed: false,
  deploying: false,
  deployError: null,
  approvalStatus: "idle",
  accountStatus: "unknown",
  privacyStatus: "unknown",
  refreshAccountDeploymentStatus: async () => {},
  refreshPrivacyRegistrationStatus: async () => {},
  enableAccount: async () => { throw new Error("Privy is not configured."); },
  enablePrivacy: async () => { throw new Error("Privy is not configured."); },
  login: async () => {},
  logout: async () => {},
  deploy: async () => { throw new Error("Privy is not configured."); },
  shield: async () => { throw new Error("Privy is not configured."); },
  unshield: async () => { throw new Error("Privy is not configured."); },
  transfer: async () => { throw new Error("Privy is not configured."); },
  privateTrade: async () => { throw new Error("Privy is not configured."); },
  register: async () => { throw new Error("Privy is not configured."); },
  getPrivateBalance: async () => { throw new Error("Privy is not configured."); },
};

const PrivyWalletContext = createContext<PrivyWalletContextValue>(UNAVAILABLE);

async function resolveStarknetWallet(userId: string, token: string): Promise<ResolvedWallet> {
  const cacheKey = `pel_privy_wallet_${userId.toLowerCase()}`;

  try {
    const cached = typeof localStorage !== "undefined" ? localStorage.getItem(cacheKey) : null;
    if (cached) {
      const parsed = JSON.parse(cached) as ResolvedWallet;
      if (parsed.id && parsed.address && parsed.publicKey) return parsed;
    }
  } catch {
    // Ignore corrupt cache; fall through to create.
  }

  const res = await fetch("/api/privy/wallet", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to resolve Privy Starknet wallet (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { wallet?: { id?: unknown; publicKey?: unknown } };
  const wallet = json?.wallet;
  if (!wallet || typeof wallet.id !== "string") {
    throw new Error("Privy Starknet wallet response missing id.");
  }
  const publicKey = typeof wallet.publicKey === "string" ? wallet.publicKey : "";
  if (!publicKey) throw new Error("Privy Starknet wallet response missing public key.");
  // The real on-chain account is the DERIVED Ready address (NOT Privy wallet.address).
  const address = computeReadyAccountAddress(publicKey);
  const result: ResolvedWallet = { id: wallet.id, address, publicKey };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch {
    // Cache write is best-effort.
  }
  return result;
}

function buildAdapter(onApprovalStatus?: (status: ApprovalStatus) => void): PrivyStrk20Adapter {
  return new PrivyStrk20Adapter({
    poolContractAddress: SEPOLIA_POOL,
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    proverUrl: PROVER_URL,
    discoveryUrl: DISCOVERY_URL,
    feeTokenAddress: STRK_TOKEN_ADDRESS,
    onApprovalStatus,
  });
}

const PrivyWalletInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { ready, authenticated, user, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();

  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privateReceivingEnabled, setPrivateReceivingEnabled] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle");
  const [resolved, setResolved] = useState<{
    walletId: string;
    address: string;
    publicKey: string;
    account: Account;
    provider: RpcProvider;
    viewingKey: bigint;
  } | null>(null);

  // Deployment lifecycle state (mirrored in refs so async callbacks read fresh values).
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("UNKNOWN");
  const [deployError, setDeployError] = useState<string | null>(null);
  const deployStatusRef = useRef<DeployStatus>("UNKNOWN");
  const deployErrorRef = useRef<string | null>(null);
  const deployPromiseRef = useRef<Promise<boolean> | null>(null);
  const resolvedRef = useRef<typeof resolved>(null);
  resolvedRef.current = resolved;

  const setDeploy = (status: DeployStatus, err: string | null = null) => {
    deployStatusRef.current = status;
    deployErrorRef.current = err;
    setDeployStatus(status);
    setDeployError(err);
  };

  // Authoritative status state (mirrored in refs so async callbacks read fresh values).
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("unknown");
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus>("unknown");
  const accountStatusRef = useRef<AccountStatus>("unknown");
  const privacyStatusRef = useRef<PrivacyStatus>("unknown");
  const updateAccount = useCallback((s: AccountStatus) => {
    accountStatusRef.current = s;
    setAccountStatus(s);
  }, []);
  const updatePrivacy = useCallback((s: PrivacyStatus) => {
    privacyStatusRef.current = s;
    setPrivacyStatus(s);
  }, []);

  /** Re-detect account deployment from on-chain class-hash state (not React/localStorage). */
  const refreshAccountDeploymentStatus = useCallback(async (): Promise<void> => {
    const r = resolvedRef.current;
    if (!r) {
      updateAccount("unknown");
      return;
    }
    try {
      const deployed = await isAccountDeployed(r.provider, r.address);
      updateAccount(deployed ? "enabled" : "not_deployed");
    } catch {
      updateAccount("error");
    }
  }, [updateAccount]);

  /** Re-detect privacy registration from the pool's preflight/discovery state, with bounded
   *  retries so a transient 503 does not surface as a hard error. Never maps a discovery
   *  failure to "disabled" (that would cause spurious re-registration attempts). */
  const refreshPrivacyRegistrationStatus = useCallback(async (): Promise<void> => {
    const r = resolvedRef.current;
    if (!r) {
      updatePrivacy("unknown");
      return;
    }
    const user = { account: r.account, address: r.address, viewingKey: r.viewingKey };
    try {
      const registration = await withRetry(
        () => buildAdapter().getPrivacyRegistration(user, STRK_TOKEN_ADDRESS),
        STATUS_RETRY_ATTEMPTS,
        STATUS_RETRY_BASE_MS,
      );
      const enabled = registration === "registered";
      updatePrivacy(enabled ? "enabled" : "disabled");
      setPrivateReceivingEnabled(enabled);
    } catch {
      // Exhausted retries — surface as unknown/unavailable, never "disabled".
      updatePrivacy("error");
    }
  }, [updatePrivacy]);

  // Bounded background re-verify of privacy status (used after a confirmed registration whose
  // immediate reconciliation hit a transient discovery 503).
  const privacyReverifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePrivacyReverify = useCallback(() => {
    if (privacyReverifyTimerRef.current) clearTimeout(privacyReverifyTimerRef.current);
    privacyReverifyTimerRef.current = setTimeout(() => {
      privacyReverifyTimerRef.current = null;
      if (privacyStatusRef.current !== "enabled" && privacyStatusRef.current !== "disabled") {
        void refreshPrivacyRegistrationStatus();
      }
    }, STATUS_REVERIFY_DELAY_MS);
  }, [refreshPrivacyRegistrationStatus]);

  // Clear any pending re-verify timer on unmount.
  useEffect(() => {
    return () => {
      if (privacyReverifyTimerRef.current) clearTimeout(privacyReverifyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Privy access token unavailable.");
        const wallet = await resolveStarknetWallet(user.id, token);
        const signingClient = fetchSigningClient("/api/privy/sign", () => getAccessToken());
        const provider = new RpcProvider({ nodeUrl: getNetworkConfig("sepolia").rpcUrls[0] });
        const account = StarknetAccountAdapter.create({
          address: wallet.address,
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          client: signingClient,
          provider,
        });
        const viewingKey = await loadOrCreateViewingKey(user.id, wallet.id, signingClient);
        if (!cancelled) {
          setResolved({ walletId: wallet.id, address: wallet.address, publicKey: wallet.publicKey, account, provider, viewingKey });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Privy wallet setup failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, user?.id, getAccessToken]);

  // Detect whether the derived Ready account is already deployed on-chain.
  useEffect(() => {
    if (!resolved) {
      setDeploy("UNKNOWN");
      updateAccount("unknown");
      updatePrivacy("unknown");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const deployed = await isAccountDeployed(resolved.provider, resolved.address);
        if (!cancelled) {
          setDeploy(deployed ? "READY" : "NOT_DEPLOYED");
          updateAccount(deployed ? "enabled" : "not_deployed");
        }
      } catch {
        if (!cancelled) {
          setDeploy("UNKNOWN");
          updateAccount("unknown");
        }
      }
      // Reconstruct privacy registration from the pool regardless of account state.
      await refreshPrivacyRegistrationStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved, updateAccount, updatePrivacy, refreshPrivacyRegistrationStatus]);

  /**
   * Deploy the derived Ready account via DEPLOY_ACCOUNT (signed through the existing Privy
   * `/api/privy/sign` path), wait for confirmation, then wait ~10 blocks before marking it
   * READY. Safe to call repeatedly: it re-checks on-chain state and dedupes concurrent calls.
   */
  const deploy = useCallback(async (): Promise<boolean> => {
    if (deployPromiseRef.current) return deployPromiseRef.current;
    const r = resolvedRef.current;
    if (!r) throw new Error("Privy wallet is not ready. Connect first.");
    if (deployStatusRef.current === "READY") return true;

    const p = (async () => {
      setDeploy("DEPLOYING");
      try {
        if (await isAccountDeployed(r.provider, r.address)) {
          setDeploy("READY");
          return true;
        }
        const { transactionHash } = await deployReadyAccount(r.account, r.publicKey);
        const receipt = await r.provider.waitForTransaction(transactionHash, { retryInterval: 4000 });
        const exec = (receipt as any)?.execution_status ?? (receipt as any)?.status;
        if (exec === "REVERTED" || exec === "REJECTED") {
          throw new Error("Account deployment reverted on-chain.");
        }
        const deployedAtBlock = Number((receipt as any)?.block_number ?? 0);
        setDeploy("FINALIZING");
        await waitForDeploymentFinality(r.provider, deployedAtBlock);
        setDeploy("READY");
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Account deployment failed.";
        setDeploy("ERROR", msg);
        return false;
      } finally {
        deployPromiseRef.current = null;
      }
    })();
    deployPromiseRef.current = p;
    return p;
  }, []);

  /** Ensure the account is deployed + finalized before any on-chain STRK20 action. */
  const ensureReady = useCallback(async (): Promise<void> => {
    const r = resolvedRef.current;
    if (!r) throw new Error("Privy wallet is not ready. Connect first.");
    if (deployStatusRef.current === "READY") return;
    const ok = await deploy();
    if (!ok) {
      throw new Error(deployErrorRef.current || "Account deployment failed. Fund the account and retry.");
    }
  }, [deploy]);

  /**
   * Deploy/initialize the Starknet account (if not already deployed) and reconcile against
   * on-chain state. Unlike `deploy()`, a finality timeout does NOT produce a false "error" —
   * the account status is always re-read from the chain afterwards, so a successfully deployed
   * account reports `enabled` even if the ~10-block finality wait did not complete.
   */
  const enableAccount = useCallback(async (): Promise<boolean> => {
    const r = resolvedRef.current;
    if (!r) throw new Error("Privy wallet is not ready. Connect first.");
    const alreadyEnabled = accountStatusRef.current === "enabled";
    if (alreadyEnabled) return true;
    updateAccount("pending");
    try {
      await deploy();
    } catch {
      // Reconcile against chain state below regardless of the deploy helper's outcome.
    }
    await refreshAccountDeploymentStatus();
    return accountStatusRef.current === "enabled";
  }, [deploy, updateAccount, refreshAccountDeploymentStatus]);

  const login = useCallback(
    async (opts?: { email?: string; google?: boolean }) => {
      setError(null);
      setIsConnecting(true);
      try {
        if (opts?.google) {
          privyLogin({ loginMethods: ["google"] });
        } else if (opts?.email) {
          privyLogin({ prefill: { type: "email", value: opts.email } });
        } else {
          privyLogin();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Privy login failed.");
      } finally {
        setIsConnecting(false);
      }
    },
    [privyLogin],
  );

  const logout = useCallback(async () => {
    setResolved(null);
    setPrivateReceivingEnabled(false);
    deployPromiseRef.current = null;
    setDeploy("UNKNOWN");
    updateAccount("unknown");
    updatePrivacy("unknown");
    await privyLogout();
  }, [privyLogout, updateAccount, updatePrivacy]);

  const requireReady = useCallback((): { account: Account; address: string; viewingKey: bigint } => {
    if (!resolved) throw new Error("Privy wallet is not ready. Connect first.");
    return { account: resolved.account, address: resolved.address, viewingKey: resolved.viewingKey };
  }, [resolved]);

  const shield = useCallback(
    async (token: string, amountBase: bigint) => {
      await ensureReady();
      const user = requireReady();
      setApprovalStatus("idle");
      return buildAdapter((s) => setApprovalStatus(s)).shield(user, token, amountBase);
    },
    [requireReady, ensureReady],
  );

  const unshield = useCallback(
    async (token: string, amountBase: bigint, recipient: string) => {
      await ensureReady();
      const user = requireReady();
      setApprovalStatus("idle");
      return buildAdapter((s) => setApprovalStatus(s)).unshield(user, token, amountBase);
    },
    [requireReady, ensureReady],
  );

  const transfer = useCallback(
    async (token: string, amountBase: bigint, recipient: string) => {
      await ensureReady();
      const user = requireReady();
      setApprovalStatus("idle");
      return buildAdapter((s) => setApprovalStatus(s)).transfer(user, token, amountBase, recipient);
    },
    [requireReady, ensureReady],
  );

  const register = useCallback(async () => {
    await ensureReady();
    const user = requireReady();
    setApprovalStatus("idle");
    updatePrivacy("pending");
    // NOTE: no optimistic enable — `privateReceivingEnabled`/`privacyStatus` are only set to
    // "enabled" after `refreshPrivacyRegistrationStatus()` reconciles against the pool.
    const receipt = await buildAdapter((s) => setApprovalStatus(s)).register(user);
    return receipt;
  }, [requireReady, ensureReady, updatePrivacy]);

  /** Private curve trade through a launchpad PrivateCurveExecutor (Privy STRK20 lane). */
  const privateTrade = useCallback(
    async (params: PrivateCurveTradeParams) => {
      await ensureReady();
      const user = requireReady();
      setApprovalStatus("idle");
      return buildAdapter((s) => setApprovalStatus(s)).privateTrade(user, params);
    },
    [requireReady, ensureReady],
  );

  /**
   * Register the STRK20 viewing key in the privacy pool and reconcile against on-chain state.
   * Ensures the account is deployed first, submits the registration, waits for on-chain
   * acceptance, then re-reads the pool's registration state. A confirmed registration
   * transaction is treated as SUCCESS even if a later discovery refresh returns 503 — the
   * status is re-verified in the background (bounded) until the pool reports it as observable.
   */
  const enablePrivacy = useCallback(async (): Promise<boolean> => {
    const r = resolvedRef.current;
    if (!r) throw new Error("Privy wallet is not ready. Connect first.");

    // Privacy registration requires a deployed (and finalized) account.
    if (accountStatusRef.current !== "enabled") {
      const deployed = await enableAccount();
      if (!deployed) return false;
    }

    updatePrivacy("pending");
    setApprovalStatus("idle");

    let transactionHash: string;
    try {
      const user = requireReady();
      const receipt = await buildAdapter((s) => setApprovalStatus(s)).register(user);
      transactionHash = receipt.transactionHash;
    } catch {
      // The submit itself failed (before/at broadcast). Reconcile: if the pool already shows
      // registered (a prior attempt landed), treat as success; otherwise surface unavailable.
      await refreshPrivacyRegistrationStatus();
      if (privacyStatusRef.current === "enabled") return true;
      updatePrivacy("error");
      return false;
    }

    const result = await waitForStrk20Confirmation(transactionHash);
    if (result === "REVERTED") {
      updatePrivacy("disabled");
      return false;
    }

    // Confirmed (or still pending) on-chain — the transaction is NOT a failure. Reconcile the
    // authoritative pool state with bounded retries; a transient 503 here must not downgrade
    // the confirmed registration to a failure.
    await refreshPrivacyRegistrationStatus();
    if (privacyStatusRef.current === "enabled") return true;

    // Discovery is temporarily unavailable but the transaction succeeded: keep the transaction
    // successful and re-verify in the background (bounded) until it is observable.
    schedulePrivacyReverify();
    return true;
  }, [enableAccount, requireReady, updatePrivacy, refreshPrivacyRegistrationStatus, schedulePrivacyReverify]);

  const getPrivateBalance = useCallback(
    async (token: string) => {
      const user = requireReady();
      return buildAdapter().getPrivateBalance(user, token);
    },
    [requireReady],
  );

  const value = useMemo<PrivyWalletContextValue>(
    () => ({
      isAvailable: true,
      ready,
      authenticated,
      isConnecting,
      error,
      address: resolved?.address ?? null,
      account: resolved?.account ?? null,
      viewingKey: resolved?.viewingKey ?? null,
      privateReceivingEnabled,
      deployStatus,
      deployed: deployStatus === "READY",
      deploying: deployStatus === "DEPLOYING" || deployStatus === "FINALIZING",
      deployError,
      approvalStatus,
      accountStatus,
      privacyStatus,
      refreshAccountDeploymentStatus,
      refreshPrivacyRegistrationStatus,
      enableAccount,
      enablePrivacy,
      login,
      logout,
      deploy,
      shield,
      unshield,
      transfer,
      privateTrade,
      register,
      getPrivateBalance,
    }),
    [ready, authenticated, isConnecting, error, resolved, privateReceivingEnabled, deployStatus, deployError, approvalStatus, accountStatus, privacyStatus, refreshAccountDeploymentStatus, refreshPrivacyRegistrationStatus, enableAccount, enablePrivacy, login, logout, deploy, shield, unshield, transfer, privateTrade, register, getPrivateBalance],
  );

  return <PrivyWalletContext.Provider value={value}>{children}</PrivyWalletContext.Provider>;
};

export const PrivyWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <PrivyWalletContext.Provider value={UNAVAILABLE}>{children}</PrivyWalletContext.Provider>;
  return <PrivyWalletInner>{children}</PrivyWalletInner>;
};

export const usePrivyWallet = (): PrivyWalletContextValue => useContext(PrivyWalletContext);

export { waitForStrk20Confirmation };
