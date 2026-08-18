'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  Key, 
  ChevronDown, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  FileText, 
  Droplets, 
  Sparkles, 
  Zap,
  Lock,
  FileCheck2
} from 'lucide-react';
import { shortenAddress } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';
import { sessionKeyService, ScopedSessionKey } from '@/services/sessionKeyService';
import { useToast } from '@/components/Toast';

interface HeaderProps {
  wallet: any;
  onOpenPublishModal: () => void;
  onOpenAuditorModal: () => void;
  onOpenPassportModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  wallet,
  onOpenPublishModal,
  onOpenAuditorModal,
  onOpenPassportModal,
}) => {
  const { currentNetwork, networkId, setNetworkId, isSepolia } = useNetwork();
  const { showToast } = useToast();
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState<ScopedSessionKey | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const networkDropdownRef = useRef<HTMLDivElement>(null);

  // Check active session key
  useEffect(() => {
    if (wallet.address) {
      setSessionKey(sessionKeyService.getSession(wallet.address));
    } else {
      setSessionKey(null);
    }
  }, [wallet.address]);

  const handleToggleSessionKey = () => {
    if (!wallet.address) {
      showToast({ type: 'error', title: 'Connect Wallet', description: 'Connect your wallet to enable 1-click execution.' });
      return;
    }

    if (sessionKey && sessionKey.isActive) {
      sessionKeyService.revokeSession(wallet.address);
      setSessionKey(null);
      showToast({ type: 'info', title: 'Session Revoked', description: 'Reverted to standard signature verification.' });
    } else {
      const newSession = sessionKeyService.createSession(wallet.address, 5000, 8);
      setSessionKey(newSession);
      showToast({
        type: 'success',
        title: '1-Click Fast Execution Enabled',
        description: 'Scoped session key authorized for 8h ($5,000 allowance).',
      });
    }
  };

  // Close dropdowns on click outside or escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setWalletDropdownOpen(false);
      }
      if (networkDropdownRef.current && !networkDropdownRef.current.contains(event.target as Node)) {
        setNetworkDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWalletDropdownOpen(false);
        setNetworkDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left: Branding */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 via-purple-600/20 to-indigo-500/20 border border-purple-500/40 text-purple-400 font-bold text-lg shadow-lg shadow-purple-500/10">
            <Shield className="w-5 h-5 text-purple-400" />
            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${isSepolia ? 'bg-amber-400' : 'bg-emerald-500'} ring-2 ring-zinc-950`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">PEL Super-App</h1>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400">
                Starknet Router
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
              <span className={isSepolia ? 'text-amber-400 font-semibold' : 'text-zinc-300'}>
                {currentNetwork.name}
              </span>
              <span>•</span>
              <a
                href={`${currentNetwork.explorerUrl}/contract/${currentNetwork.poolAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-0.5"
                title={`View ${currentNetwork.name} Pool Contract`}
              >
                <span>Pool: {shortenAddress(currentNetwork.poolAddress, 3)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        {/* Right: Actions, Network Switcher & Wallet */}
        <div className="flex items-center gap-2">
          {/* Sepolia Faucet Link */}
          {isSepolia && (
            <a
              href="https://starknet-faucet.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-semibold transition-colors"
            >
              <Droplets className="w-3.5 h-3.5" />
              <span>Faucet</span>
            </a>
          )}

          {/* 1-Click Fast Trading Session Key */}
          {wallet.isConnected && (
            <button
              onClick={handleToggleSessionKey}
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm ${
                sessionKey
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Enable 1-Click Session Keys (No signature popups)"
            >
              <Zap className={`w-3.5 h-3.5 ${sessionKey ? 'text-emerald-400' : 'text-zinc-500'}`} />
              <span>{sessionKey ? '1-Click Active' : 'Enable 1-Click'}</span>
            </button>
          )}

          {/* Compliance Passport Button */}
          <button
            onClick={onOpenPassportModal || onOpenAuditorModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-xs font-semibold transition-colors shadow-sm"
            title="Export ZK Compliance Passport & Viewing Key Escrow"
          >
            <FileCheck2 className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden sm:inline">Compliance</span>
          </button>

          {/* Network Switcher Toggle */}
          <div className="relative" ref={networkDropdownRef}>
            <button
              onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm ${
                isSepolia
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-900/40'
                  : 'bg-purple-950/40 border-purple-500/40 text-purple-300 hover:bg-purple-900/40'
              }`}
              title="Switch between Starknet Mainnet and Sepolia Testnet"
            >
              <span>{isSepolia ? '🧪 Sepolia' : '⚡ Mainnet'}</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {networkDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  Select Network
                </div>
                <button
                  onClick={() => {
                    setNetworkId('mainnet');
                    setNetworkDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors ${
                    !isSepolia ? 'bg-purple-600/20 text-purple-300 font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Starknet Mainnet
                  </span>
                  {!isSepolia && <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => {
                    setNetworkId('sepolia');
                    setNetworkDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-left transition-colors ${
                    isSepolia ? 'bg-amber-600/20 text-amber-300 font-bold' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Sepolia Testnet
                  </span>
                  {isSepolia && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Wallet Dropdown */}
          <div className="relative" ref={dropdownRef}>
            {wallet.isConnected ? (
              <button
                onClick={() => setWalletDropdownOpen(!walletDropdownOpen)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/70 text-xs font-medium text-white transition-all shadow-sm"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono">{shortenAddress(wallet.address)}</span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            ) : (
              <button
                onClick={() => wallet.connect()}
                disabled={wallet.isConnecting}
                className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-900/30 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {wallet.isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}

            {/* Wallet Dropdown Menu */}
            {walletDropdownOpen && wallet.isConnected && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-2 border-b border-zinc-800/80">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Connected Wallet</div>
                  <div className="text-xs font-mono font-semibold text-white truncate">{wallet.address}</div>
                </div>
                <div className="p-1 space-y-0.5">
                  <button
                    onClick={() => {
                      onOpenPublishModal();
                      setWalletDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Key className="w-3.5 h-3.5 text-purple-400" />
                    <span>Manage Viewing Key</span>
                  </button>
                  <a
                    href={`${currentNetwork.explorerUrl}/contract/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    <span>View on Voyager</span>
                  </a>
                  <button
                    onClick={() => {
                      wallet.disconnect();
                      setWalletDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
