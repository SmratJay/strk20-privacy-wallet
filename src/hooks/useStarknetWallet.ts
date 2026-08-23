'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { constants } from 'starknet';
import { createStore, Store } from '@starknet-io/get-starknet-discovery';

export interface SupportedWalletMeta {
  id: 'ready' | string;
  name: string;
  tagline: string;
  badge: string;
  badgeType: 'recommended' | 'smart' | 'bitcoin' | 'generic';
  downloadUrl: string;
  chromeUrl?: string;
  isPrivacyNative: boolean;
  isDetected: boolean;
  provider: any | null;
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: string | null;
  walletName: string | null;
  walletIcon: string | null;
  isPrivacySupported: boolean;
  walletApiVersion: string | null;
  rawWallet: any | null;
  walletAccount: any | null;
  error: string | null;
}

const SUPPORTED_WALLETS_DEF: Omit<SupportedWalletMeta, 'isDetected' | 'provider'>[] = [
  {
    id: 'ready',
    name: 'Ready Wallet',
    tagline: 'Native STRK20 Shielding & In-Wallet Proving',
    badge: 'RECOMMENDED',
    badgeType: 'recommended',
    downloadUrl: 'https://ready.co/',
    chromeUrl: 'https://chromewebstore.google.com/detail/ready-wallet-formerly-arg/dlcobpjiigpikoobohmabehhmhfoodbb',
    isPrivacyNative: true,
  },
];

