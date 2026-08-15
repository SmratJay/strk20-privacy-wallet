'use client';

import { useState, useEffect, useCallback } from 'react';
import { RpcProvider, constants } from 'starknet';
import { ALCHEMY_RPC_URL } from '@/config/tokens';

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

  // Discover installed Starknet wallets in the browser
  const scanWallets = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      const discovered: any[] = [];
      
      // Standard window.starknet / injected discovery
      const windowObj = window as any;
      if (windowObj.starknet_ready) {
        discovered.push({
          id: 'ready',
          name: 'Ready Wallet',
          icon: '🛡️',
          provider: windowObj.starknet_ready,
          isPrivacyNative: true,
        });
      }
      if (windowObj.starknet_argentX) {
        discovered.push({
          id: 'argentX',
          name: 'Argent X',
          icon: '🟠',
          provider: windowObj.starknet_argentX,
          isPrivacyNative: false,
        });
      }
      if (windowObj.starknet_braavos) {
        discovered.push({
          id: 'braavos',
          name: 'Braavos',
          icon: '🔷',
          provider: windowObj.starknet_braavos,
          isPrivacyNative: false,
        });
      }
      if (windowObj.starknet && !discovered.some(w => w.provider === windowObj.starknet)) {
        discovered.push({
          id: 'starknet_default',
          name: windowObj.starknet.name || 'Starknet Wallet',
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
    const timer = setTimeout(scanWallets, 1000);
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
        throw new Error('No Starknet wallet detected. Please install Ready Wallet or Argent X.');
      }

      // Request connection
      if (targetProvider.enable) {
        const accounts = await targetProvider.enable({ showModal: true });
        const selectedAddress = accounts?.[0] || targetProvider.selectedAddress;

        // Check STRK20 Privacy Capability
        let isPrivacySupported = false;
        let walletApiVersion = '0.0.0';

        // Capability check: query supported specs/APIs without reading private balances
        if (targetProvider.supportedSpecs) {
          const specs = Array.isArray(targetProvider.supportedSpecs)
            ? targetProvider.supportedSpecs
            : [targetProvider.supportedSpecs];
          
          isPrivacySupported = specs.some((s: string) => {
            const match = s.match(/v?(\d+\.\d+)/);
            return match && parseFloat(match[1]) >= 0.10;
          });
          walletApiVersion = specs[0] || '1.0.0';
        } else if (targetProvider.id === 'ready' || walletOption?.id === 'ready') {
          isPrivacySupported = true;
          walletApiVersion = '0.10.3';
        }

        // Initialize Starknet RPC provider
        const rpcProvider = new RpcProvider({ nodeUrl: ALCHEMY_RPC_URL });

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
