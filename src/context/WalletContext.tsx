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

/**
 * Centralized wallet state for the consumer STRK20 privacy wallet (LANE A — Wallet API).
 *
 * This replaces the per-page balance/transaction bookkeeping that previously lived inside
 * the terminal workspace. It is the single owner of:
 *   - wallet connection (via useStarknetWallet)
 *   - public balances (on-chain RPC, polled)
 *   - private balances (wallet_strk20Balances, permission-gated — never polled)
 *   - the session-level "share private balances" permission
 *   - private-receiving readiness (derived from protocol state, not a local flag)
 *   - local transaction history (a read cache, never balance authority)
 *
 * The privacy wallet (Ready) owns viewing keys, channels, notes, and proofs. This app never
 * touches them and never falls back to public ERC-20 transfers.
 *
 * Note: the `wallet` object returned by useStarknetWallet has a fresh identity on every
 * render. To avoid effect re-run loops, the wallet is read through a ref and callbacks
 * depend only on stable primitives (isConnected / address / chainId).
 */

type PrivateReceivingState = 'UNKNOWN' | 'READY' | 'NEEDS_REGISTRATION';

/**
 * Two distinct concepts are tracked separately — do not conflate them:
 *
 *  - `privateBalancePermission` is the session-level "share private balances" CONSENT
 *    (UNKNOWN / GRANTED / DENIED). It only reflects whether the user let the wallet reveal
 *    private balances to the dapp.
 *
 *  - `privateReceivingState` is REGISTRATION readiness (UNKNOWN / READY / NEEDS_REGISTRATION).
 *    It reflects whether the address's viewing key is registered with the STRK20 pool so it
 *    can receive private notes.
 *
 * Both are derived from the SAME Wallet API call (`wallet_strk20Balances`), but they are
 * different concepts. Per the Wallet API spec, a successful `wallet_strk20Balances` implies
 * the address is registered (it returns NOT_REGISTERED 118 otherwise) — so a success sets
 * BOTH GRANTED and READY. A consent refusal (USER_REFUSED_OP 113) sets DENIED but leaves
 * receiving state UNKNOWN (we cannot tell whether the address is registered when the user
 * withholds consent). A 118 sets NEEDS_REGISTRATION. This equivalence (success ⟺ registered)
 * is guaranteed by the spec, not assumed.
 */

interface WalletContextValue {
  wallet: ReturnType<typeof useStarknetWallet>;
  networkId: ReturnType<typeof useNetwork>['networkId'];
  currentNetwork: ReturnType<typeof useNetwork>['currentNetwork'];
  isSepolia: boolean;
  setNetworkId: ReturnType<typeof useNetwork>['setNetworkId'];

  balances: ShieldedBalance[];
  isLoadingBalances: boolean;

  transactions: PrivacyTransaction[];
  recordTransaction: (tx: PrivacyTransaction) => void;
  clearTransactions: () => void;

  privateBalancePermission: WalletBalancePermission;
  requestPrivateBalanceAccess: (opts?: { silent?: boolean }) => Promise<void>;
  refreshPrivateBalances: () => Promise<void>;
  refreshPublicBalances: () => Promise<void>;
  refreshAfterMutation: () => Promise<void>;

  walletApiStatus: WalletApiStatus | null;
  checkingStatus: boolean;
  refreshStatus: () => Promise<void>;

  privateReceivingState: PrivateReceivingState;
  setPrivateReceivingState: (s: PrivateReceivingState) => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wallet = useStarknetWallet();
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

  const [privateBalancePermission, setPrivateBalancePermission] =
    useState<WalletBalancePermission>('UNKNOWN');
  const [privateReceivingState, setPrivateReceivingState] =
    useState<PrivateReceivingState>('UNKNOWN');

  const [walletApiStatus, setWalletApiStatus] = useState<WalletApiStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // Always-current wallet, read through a ref so callbacks don't re-create every render.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

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

  const refreshPrivateBalances = useCallback(async () => {
    if (privateBalancePermission !== 'GRANTED') return;
    const w = walletRef.current;
    try {
      const status = await strk20WalletApiService.getWalletApiStatus(w);
      if (status.state !== 'READY') return;
      const entries = await strk20WalletApiService.getPrivateBalances(
        w,
        currentNetwork.tokens.map((t) => t.address)
      );
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
      setPrivateReceivingState('READY');
    } catch (err: any) {
      const t = strk20WalletApiService.translateWalletError(err);
      if (t.code === 118) setPrivateReceivingState('NEEDS_REGISTRATION');
      // Leave balances unchanged; never fabricate a private balance.
    }
  }, [privateBalancePermission, currentNetwork]);

  const requestPrivateBalanceAccess = useCallback(
    async (opts?: { silent?: boolean }) => {
      const w = walletRef.current;
      if (!w.isConnected) return;
      try {
        const entries = await strk20WalletApiService.getPrivateBalances(
          w,
          currentNetwork.tokens.map((t) => t.address)
        );
        setPrivateBalancePermission('GRANTED');
        setPrivateReceivingState('READY');
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
      } catch (err: any) {
        const t = strk20WalletApiService.translateWalletError(err);
        if (t.code === 113) {
          setPrivateBalancePermission('DENIED');
        } else if (t.code === 118) {
          setPrivateReceivingState('NEEDS_REGISTRATION');
        } else {
          setPrivateBalancePermission('UNKNOWN');
        }
        if (!opts?.silent) {
          throw err;
        }
      }
    },
    [currentNetwork]
  );

  const refreshAfterMutation = useCallback(async () => {
    await refreshPublicBalances();
    if (privateBalancePermission === 'GRANTED') {
      await refreshPrivateBalances();
    }
  }, [refreshPublicBalances, refreshPrivateBalances, privateBalancePermission]);

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

  // ── Public balance polling (12s) — private balances are never polled ──
  useEffect(() => {
    if (!wallet.isConnected) return;
    const t = setInterval(refreshPublicBalances, 12000);
    return () => clearInterval(t);
  }, [refreshPublicBalances, wallet.isConnected]);

  // ── Session private-balance auto-request (once per address, silent) ──
  const requestPrivateBalanceAccessRef = useRef(requestPrivateBalanceAccess);
  useEffect(() => {
    requestPrivateBalanceAccessRef.current = requestPrivateBalanceAccess;
  }, [requestPrivateBalanceAccess]);

  const autoPrivateRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wallet.isConnected || !wallet.address) {
      autoPrivateRequestRef.current = null;
      setPrivateBalancePermission('UNKNOWN');
      setPrivateReceivingState('UNKNOWN');
      return;
    }
    setPrivateBalancePermission('UNKNOWN');
    if (autoPrivateRequestRef.current === wallet.address) return;
    autoPrivateRequestRef.current = wallet.address;
    const t = setTimeout(() => {
      void requestPrivateBalanceAccessRef.current({ silent: true });
    }, 1200);
    return () => clearTimeout(t);
  }, [wallet.isConnected, wallet.address]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      networkId,
      currentNetwork,
      isSepolia,
      setNetworkId,
      balances,
      isLoadingBalances,
      transactions,
      recordTransaction,
      clearTransactions,
      privateBalancePermission,
      requestPrivateBalanceAccess,
      refreshPrivateBalances,
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
      networkId,
      currentNetwork,
      isSepolia,
      setNetworkId,
      balances,
      isLoadingBalances,
      transactions,
      recordTransaction,
      clearTransactions,
      privateBalancePermission,
      requestPrivateBalanceAccess,
      refreshPrivateBalances,
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
