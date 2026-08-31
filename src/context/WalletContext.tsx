'use client';

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { constants } from 'starknet';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { useNetwork } from '@/context/NetworkContext';
import { privacyService, ShieldedBalance, PrivacyTransaction } from '@/services/privacyService';
import {
  strk20WalletApiService,
  WalletApiStatus,
  WalletBalancePermission,
} from '@/services/strk20WalletApiService';
import { usePrivyWallet } from '@/context/PrivyWalletContext';

/**
 * Centralized wallet state for the consumer STRK20 privacy wallet (LANE A — Wallet API).
 *
 * PRIVATE-BALANCE LIFE-CYCLE (two concepts, kept completely separate):
 *
 *   A. AUTHORIZATION — `ensurePrivateBalanceAccess()`. Runs only when access is genuinely
 *      required (first connect, or an explicit user action). Sets `privateBalanceAccessStatus`
 *      to GRANTED / DENIED / UNKNOWN. Never runs on every balance read.
 *
 *   B. REFRESH / SYNC — `refreshPrivateBalance()`. A PURE read of `wallet_strk20Balances`.
 *      It NEVER calls the authorization path, so it can never re-trigger Ready's "Share
 *      private balances" prompt. Gated on `GRANTED`.
 *
 * Because B never authorizes, it is safe to call it:
 *   - after every mutation we control (shield / private transfer / withdraw), once the
 *     transaction confirms, and
 *   - on a modest polling interval to reconcile EXTERNAL incoming private payments
 *     (the Wallet API exposes no STRK20 balance-change subscription — see the spec note below).
 *
 * The private balance from the wallet (`wallet_strk20Balances`) remains the source of truth.
 * We never calculate it from local history and never fake optimistic balances.
 *
 * The privacy wallet (Ready) owns viewing keys, channels, notes, discovery, decryption, and
 * proofs. This app never touches them and never falls back to public ERC-20 transfers.
 */

type PrivateReceivingState = 'UNKNOWN' | 'READY' | 'NEEDS_REGISTRATION';

/** Detailed private-balance status for the UI. */
export type PrivateBalanceStatus =
  | 'IDLE'
  | 'LOADING'
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'NOT_AUTHORIZED'
  | 'NOT_READY';

interface WalletContextValue {
  wallet: ReturnType<typeof useStarknetWallet>;
  /** True when either the Ready wallet OR a Privy embedded wallet is connected. */
  privyConnected: boolean;
  networkId: ReturnType<typeof useNetwork>['networkId'];
  currentNetwork: ReturnType<typeof useNetwork>['currentNetwork'];
  isSepolia: boolean;
  setNetworkId: ReturnType<typeof useNetwork>['setNetworkId'];

  balances: ShieldedBalance[];
  isLoadingBalances: boolean;

  transactions: PrivacyTransaction[];
  recordTransaction: (tx: PrivacyTransaction) => void;
  clearTransactions: () => void;

  // A. Authorization (once)
  privateBalanceAccessStatus: WalletBalancePermission;
  privateBalancePermission: WalletBalancePermission; // alias (back-compat)
  ensurePrivateBalanceAccess: (opts?: { silent?: boolean }) => Promise<void>;
  requestPrivateBalanceAccess: (opts?: { silent?: boolean }) => Promise<void>; // alias

  // B. Refresh / sync (pure read, never authorizes)
  privateBalanceStatus: PrivateBalanceStatus;
  privateBalanceError: string | null;
  privateBalanceUpdatedAt: number | null;
  refreshPrivateBalance: () => Promise<void>;
  refreshPrivateBalances: () => Promise<void>; // alias
  refreshPublicBalances: () => Promise<void>;
  refreshAfterMutation: () => Promise<void>;

  walletApiStatus: WalletApiStatus | null;
  checkingStatus: boolean;
  refreshStatus: () => Promise<void>;

  privateReceivingState: PrivateReceivingState;
  setPrivateReceivingState: (s: PrivateReceivingState) => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

/** How often to reconcile external incoming private payments (Wallet API has no subscription). */
const PRIVATE_POLL_MS = 45000;

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wallet = useStarknetWallet();
  const privy = usePrivyWallet();
  const { networkId, currentNetwork, isSepolia, setNetworkId } = useNetwork();

  const [balances, setBalances] = useState<ShieldedBalance[]>(() =>
    currentNetwork.tokens.map((token) => ({
      token,
      publicBalance: 0n,
      publicBalanceAvailable: true,
      shieldedBalance: 0n,
      shieldedBalanceAvailable: false,
      pendingNotesCount: 0,
      privacyApiSupported: false,
    }))
  );
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [transactions, setTransactions] = useState<PrivacyTransaction[]>([]);

  // A. Authorization state (session-level "share private balances" consent).
  const [privateBalanceAccessStatus, setPrivateBalanceAccessStatus] =
    useState<WalletBalancePermission>('UNKNOWN');

