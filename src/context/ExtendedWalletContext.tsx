'use client';

/**
 * @file src/context/ExtendedWalletContext.tsx
 * @description Dedicated wallet provider for the Extended perps portal.
 *
 * The Extended terminal is a COMPLETELY SEPARATE domain from the Orrange privacy wallet.
 * It never touches Privy, WalletContext or Orrange private balances. It connects only to
 * the user's Ready / injected Starknet wallet (the same wallet the STRK20 privacy lane
 * uses) and enforces Starknet MAINNET:
 *
 *   - Connect explicitly via "Connect Ready Wallet" (never auto-uses the Privy account).
 *   - On connect and on every chain change the wallet MUST be on Starknet Mainnet.
 *   - If the wallet is on Sepolia we surface a clear "switch to mainnet" action and NEVER
 *     sign or transact on the wrong network.
 *   - A stored Extended session is scoped to the connected wallet address; when the
 *     wallet account changes or disconnects, the stale session is invalidated so no data
 *     belonging to another wallet is ever shown.
 *
 * The provider auto-restores a previously authorized connection on mount (silent mode) so
 * refreshing the page never forces the user to redo onboarding for a wallet they already
 * connected.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createStore } from '@starknet-io/get-starknet-discovery';
import { ExtendedAdapter } from '@/extended/adapter';
import { MAINNET_CHAIN_ID, isMainnetChain } from '@/extended/chain';

/** Starknet Mainnet chain id (hex). Any other chain is treated as "wrong network". */
export { MAINNET_CHAIN_ID, isMainnetChain as isMainnet };

export interface ExtendedWalletAccount {
  signMessage?: (typedData: unknown) => Promise<{ r: unknown; s: unknown }>;
  execute?: (calls: unknown[]) => Promise<{ transaction_hash?: string; transactionHash?: string }>;
  provider?: {
    waitForTransaction?: (hash: string, opts?: unknown) => Promise<unknown>;
  };
}

export interface ExtendedWalletState {
  /** True when a Ready/injected Starknet wallet provider is detected in the browser. */
  isDetected: boolean;
  isConnected: boolean;
  address: string | null;
  chainId: string | null;
  walletName: string | null;
  walletAccount: ExtendedWalletAccount | null;
  rawWallet: unknown;
  isConnecting: boolean;
  /** `true` on mainnet, `false` on a wrong network, `null` while unknown. */
  onMainnet: boolean | null;
  /** User-facing connection error (install guidance, rejected, wrong network…). */
  error: string | null;
}

interface ExtendedWalletContextValue {
  wallet: ExtendedWalletState;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Ask the wallet to switch to Starknet Mainnet. Returns true when switched. */
  requestMainnetSwitch: () => Promise<boolean>;
  refreshChain: () => Promise<string | null>;
}

const ExtendedWalletContext = createContext<ExtendedWalletContextValue | undefined>(undefined);

const READY_NAME_MATCH = (w: { id?: unknown; name?: unknown }) => {
  const id = String((w as { id?: unknown }).id ?? '').toLowerCase();
  const name = String((w as { name?: unknown }).name ?? '').toLowerCase();
  return (
    id === 'ready' ||
    id === 'argentx' ||
    id === 'argent_x' ||
    name.includes('ready') ||
    name.includes('argent')
  );
};

/** Find the injected Ready/Argent Starknet wallet provider. */
function findProvider(windowObj: any): unknown | null {
  return (
    windowObj?.starknet_ready ||
    windowObj?.starknet_argentX ||
    windowObj?.starknet_argentx ||
    (windowObj?.starknet && READY_NAME_MATCH(windowObj.starknet) ? windowObj.starknet : null) ||
    null
  );
}

/** Read the wallet's live chain id via `wallet_requestChainId`. */
async function readChain(provider: any): Promise<string | null> {
  try {
    if (provider?.request && typeof provider.request === 'function') {
      const c = await provider.request({ type: 'wallet_requestChainId' });
      if (c) return String(c);
    }
  } catch {
    // Fall through.
  }
  const chain = provider?.chainId;
  return chain ? String(chain) : null;
}

