'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { constants } from 'starknet';
import { createStore, Store } from '@starknet-io/get-starknet-discovery';

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

  const [availableWallets, setAvailableWallets] = useState<any[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const storeRef = useRef<Store | null>(null);

  // Initialize discovery store and discover installed Starknet wallets
  const scanWallets = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      const discovered: any[] = [];
      const seenIds = new Set<string>();

      // 1. Official get-starknet-discovery store
      if (!storeRef.current) {
        try {
          storeRef.current = createStore();
        } catch (e) {
          console.warn('Could not create discovery store', e);
        }
      }

      if (storeRef.current) {
        const wallets = storeRef.current.getWallets();
        if (wallets && wallets.length > 0) {
          for (const w of wallets) {
            const id = (w as any).id || (w as any).name || 'wallet';
            seenIds.add(id);
            discovered.push({
              id,
              name: (w as any).name || 'Starknet Wallet',
              icon: (w as any).icon || '🛡️',
              provider: w,
              isPrivacyNative: id === 'ready' || ((w as any).name && (w as any).name.toLowerCase().includes('ready')),
            });
          }
        }
      }

      // 2. Injected window object fallbacks
      const windowObj = window as any;
      if (windowObj.starknet_ready && !seenIds.has('ready')) {
        seenIds.add('ready');
        discovered.push({
          id: 'ready',
          name: 'Ready Wallet',
          icon: '🛡️',
          provider: windowObj.starknet_ready,
          isPrivacyNative: true,
        });
      }
      if (windowObj.starknet_argentX && !seenIds.has('argentX')) {
        seenIds.add('argentX');
        discovered.push({
          id: 'argentX',
          name: 'Argent X',
          icon: '🟠',
          provider: windowObj.starknet_argentX,
          isPrivacyNative: false,
        });
      }
      if (windowObj.starknet_braavos && !seenIds.has('braavos')) {
        seenIds.add('braavos');
        discovered.push({
          id: 'braavos',
          name: 'Braavos',
          icon: '🔷',
          provider: windowObj.starknet_braavos,
          isPrivacyNative: false,
        });
      }
      if (windowObj.starknet && !seenIds.has('starknet_default')) {
        seenIds.add('starknet_default');
        discovered.push({
          id: 'starknet_default',
          name: windowObj.starknet.name || 'Starknet Injected Wallet',
          icon: '⚡',
          provider: windowObj.starknet,
          isPrivacyNative: false,
        });
      }

      setAvailableWallets(discovered);
    } catch (err: any) {
      console.warn('Wallet discovery scan error:', err);
    }
  }, []);

  useEffect(() => {
    scanWallets();
    const timer = setTimeout(scanWallets, 1200);
    return () => clearTimeout(timer);
  }, [scanWallets]);

  // Connect to selected wallet
  const connectWallet = async (walletOption?: any) => {
    setIsConnecting(true);
    setState(prev => ({ ...prev, error: null }));

    try {
      let targetProvider = walletOption?.provider;
      
      if (!targetProvider) {
        const windowObj = window as any;
        targetProvider = windowObj.starknet_ready || windowObj.starknet_argentX || windowObj.starknet_braavos || windowObj.starknet;
      }

      if (!targetProvider) {
        throw new Error('No Starknet wallet detected. Please install Ready Wallet, Argent X, or Braavos.');
      }

      // Request connection
      if (targetProvider.enable) {
        const accounts = await targetProvider.enable({ showModal: true });
        const selectedAddress = accounts?.[0] || targetProvider.selectedAddress;

// Check STRK20 Privacy Capability via least-privilege version query.
      // Capability is derived from the Wallet API surface — never from wallet name,
      // browser user agent, or a hardcoded "Ready = true".
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
        // ignore — fall through to legacy capability probe below
      }

      // Fallback: legacy `supportedSpecs` property (still capability-based, not name-based).
      if (!isPrivacySupported && targetProvider.supportedSpecs) {
        const specs = Array.isArray(targetProvider.supportedSpecs)
          ? targetProvider.supportedSpecs
          : [targetProvider.supportedSpecs];
        walletApiVersion = specs[0] || walletApiVersion;
        isPrivacySupported = specs.some((s: string) => {
          const match = s.match(/v?(\d+\.\d+)/);
          return match && parseFloat(match[1]) >= 0.10;
        });
      }

        setState({
          isConnected: true,
          address: selectedAddress,
          chainId: targetProvider.chainId || constants.StarknetChainId.SN_MAIN,
          walletName: targetProvider.name || walletOption?.name || 'Starknet Wallet',
          walletIcon: walletOption?.icon || '🛡️',
          isPrivacySupported,
          walletApiVersion,
          rawWallet: targetProvider,
          walletAccount: targetProvider.account || targetProvider,
          error: null,
        });
      }
    } catch (err: any) {
      console.error('Wallet connection failed:', err);
      setState(prev => ({
        ...prev,
        error: err.message || 'Failed to connect wallet',
      }));
    } finally {
      setIsConnecting(false);
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

  return {
    ...state,
    availableWallets,
    isConnecting,
    connectWallet,
    disconnectWallet,
    rescan: scanWallets,
  };
}