  // B. Refresh state.
  const [privateBalanceStatus, setPrivateBalanceStatus] =
    useState<PrivateBalanceStatus>('IDLE');
  const [privateBalanceError, setPrivateBalanceError] = useState<string | null>(null);
  const [privateBalanceUpdatedAt, setPrivateBalanceUpdatedAt] = useState<number | null>(null);

  const [privateReceivingState, setPrivateReceivingState] =
    useState<PrivateReceivingState>('UNKNOWN');

  const [walletApiStatus, setWalletApiStatus] = useState<WalletApiStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Always-current wallet, read through a ref so callbacks don't re-create every render.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  // Treat a connected Privy embedded wallet as a connected wallet so the whole app (tabs,
  // gating, header) works for Privy users too. The Ready wallet lane remains authoritative
  // for its own flows.
  const privyConnected = privy.authenticated && privy.account !== null;
  const effectiveWallet = {
    ...wallet,
    isConnected: wallet.isConnected || privyConnected,
    address: wallet.address || privy.address,
    walletName: wallet.walletName || 'Privy',
    walletAccount: wallet.walletAccount || privy.account,
    isPrivacySupported: wallet.isPrivacySupported || privyConnected,
    walletApiVersion: wallet.walletApiVersion || (privyConnected ? 'privy' : null),
    rawWallet: wallet.rawWallet || (privyConnected ? { name: 'Privy' } : null),
  };

  // Guard so concurrent refreshes never overlap.
  const privateRefreshInFlightRef = useRef(false);
  const afterMutationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Network auto-sync: query balances against the network the wallet is actually on ──
  useEffect(() => {
    if (!wallet.isConnected || !wallet.chainId) return;
    try {
      const raw = String(wallet.chainId);
      const chainBig =
        typeof wallet.chainId === 'bigint'
          ? wallet.chainId
          : BigInt(raw.startsWith('0x') || raw.startsWith('0X') ? raw : '0x' + raw);
      setNetworkId(chainBig === BigInt(constants.StarknetChainId.SN_SEPOLIA) ? 'sepolia' : 'mainnet');
    } catch {
      // Ignore unparseable chainId; keep the current app network.
    }
  }, [wallet.isConnected, wallet.chainId, setNetworkId]);

