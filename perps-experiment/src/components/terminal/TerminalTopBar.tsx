'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, 
  ChevronDown, 
  CheckCircle2, 
  Zap, 
  Search, 
  ExternalLink,
  Shield,
  Activity,
  Layers,
  ArrowRight,
  Home,
  Copy,
  Check,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import { shortenAddress, copyToClipboard } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';
import { sessionKeyService, ScopedSessionKey } from '@/services/sessionKeyService';
import { priceService, TokenPrices } from '@/services/priceService';
import { strk20WalletApiService, SN_SEPOLIA_CHAIN_ID, SN_MAIN_CHAIN_ID } from '@/services/strk20WalletApiService';
import { useToast } from '@/components/Toast';

interface TerminalTopBarProps {
  wallet: any;
  onSearchIntent?: (query: string) => void;
}

export const TerminalTopBar: React.FC<TerminalTopBarProps> = ({ wallet, onSearchIntent }) => {
  const { currentNetwork, networkId, setNetworkId, isSepolia } = useNetwork();
  const { showToast } = useToast();
  
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState<ScopedSessionKey | null>(null);
  const [prices, setPrices] = useState<TokenPrices>(() => priceService.getCachedPrices());
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const networkDropdownRef = useRef<HTMLDivElement>(null);

  // Poll live token prices
  useEffect(() => {
    priceService.getPrices().then(setPrices).catch(() => {});
    const interval = setInterval(() => {
      priceService.getPrices().then(setPrices).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Sync session key state
  useEffect(() => {
    if (wallet.address) {
      setSessionKey(sessionKeyService.getSession(wallet.address));
    } else {
      setSessionKey(null);
    }
  }, [wallet.address]);

  const handleCopyAddress = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!wallet.address) return;
    
    const success = await copyToClipboard(wallet.address);
    if (success) {
      setCopied(true);
      showToast({
        type: 'success',
        title: 'Address Copied',
        description: `${shortenAddress(wallet.address, 6)} copied to clipboard.`,
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast({
        type: 'error',
        title: 'Failed to Copy',
        description: 'Could not copy address to clipboard.',
      });
    }
  };

  const handleToggleSessionKey = () => {
    if (!wallet.address) {
      showToast({ 
        type: 'error', 
        title: 'Connect Wallet', 
        description: 'Connect your Starknet wallet to enable 1-click execution.' 
      });
      return;
    }

    if (sessionKey && sessionKey.isActive) {
      sessionKeyService.revokeSession(wallet.address);
      setSessionKey(null);
      showToast({ 
        type: 'info', 
        title: 'Session Revoked', 
        description: 'Reverted to standard signature verification.' 
      });
    } else {
      const newSession = sessionKeyService.createSession(wallet.address, 5000, 8);
      setSessionKey(newSession);
      showToast({
        type: 'success',
        title: '1-Click Fast Execution Enabled',
        description: 'Scoped STARK session key authorized for 8h ($5,000 allowance).',
      });
    }
  };

  // Selecting a network with a connected wallet prompts the wallet (via the official
  // wallet_switchStarknetChain Wallet API) to switch chains. On decline/error the app
  // stays on the wallet's actual chain.
  const handleSelectNetwork = async (target: 'mainnet' | 'sepolia') => {
    setNetworkDropdownOpen(false);
    if (wallet.isConnected && wallet.refreshWalletChain) {
      const targetChain = target === 'sepolia' ? SN_SEPOLIA_CHAIN_ID : SN_MAIN_CHAIN_ID;
      const res = await strk20WalletApiService.switchWalletNetwork(wallet, targetChain);
      if (res.status === 'USER_REJECTED') {
        showToast({ type: 'error', title: 'Network Switch Declined', description: 'You declined the network switch in your wallet.' });
        await wallet.refreshWalletChain();
        return;
      }
      if (res.status === 'CHAIN_UNSUPPORTED') {
        showToast({ type: 'error', title: 'Network Not Supported', description: res.message });
        return;
      }
      if (res.status === 'ERROR') {
        showToast({ type: 'error', title: 'Switch Failed', description: res.message });
        return;
      }
      await wallet.refreshWalletChain();
    }
    setNetworkId(target);
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setWalletDropdownOpen(false);
      }
      if (networkDropdownRef.current && !networkDropdownRef.current.contains(event.target as Node)) {
        setNetworkDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-16 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 font-mono select-none sticky top-0 z-30">
      {/* Left: Quick Search / Command Bar + Home Link */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <Link
          href="/"
          title="Return to Landing Manifesto"
          className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-orrange-500/50 text-zinc-400 hover:text-white text-xs font-bold transition-all shrink-0"
        >
          <Home className="w-3.5 h-3.5" />
          <span>Home</span>
        </Link>

        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onSearchIntent) {
                onSearchIntent(searchQuery);
              }
            }}
            placeholder="Search assets, intents, or enter /..."
            className="w-full pl-8 pr-8 py-1.5 bg-zinc-900/80 border border-zinc-800 focus:border-orrange-500 text-xs text-white placeholder-zinc-600 outline-none transition-all rounded-none"
          />
          <span className="hidden sm:inline-block absolute right-2.5 top-1/2 -translate-y-1/2 px-1 bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-400 font-bold">
            /
          </span>
        </div>
      </div>

      {/* Center: Live Token Tickers (Hidden on very small screens) */}
      <div className="hidden lg:flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-zinc-400 font-bold">STRK</span>
          <span className="text-white font-bold">${prices.STRK ? prices.STRK.toFixed(3) : '0.584'}</span>
          <span className="text-[10px] text-emerald-400 font-bold">+8.4%</span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-zinc-400 font-bold">ETH</span>
          <span className="text-white font-bold">${prices.ETH ? prices.ETH.toLocaleString() : '3,418'}</span>
          <span className="text-[10px] text-rose-400 font-bold">-1.2%</span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-zinc-400 font-bold">BTC</span>
          <span className="text-white font-bold">$96,420</span>
          <span className="text-[10px] text-emerald-400 font-bold">+2.8%</span>
        </div>
      </div>

      {/* Right Controls: Fast Session Key + Network Switcher + Wallet */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* 1-Click Fast Execution Session Key Toggle */}
        <button
          onClick={handleToggleSessionKey}
          title={
            sessionKey && sessionKey.isActive
              ? 'Fast 1-Click Execution Active ($5,000 allowance)'
              : 'Enable Fast 1-Click Execution (Scoped Session Key)'
          }
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold uppercase transition-all corner-box cursor-pointer border ${
            sessionKey && sessionKey.isActive
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-sm shadow-emerald-950/50'
              : 'border-zinc-800 bg-zinc-900/80 text-zinc-400 hover:text-white hover:border-zinc-700'
          }`}
        >
          <Zap className={`w-3.5 h-3.5 ${sessionKey?.isActive ? 'text-emerald-400 fill-emerald-400' : 'text-zinc-500'}`} />
          <span className="hidden sm:inline">1-Click</span>
          {sessionKey?.isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>

        {/* Network Switcher Dropdown */}
        <div className="relative" ref={networkDropdownRef}>
          <button
            onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 text-xs font-bold transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden sm:inline">{currentNetwork.label}</span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>

          {networkDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-zinc-950 border border-zinc-800 shadow-2xl z-50 p-1.5 space-y-1">
<button
                  onClick={() => handleSelectNetwork('mainnet')}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-left transition-colors ${
                    networkId === 'mainnet'
                      ? 'bg-orrange-500 text-black'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                  }`}
                >
                  <span>Starknet Mainnet</span>
                  {networkId === 'mainnet' && <CheckCircle2 className="w-3.5 h-3.5" />}
                </button>

                <button
                  onClick={() => handleSelectNetwork('sepolia')}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-left transition-colors ${
                    networkId === 'sepolia'
                      ? 'bg-orrange-500 text-black'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                  }`}
                >
                  <span>Sepolia Testnet</span>
                  {networkId === 'sepolia' && <CheckCircle2 className="w-3.5 h-3.5" />}
                </button>
            </div>
          )}
        </div>

        {/* Connected Wallet Button & Dropdown */}
        <div className="relative flex items-center" ref={dropdownRef}>
          {wallet.isConnected ? (
            <div className="flex items-center bg-zinc-900 border border-zinc-800 hover:border-orrange-500 transition-all">
              {/* Click to Copy Address Button */}
              <button
                onClick={handleCopyAddress}
                title="Click to copy wallet address to clipboard"
                className="flex items-center gap-2 px-3 py-1.5 text-white text-xs font-bold transition-all cursor-pointer hover:bg-zinc-800 group"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {copied ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      COPIED!
                    </span>
                  ) : (
                    shortenAddress(wallet.address || '')
                  )}
                </span>
                {!copied && (
                  <Copy className="w-3 h-3 text-zinc-500 group-hover:text-orrange-400 transition-colors ml-0.5" />
                )}
              </button>

              {/* Dropdown Toggle */}
              <button
                onClick={() => setWalletDropdownOpen(!walletDropdownOpen)}
                title="Wallet options"
                className="px-2 py-1.5 border-l border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => wallet.connectWallet()}
              disabled={wallet.isConnecting}
              className="px-3.5 py-1.5 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-orrange-950/40 cursor-pointer"
            >
              {wallet.isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          )}

          {walletDropdownOpen && wallet.isConnected && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-950 border border-zinc-800 shadow-2xl z-50 p-2 space-y-2">
              {/* Clickable connected account card to copy */}
              <button
                onClick={handleCopyAddress}
                className="w-full text-left p-2.5 bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 hover:border-orrange-500/50 text-xs transition-all group cursor-pointer"
                title="Click to copy full address"
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-500 uppercase font-bold">
                  <span>Connected Account</span>
                  <span className="text-orrange-400 font-bold flex items-center gap-1 group-hover:underline">
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="font-bold text-white break-all text-[11px] mt-1 font-mono">
                  {wallet.address}
                </div>
              </button>

              <button
                onClick={handleCopyAddress}
                className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-bold text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-orrange-400" />
                  <span>Copy Address</span>
                </span>
                {copied && <span className="text-[10px] text-emerald-400 font-bold">✓ Copied</span>}
              </button>

              <a
                href={`${currentNetwork.explorerUrl}/contract/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-2.5 py-2 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                  <span>View on Voyager</span>
                </span>
              </a>

              <button
                onClick={() => {
                  wallet.openConnectModal?.();
                  setWalletDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-orrange-400 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                <span>Switch Wallet</span>
              </button>

              <div className="h-px bg-zinc-900 my-1" />

              <button
                onClick={() => {
                  wallet.disconnectWallet();
                  setWalletDropdownOpen(false);
                }}
                className="w-full text-left px-2.5 py-2 text-xs font-bold text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                Disconnect Wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