export function useStarknetWallet() {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: null,
    chainId: null,
    walletName: null,
    walletIcon: null,
    isPrivacySupported: false,
    walletApiVersion: null,
    rawWallet: null,
    walletAccount: null,
    error: null,
  });

  const [supportedWallets, setSupportedWallets] = useState<SupportedWalletMeta[]>(
    SUPPORTED_WALLETS_DEF.map((def) => ({
      ...def,
      isDetected: false,
      provider: null,
    }))
  );

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingWalletId, setConnectingWalletId] = useState<string | null>(null);

  const storeRef = useRef<Store | null>(null);

  // Discovery store & injected provider scanner (Ready only — STRK20 private features
  // are only supported by a privacy-enabled Wallet API ≥ 0.10 wallet today).
  const scanWallets = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      // 1. Official get-starknet-discovery store
      if (!storeRef.current) {
        try {
          storeRef.current = createStore();
        } catch (e) {
          console.warn('Could not initialize Starknet discovery store', e);
        }
      }

      const storeWallets = storeRef.current?.getWallets() || [];
      const windowObj = window as any;

      // 2. Detect the Ready wallet (formerly Argent X) under any of its injected names.
      let provider: any = null;
      const readyNameMatch = (w: any) => {
        const id = String((w as any).id || '').toLowerCase();
        const name = String((w as any).name || '').toLowerCase();
        return (
          id === 'ready' ||
          id === 'argentx' ||
          id === 'argent_x' ||
          name.includes('ready') ||
          name.includes('argent')
        );
      };
      provider =
        windowObj.starknet_ready ||
        windowObj.starknet_argentX ||
        storeWallets.find(readyNameMatch) ||
        (windowObj.starknet && readyNameMatch(windowObj.starknet) ? windowObj.starknet : null) ||
        null;

      setSupportedWallets(
        SUPPORTED_WALLETS_DEF.map((def) => ({
          ...def,
          isDetected: Boolean(provider),
          provider: provider || null,
        }))
      );
    } catch (err) {
      console.warn('Wallet scan error:', err);
    }
  }, []);

  useEffect(() => {
    scanWallets();
    const interval = setInterval(scanWallets, 2000);
    const onFocus = () => scanWallets();

    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [scanWallets]);

  // Connect to the Ready wallet (the only supported STRK20 privacy wallet today).
  const connectWallet = async (targetWallet?: SupportedWalletMeta | any) => {
    // If called without arguments (e.g. from header / top bar button), open the modal
    if (!targetWallet) {
      setIsConnectModalOpen(true);
      return;
    }

    // Fail closed: never connect a non-privacy-native wallet into the private lane.
    if (targetWallet && targetWallet.isPrivacyNative === false) {
      setState((prev) => ({ ...prev, error: 'Only the Ready Wallet supports STRK20 private features at this time.' }));
      return;
    }

    const walletId = targetWallet.id || 'starknet';
    setConnectingWalletId(walletId);
    setIsConnecting(true);
    setState((prev) => ({ ...prev, error: null }));

    try {
      let targetProvider = targetWallet.provider || targetWallet;

      if (!targetProvider) {
        const windowObj = window as any;
        targetProvider =
          windowObj.starknet_ready ||
          windowObj.starknet_argentX ||
          storeRef.current?.getWallets().find((w: any) => {
            const id = String((w as any).id || '').toLowerCase();
            const name = String((w as any).name || '').toLowerCase();
            return (
              id === 'ready' ||
              id === 'argentx' ||
              id === 'argent_x' ||
              name.includes('ready') ||
              name.includes('argent')
            );
          }) ||
          null;
      }

      if (!targetProvider) {
        throw new Error(
          'Ready Wallet is not detected in your browser. Please install the Ready extension.'
        );
      }

      // Request connection
      let selectedAddress: string | null = null;

      if (targetProvider.enable) {
        const accounts = await targetProvider.enable({ showModal: true });
        selectedAddress = accounts?.[0] || targetProvider.selectedAddress;
      } else if (targetProvider.request) {
        const accounts = await targetProvider.request({ type: 'wallet_requestAccounts' });
        selectedAddress = accounts?.[0] || targetProvider.selectedAddress;
      }

      if (!selectedAddress) {
        selectedAddress = targetProvider.selectedAddress;
      }

      if (!selectedAddress) {
        throw new Error('No account address authorized by the wallet.');
      }

      // Detect STRK20 Privacy Capability via least-privilege version query
      let isPrivacySupported = false;
      let walletApiVersion = '0.0.0';

      try {
        if (targetProvider.request && typeof targetProvider.request === 'function') {
          const res = await targetProvider.request({ type: 'wallet_supportedWalletApi' });
          if (Array.isArray(res) && res.length > 0) {
            const versions = res.map(String);
            walletApiVersion = versions[0];
            isPrivacySupported = versions.some((v) => {
              const match = v.match(/(\d+)\.(\d+)/);
              return match && (parseInt(match[1], 10) > 0 || parseInt(match[2], 10) >= 10);
            });
          }
        }
      } catch {
        // Fall through
      }

      if (!isPrivacySupported && targetProvider.supportedSpecs) {
        const specs = Array.isArray(targetProvider.supportedSpecs)
          ? targetProvider.supportedSpecs
          : [targetProvider.supportedSpecs];
        walletApiVersion = specs[0] || walletApiVersion;
        // STRK20 Wallet API requires >= 0.10. Parse numerically so "0.10" is not
        // collapsed to 0.1 by parseFloat (which would wrongly admit 0.9.x wallets).
        isPrivacySupported = specs.some((s: string) => {
          const match = s.match(/(\d+)\.(\d+)/);
          if (!match) return false;
          const major = Number.parseInt(match[1], 10);
          const minor = Number.parseInt(match[2], 10);
          return major > 0 || minor >= 10;
        });
      }

      setState({
        isConnected: true,
        address: selectedAddress,
        chainId: targetProvider.chainId || constants.StarknetChainId.SN_SEPOLIA,
        walletName: targetProvider.name || targetWallet.name || 'Starknet Wallet',
        walletIcon: targetWallet.badge || '🛡️',
        isPrivacySupported,
        walletApiVersion,
        rawWallet: targetProvider,
        walletAccount: targetProvider.account || targetProvider,
        error: null,
      });

      // Close modal on successful connection
      setIsConnectModalOpen(false);
    } catch (err: any) {
      console.error('Wallet connection failed:', err);
      const friendlyError =
        err?.message?.includes('User abort') || err?.message?.includes('User rejected') || err?.message?.includes('closed')
          ? 'Connection request was cancelled in your wallet extension.'
          : err?.message || 'Failed to connect wallet';

      setState((prev) => ({
        ...prev,
        error: friendlyError,
      }));
    } finally {
      setIsConnecting(false);
      setConnectingWalletId(null);
    }
  };

  const disconnectWallet = () => {
    setState({
      isConnected: false,
      address: null,
      chainId: null,
      walletName: null,
      walletIcon: null,
      isPrivacySupported: false,
      walletApiVersion: null,
      rawWallet: null,
      walletAccount: null,
      error: null,
    });
  };

  const openConnectModal = () => {
    setState((prev) => ({ ...prev, error: null }));
    setIsConnectModalOpen(true);
  };

  const closeConnectModal = () => {
    setState((prev) => ({ ...prev, error: null }));
    setIsConnectModalOpen(false);
  };

  return {
    ...state,
    supportedWallets,
    availableWallets: supportedWallets.filter((w) => w.isDetected),
    isConnecting,
    connectingWalletId,
    isConnectModalOpen,
    openConnectModal,
    closeConnectModal,
    connectWallet,
    disconnectWallet,
    rescan: scanWallets,
  };
}