const INITIAL_WALLET: ExtendedWalletState = {
  isDetected: false,
  isConnected: false,
  address: null,
  chainId: null,
  walletName: null,
  walletAccount: null,
  rawWallet: null,
  isConnecting: false,
  onMainnet: null,
  error: null,
};

export const ExtendedWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wallet, setWallet] = useState<ExtendedWalletState>(INITIAL_WALLET);
  const providerRef = useRef<any>(null);
  const connectedAddressRef = useRef<string | null>(null);
  // Adapter is used only to invalidate the session when the wallet changes.
  const adapterRef = useRef<ExtendedAdapter | null>(null);
  if (typeof window !== 'undefined' && !adapterRef.current) {
    adapterRef.current = new ExtendedAdapter();
  }

  const applyProvider = useCallback((provider: any) => {
    providerRef.current = provider;
    const name =
      provider?.name ||
      provider?.id ||
      (String(provider?.selectedAddress ?? '') ? 'Starknet Wallet' : 'Starknet Wallet');
    setWallet((prev) => ({
      ...prev,
      isDetected: Boolean(provider),
      rawWallet: provider ?? null,
      walletName: provider ? name : null,
    }));
  }, []);

  const syncConnected = useCallback(
    async (provider: any, address: string | null) => {
      const chainId = await readChain(provider);
      const account = provider?.account || provider;
      connectedAddressRef.current = address;
      setWallet((prev) => ({
        ...prev,
        isConnected: Boolean(provider && address),
        address,
        chainId,
        onMainnet: chainId ? isMainnetChain(chainId) : null,
        walletAccount: address && provider ? account : null,
        error: null,
      }));
      if (address) {
        // A session that belongs to another wallet must never be reused.
        const stored = adapterRef.current?.sessionWallet;
        if (stored && address && stored.toLowerCase() !== address.toLowerCase()) {
          adapterRef.current?.clearSession();
        }
      }
      return chainId;
    },
    [],
  );

  // ── Detection + event wiring ─────────────────────────────────────────────────
  useEffect(() => {
    const windowObj = window as any;
    const scan = () => {
      const provider = findProvider(windowObj);
      applyProvider(provider);
      return provider;
    };

    let provider = scan();

    // get-starknet-discovery store (broader detection).
    let store: ReturnType<typeof createStore> | null = null;
    try {
      store = createStore();
      const storeWallet = store
        .getWallets()
        .find((w: any) => READY_NAME_MATCH(w));
      if (storeWallet && !provider) {
        provider = storeWallet;
        applyProvider(provider);
      }
    } catch {
      // Discovery store unavailable — injected provider scan is enough.
    }

    // Auto-restore a previously authorized connection (silent, no prompt).
    const autoRestore = async (p: any) => {
      if (!p) return;
      try {
        let accounts: string[] = [];
        if (p.request && typeof p.request === 'function') {
          const res = await p.request({ type: 'wallet_requestAccounts', params: { silent_mode: true } });
          accounts = Array.isArray(res) ? res : [];
        } else if (p.enable) {
          const res = await p.enable({ silentMode: true });
          accounts = Array.isArray(res) ? res : [];
        }
        const address = accounts?.[0] || p.selectedAddress || null;
        if (address) {
          connectedAddressRef.current = address;
          await syncConnected(p, address);
        }
      } catch {
        // Not previously authorized — leave disconnected.
      }
    };

    // Bind injected-provider events (accountsChanged / networkChanged). Handlers are
    // declared here so the cleanup can detach them regardless of provider presence.
    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts : [];
      const next = list?.[0] ? String(list[0]) : null;
      if (next && connectedAddressRef.current && next.toLowerCase() !== connectedAddressRef.current.toLowerCase()) {
        adapterRef.current?.clearSession();
      }
      void syncConnected(providerRef.current, next);
    };
    const onNetwork = (chainId: unknown) => {
      const nextChain = chainId ? String(chainId) : null;
      setWallet((prev) => ({
        ...prev,
        chainId: nextChain,
        onMainnet: nextChain ? isMainnetChain(nextChain) : null,
        isConnected: Boolean(prev.address && providerRef.current),
      }));
    };

    if (provider) {
      const pAny = provider as any;
      if (pAny.on && typeof pAny.on === 'function') {
        pAny.on('accountsChanged', onAccounts);
        pAny.on('networkChanged', onNetwork);
      }
      void autoRestore(provider);
    }

    const interval = setInterval(() => {
      const p = findProvider(windowObj);
      if (p && p !== providerRef.current) {
        provider = p;
        applyProvider(p);
        void autoRestore(p);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      const pAny = provider as any;
      if (pAny?.off && typeof pAny.off === 'function') {
        pAny.off('accountsChanged', onAccounts);
        pAny.off('networkChanged', onNetwork);
      }
    };
  }, [applyProvider, syncConnected]);

  // ── Connect (explicit user action) ───────────────────────────────────────────
  const connect = useCallback(async () => {
    setWallet((prev) => ({ ...prev, isConnecting: true, error: null }));
    try {
      const windowObj = window as any;
      const provider = findProvider(windowObj) || providerRef.current;
      if (!provider) {
        setWallet((prev) => ({
          ...prev,
          error: 'Ready Wallet is not installed. Install the Ready (formerly Argent X) extension, then connect.',
        }));
        return;
      }
      applyProvider(provider);

      let accounts: string[] = [];
      try {
        if (provider.request && typeof provider.request === 'function') {
          const res = await provider.request({ type: 'wallet_requestAccounts', params: { silent_mode: false } });
          accounts = Array.isArray(res) ? res : [];
        } else if (provider.enable) {
          const res = await provider.enable({ showModal: true });
          accounts = Array.isArray(res) ? res : [];
        }
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? '');
        if (/user abort|user rejected|closed|refused/i.test(msg)) {
          throw new Error('Connection request was rejected in your wallet extension.');
        }
        throw new Error('The wallet did not authorize a connection. Please try again.');
      }

      const address = accounts?.[0] || provider.selectedAddress || null;
      if (!address) throw new Error('No Starknet account was authorized.');

      await syncConnected(provider, address);

      const chainId = await readChain(provider);
      if (chainId && !isMainnetChain(chainId)) {
        setWallet((prev) => ({
          ...prev,
          onMainnet: false,
          error:
            'Your wallet is on the wrong network. Extended only runs on Starknet Mainnet — switch your wallet to Mainnet before trading.',
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect the Starknet wallet.';
      setWallet((prev) => ({ ...prev, error: msg }));
    } finally {
      setWallet((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [applyProvider, syncConnected]);

  const disconnect = useCallback(() => {
    adapterRef.current?.clearSession();
    connectedAddressRef.current = null;
    setWallet((prev) => ({
      ...prev,
      isConnected: false,
      address: null,
      chainId: null,
      walletAccount: null,
      onMainnet: null,
      error: null,
    }));
  }, []);

  const refreshChain = useCallback(async (): Promise<string | null> => {
    const chainId = await readChain(providerRef.current);
    setWallet((prev) => ({
      ...prev,
      chainId,
      onMainnet: chainId ? isMainnetChain(chainId) : null,
    }));
    return chainId;
  }, []);

  const requestMainnetSwitch = useCallback(async (): Promise<boolean> => {
    const provider = providerRef.current;
    if (!provider?.request || typeof provider.request !== 'function') return false;
    try {
      await provider.request({
        type: 'wallet_switchStarknetChain',
        params: { chainId: MAINNET_CHAIN_ID },
      });
      await refreshChain();
      return true;
    } catch {
      return false;
    }
  }, [refreshChain]);

  const value = useMemo<ExtendedWalletContextValue>(
    () => ({ wallet, connect, disconnect, requestMainnetSwitch, refreshChain }),
    [wallet, connect, disconnect, requestMainnetSwitch, refreshChain],
  );

  return <ExtendedWalletContext.Provider value={value}>{children}</ExtendedWalletContext.Provider>;
};

export const useExtendedWallet = (): ExtendedWalletContextValue => {
  const ctx = useContext(ExtendedWalletContext);
  if (!ctx) throw new Error('useExtendedWallet must be used within an ExtendedWalletProvider');
  return ctx;
};