  // ── Transaction history (local read cache, scoped by network) ──
  useEffect(() => {
    try {
      const storageKey = `strk20_privacy_txs_${networkId}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setTransactions(JSON.parse(stored));
      } else {
        const legacy = localStorage.getItem('strk20_privacy_txs');
        if (legacy && networkId === 'mainnet') {
          setTransactions(JSON.parse(legacy));
        } else {
          setTransactions([]);
        }
      }
    } catch {
      // Ignore storage read errors.
    }
  }, [networkId]);

  const saveTransactions = useCallback(
    (txs: PrivacyTransaction[]) => {
      setTransactions(txs);
      try {
        localStorage.setItem(`strk20_privacy_txs_${networkId}`, JSON.stringify(txs));
      } catch {
        // Ignore storage write errors.
      }
    },
    [networkId]
  );

  const recordTransaction = useCallback(
    (tx: PrivacyTransaction) => {
      saveTransactions([tx, ...transactions]);
    },
    [transactions, saveTransactions]
  );

  const clearTransactions = useCallback(() => saveTransactions([]), [saveTransactions]);

  // ── Balance scaffolding ──
  const resetBalances = useCallback(() => {
    setBalances(
      currentNetwork.tokens.map((token) => ({
        token,
        publicBalance: 0n,
        publicBalanceAvailable: true,
        shieldedBalance: 0n,
        shieldedBalanceAvailable: false,
        pendingNotesCount: 0,
        privacyApiSupported: false,
      }))
    );
  }, [currentNetwork]);

  const applyPrivateBalances = useCallback((entries: { token: string; balance: bigint }[]) => {
    const walletPrivate = new Map(entries.map((e) => [e.token.toLowerCase(), e.balance]));
    setBalances((prev) =>
      prev.map((b) => {
        const bal = walletPrivate.get(b.token.address.toLowerCase());
        if (bal !== undefined) {
          return { ...b, shieldedBalance: bal, shieldedBalanceAvailable: true };
        }
        return { ...b, shieldedBalance: 0n, shieldedBalanceAvailable: false };
      })
    );
  }, []);

  const refreshPublicBalances = useCallback(async () => {
    const w = walletRef.current;
    if (!w.isConnected || !w.address) {
      resetBalances();
      return;
    }
    setIsLoadingBalances(true);
    try {
      const results = await privacyService.fetchBalances(w.address, w.walletAccount, currentNetwork);
      setBalances((prev) => {
        const prevByAddr = new Map(prev.map((b) => [b.token.address.toLowerCase(), b] as const));
        return results.map((b) => {
          const prior = prevByAddr.get(b.token.address.toLowerCase());
          return {
            ...b,
            shieldedBalance: prior?.shieldedBalance ?? 0n,
            shieldedBalanceAvailable: prior?.shieldedBalanceAvailable ?? false,
          };
        });
      });
    } catch {
      // Never fabricate balances.
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet.isConnected, wallet.address, currentNetwork, resetBalances]);

  /**
   * B. REFRESH / SYNC — a pure read. NEVER authorizes. Safe to call repeatedly and on a poll
   * timer. Gated on GRANTED + wallet READY. Updates balances + status + error + updatedAt.
   */
  const refreshPrivateBalance = useCallback(async () => {
    if (privateRefreshInFlightRef.current) return;
    const w = walletRef.current;
    if (!w.isConnected || !w.address) {
      setPrivateBalanceStatus('UNAVAILABLE');
      return;
    }
    if (privateBalanceAccessStatus !== 'GRANTED') {
      setPrivateBalanceStatus('NOT_AUTHORIZED');
      return;
    }
    privateRefreshInFlightRef.current = true;
    setPrivateBalanceStatus((s) => (s === 'AVAILABLE' ? 'AVAILABLE' : 'LOADING'));
    setPrivateBalanceError(null);
    try {
      const status = await strk20WalletApiService.getWalletApiStatus(w);
      if (status.state !== 'READY') {
        setPrivateBalanceStatus('NOT_READY');
        return;
      }
      const entries = await strk20WalletApiService.getPrivateBalances(
        w,
        currentNetwork.tokens.map((t) => t.address)
      );
      applyPrivateBalances(entries);
      setPrivateReceivingState('READY');
      setPrivateBalanceStatus('AVAILABLE');
      setPrivateBalanceUpdatedAt(Date.now());
    } catch (err: any) {
      const t = strk20WalletApiService.translateWalletError(err);
      if (t.code === 118) {
        // NOT_REGISTERED: the viewing key isn't registered yet — not a balance error.
        setPrivateBalanceStatus('NOT_READY');
        setPrivateReceivingState('NEEDS_REGISTRATION');
      } else if (t.code === 113) {
        // Consent was refused — treat as not authorized, never keep polling.
        setPrivateBalanceStatus('NOT_AUTHORIZED');
        setPrivateBalanceAccessStatus('DENIED');
      } else {
        setPrivateBalanceStatus('ERROR');
        setPrivateBalanceError(t.userMessage);
      }
    } finally {
      privateRefreshInFlightRef.current = false;
    }
  }, [privateBalanceAccessStatus, currentNetwork, applyPrivateBalances]);

  /**
   * A. AUTHORIZATION — runs only when access is genuinely required. If already GRANTED or
   * DENIED this session, it is a no-op (does not re-prompt). A successful read here both
   * grants access and (per the Wallet API spec, NOT_REGISTERED 118 is its "unregistered"
   * error) confirms private-receiving readiness.
   */
  const ensurePrivateBalanceAccess = useCallback(
    async (opts?: { silent?: boolean }) => {
      const w = walletRef.current;
      if (!w.isConnected) return;
      // Already granted this session → never re-prompt.
      if (privateBalanceAccessStatus === 'GRANTED') return;
      // Denied + silent (e.g. auto on connect) → never re-prompt without an explicit action.
      if (privateBalanceAccessStatus === 'DENIED' && opts?.silent) return;
      setPrivateBalanceStatus('LOADING');
      setPrivateBalanceError(null);
      try {
        const entries = await strk20WalletApiService.getPrivateBalances(
          w,
          currentNetwork.tokens.map((t) => t.address)
        );
        setPrivateBalanceAccessStatus('GRANTED');
        setPrivateReceivingState('READY');
        applyPrivateBalances(entries);
        setPrivateBalanceStatus('AVAILABLE');
        setPrivateBalanceUpdatedAt(Date.now());
      } catch (err: any) {
        const t = strk20WalletApiService.translateWalletError(err);
        if (t.code === 113) {
          setPrivateBalanceAccessStatus('DENIED');
          setPrivateBalanceStatus('NOT_AUTHORIZED');
        } else if (t.code === 118) {
          setPrivateReceivingState('NEEDS_REGISTRATION');
          setPrivateBalanceStatus('NOT_READY');
          setPrivateBalanceAccessStatus('UNKNOWN');
        } else {
          setPrivateBalanceAccessStatus('UNKNOWN');
          setPrivateBalanceStatus('ERROR');
          setPrivateBalanceError(t.userMessage);
        }
        if (!opts?.silent) {
          throw err;
        }
      }
    },
    [privateBalanceAccessStatus, currentNetwork, applyPrivateBalances]
  );

  const refreshPrivateBalanceRef = useRef(refreshPrivateBalance);
  useEffect(() => {
    refreshPrivateBalanceRef.current = refreshPrivateBalance;
  }, [refreshPrivateBalance]);

  const ensurePrivateBalanceAccessRef = useRef(ensurePrivateBalanceAccess);
  useEffect(() => {
    ensurePrivateBalanceAccessRef.current = ensurePrivateBalanceAccess;
  }, [ensurePrivateBalanceAccess]);

  const refreshAfterMutation = useCallback(async () => {
    await refreshPublicBalances();
    await refreshPrivateBalance();
    // The pool's notes take a short window to mature/discover; re-check once after ~10s so
    // the just-confirmed shield/send/withdraw reflects the authoritative balance.
    if (afterMutationTimerRef.current) clearTimeout(afterMutationTimerRef.current);
    afterMutationTimerRef.current = setTimeout(() => {
      void refreshPrivateBalanceRef.current();
    }, 10000);
  }, [refreshPublicBalances, refreshPrivateBalance]);

  // Clear the after-mutation timer on unmount.
  useEffect(() => {
    return () => {
      if (afterMutationTimerRef.current) clearTimeout(afterMutationTimerRef.current);
    };
  }, []);

  // ── Wallet API status (capability / chain) ──
  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      setWalletApiStatus(await strk20WalletApiService.getWalletApiStatus(walletRef.current));
    } catch {
      setWalletApiStatus(null);
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, wallet.isConnected, wallet.address]);

  // ── Initialization: public balances on load ──
  useEffect(() => {
    refreshPublicBalances();
  }, [refreshPublicBalances]);

  // ── Public balance polling (30s) — private balances are never polled via this timer ──
  useEffect(() => {
    if (!wallet.isConnected) return;
    const t = setInterval(refreshPublicBalances, 30000);
    return () => clearInterval(t);
  }, [refreshPublicBalances, wallet.isConnected]);

  // ── Session private-balance authorization (once per address, silent) ──
  const autoPrivateRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wallet.isConnected || !wallet.address) {
      autoPrivateRequestRef.current = null;
      setPrivateBalanceAccessStatus('UNKNOWN');
      setPrivateReceivingState('UNKNOWN');
      setPrivateBalanceStatus('IDLE');
      return;
    }
    if (autoPrivateRequestRef.current === wallet.address) return;
    autoPrivateRequestRef.current = wallet.address;
    const t = setTimeout(() => {
      void ensurePrivateBalanceAccessRef.current({ silent: true });
    }, 1200);
    return () => clearTimeout(t);
  }, [wallet.isConnected, wallet.address]);

  // ── Safe reconciliation of EXTERNAL incoming private payments ──
  // The Wallet API exposes no STRK20 balance-change subscription, so we poll
  // `wallet_strk20Balances` on a modest interval. This is safe because `refreshPrivateBalance`
  // NEVER authorizes — it only reads — so polling cannot re-trigger a permission prompt.
  useEffect(() => {
    if (!wallet.isConnected || privateBalanceAccessStatus !== 'GRANTED') return;
    const t = setInterval(() => {
      void refreshPrivateBalanceRef.current();
    }, PRIVATE_POLL_MS);
    return () => clearInterval(t);
  }, [wallet.isConnected, privateBalanceAccessStatus]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet: effectiveWallet,
      privyConnected,
      networkId,
      currentNetwork,
      isSepolia,
      setNetworkId,
      balances,
      isLoadingBalances,
      transactions,
      recordTransaction,
      clearTransactions,
      privateBalanceAccessStatus,
      privateBalancePermission: privateBalanceAccessStatus,
      ensurePrivateBalanceAccess,
      requestPrivateBalanceAccess: ensurePrivateBalanceAccess,
      privateBalanceStatus,
      privateBalanceError,
      privateBalanceUpdatedAt,
      refreshPrivateBalance,
      refreshPrivateBalances: refreshPrivateBalance,
      refreshPublicBalances,
      refreshAfterMutation,
      walletApiStatus,
      checkingStatus,
      refreshStatus,
      privateReceivingState,
      setPrivateReceivingState,
    }),
    [
      wallet,
      effectiveWallet,
      privyConnected,
      networkId,
      currentNetwork,
      isSepolia,
      setNetworkId,
      balances,
      isLoadingBalances,
      transactions,
      recordTransaction,
      clearTransactions,
      privateBalanceAccessStatus,
      ensurePrivateBalanceAccess,
      privateBalanceStatus,
      privateBalanceError,
      privateBalanceUpdatedAt,
      refreshPrivateBalance,
      refreshPublicBalances,
      refreshAfterMutation,
      walletApiStatus,
      checkingStatus,
      refreshStatus,
      privateReceivingState,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextValue => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider');
  return ctx;
};
