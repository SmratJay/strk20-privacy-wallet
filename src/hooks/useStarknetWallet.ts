'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { constants } from 'starknet';
import { createStore, Store } from '@starknet-io/get-starknet-discovery';

export interface SupportedWalletMeta {
  id: 'ready' | 'braavos' | 'xverse' | string;
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
  {
    id: 'braavos',
    name: 'Braavos',
    tagline: 'Hardware-grade security & Smart 2FA',
    badge: 'SMART WALLET',
    badgeType: 'smart',
    downloadUrl: 'https://braavos.app/',
    chromeUrl: 'https://chromewebstore.google.com/detail/braavos-starknet-wallet/jnlgamecbpmbajjfhmmmlhejkemejdma',
    isPrivacyNative: false,
  },
  {
    id: 'xverse',
    name: 'Xverse',
    tagline: 'Leading Bitcoin & Starknet Web3 Wallet',
    badge: 'BTC + STARKNET',
    badgeType: 'bitcoin',
    downloadUrl: 'https://www.xverse.app/',
    chromeUrl: 'https://chromewebstore.google.com/detail/xverse-wallet/idnnbdplmphpflfnlkomgpfbpcgelopg',
    isPrivacyNative: false,
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

  const [otherWallets, setOtherWallets] = useState<any[]>([]);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingWalletId, setConnectingWalletId] = useState<string | null>(null);

  const storeRef = useRef<Store | null>(null);

  // Discovery store & injected provider scanner
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

      // 2. Identify the 3 core supported wallets
      const updatedSupported: SupportedWalletMeta[] = SUPPORTED_WALLETS_DEF.map((def) => {
        let provider: any = null;

        if (def.id === 'ready') {
          provider =
            windowObj.starknet_ready ||
            windowObj.starknet_argentX ||
            storeWallets.find(
              (w: any) =>
                w.id === 'ready' ||
                w.id === 'argentX' ||
                (w.name && w.name.toLowerCase().includes('ready')) ||
                (w.name && w.name.toLowerCase().includes('argent'))
            );
        } else if (def.id === 'braavos') {
          provider =
            windowObj.starknet_braavos ||
            storeWallets.find(
              (w: any) => w.id === 'braavos' || (w.name && w.name.toLowerCase().includes('braavos'))
            );
        } else if (def.id === 'xverse') {
          provider =
            windowObj.starknet_xverse ||
            windowObj.xverse ||
            windowObj.starknet_xverse_starknet ||
            storeWallets.find(
              (w: any) => w.id === 'xverse' || (w.name && w.name.toLowerCase().includes('xverse'))
            );
        }

        return {
          ...def,
          isDetected: Boolean(provider),
          provider: provider || null,
        };
      });

      // 3. Scan for any other injected / discovered Starknet providers
      const coreIds = new Set(['ready', 'argentX', 'braavos', 'xverse']);
      const extraWallets: any[] = [];

      for (const w of storeWallets) {
        const id = (w as any).id || (w as any).name;
        if (id && !coreIds.has(id.toLowerCase())) {
          extraWallets.push({
            id,
            name: (w as any).name || 'Starknet Wallet',
            icon: (w as any).icon || '⚡',
            provider: w,
          });
        }
      }

      if (windowObj.starknet_cartridge && !extraWallets.some((w) => w.id === 'cartridge')) {
        extraWallets.push({
          id: 'cartridge',
          name: 'Cartridge Controller',
          icon: '🎮',
          provider: windowObj.starknet_cartridge,
        });
      }

      if (
        windowObj.starknet &&
        !updatedSupported.some((w) => w.provider === windowObj.starknet) &&
        !extraWallets.some((w) => w.provider === windowObj.starknet)
      ) {
        extraWallets.push({
          id: 'starknet_injected',
          name: windowObj.starknet.name || 'Injected Starknet Provider',
          icon: '⚡',
          provider: windowObj.starknet,
        });
      }

      setSupportedWallets(updatedSupported);
      setOtherWallets(extraWallets);
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

  // Connect to a specific wallet
  const connectWallet = async (targetWallet?: SupportedWalletMeta | any) => {
    // If called without arguments (e.g. from header / top bar button), open the modal
    if (!targetWallet) {
      setIsConnectModalOpen(true);
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
        if (walletId === 'ready') targetProvider = windowObj.starknet_ready || windowObj.starknet_argentX;
        else if (walletId === 'braavos') targetProvider = windowObj.starknet_braavos;
        else if (walletId === 'xverse') targetProvider = windowObj.starknet_xverse || windowObj.xverse;
        else targetProvider = windowObj.starknet;
      }

      if (!targetProvider) {
        throw new Error(
          `${targetWallet.name || 'Selected wallet'} is not detected in your browser. Please install its extension.`
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
        isPrivacySupported = specs.some((s: string) => {
          const match = s.match(/v?(\d+\.\d+)/);
          return match && parseFloat(match[1]) >= 0.1;
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
    otherWallets,
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
