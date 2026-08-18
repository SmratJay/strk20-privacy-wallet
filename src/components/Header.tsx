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
  FileCheck2,
  Terminal,
  Layers,
  TrendingUp
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
  onLaunchTerminal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  wallet,
  onOpenPublishModal,
  onOpenAuditorModal,
  onOpenPassportModal,
  onLaunchTerminal,
}) => {
  const { currentNetwork, networkId, setNetworkId, isSepolia } = useNetwork();
  const { showToast } = useToast();
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [productsDropdownOpen, setProductsDropdownOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState<ScopedSessionKey | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const networkDropdownRef = useRef<HTMLDivElement>(null);
  const productsDropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setWalletDropdownOpen(false);
      }
      if (networkDropdownRef.current && !networkDropdownRef.current.contains(event.target as Node)) {
        setNetworkDropdownOpen(false);
      }
      if (productsDropdownRef.current && !productsDropdownRef.current.contains(event.target as Node)) {
        setProductsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="border-b border-zinc-800/80 bg-black/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left: Covalent-Style [ orrange ] Box Logo */}
        <div className="flex items-center gap-6">
          <a href="#" className="flex items-center gap-2 px-3 py-1.5 bg-black border border-zinc-800 hover:border-orrange-500 transition-colors corner-box group">
            <span className="w-2.5 h-2.5 bg-orrange-500 rounded-none inline-block shadow-sm shadow-orrange-500/50 group-hover:scale-110 transition-transform" />
            <span className="font-mono font-black text-sm text-white tracking-widest uppercase">
              ORRANGE
            </span>
          </a>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-mono font-semibold tracking-wider text-zinc-400">
            {/* Products Dropdown */}
            <div className="relative" ref={productsDropdownRef}>
              <button
                onClick={() => setProductsDropdownOpen(!productsDropdownOpen)}
                className="flex items-center gap-1 hover:text-orrange-400 transition-colors uppercase py-1"
              >
                <span>PRODUCTS</span>
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>

              {productsDropdownOpen && (
                <div className="absolute left-0 mt-2 w-56 bg-zinc-950 border border-zinc-800 shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 corner-box">
                  <div className="p-1 space-y-1 text-xs">
                    <button
                      onClick={() => {
                        onLaunchTerminal?.();
                        setProductsDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-300 hover:bg-zinc-900 hover:text-orrange-400 transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <div>
                        <div className="font-bold">Intent Trade Router</div>
                        <div className="text-[10px] text-zinc-500">Multi-Venue Spot Swaps</div>
                      </div>
                    </button>

                    <button
                      onClick={() => {
                        onLaunchTerminal?.();
                        setProductsDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-300 hover:bg-zinc-900 hover:text-orrange-400 transition-colors"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      <div>
                        <div className="font-bold">Private Perpetuals</div>
                        <div className="text-[10px] text-zinc-500">ZK Margin & Commitments</div>
                      </div>
                    </button>

                    <button
                      onClick={() => {
                        onLaunchTerminal?.();
                        setProductsDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-zinc-300 hover:bg-zinc-900 hover:text-orrange-400 transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                      <div>
                        <div className="font-bold">Shielded Earn Vaults</div>
                        <div className="text-[10px] text-zinc-500">Lending & Staking Yield</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <a href="#terminal" onClick={onLaunchTerminal} className="hover:text-orrange-400 transition-colors uppercase">
              SUPER-APP
            </a>

            <a href="#architecture" className="hover:text-orrange-400 transition-colors uppercase">
              ARCHITECTURE
            </a>

            <button
              onClick={onOpenPassportModal || onOpenAuditorModal}
              className="hover:text-orrange-400 transition-colors uppercase text-left"
            >
              COMPLIANCE
            </button>
          </nav>
        </div>

        {/* Right: Actions, Network Switcher & Wallet */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Faucet Link (Sepolia) */}
          {isSepolia && (
            <a
              href="https://starknet-faucet.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs font-mono font-semibold transition-colors"
            >
              <Droplets className="w-3.5 h-3.5" />
              <span>Faucet</span>
            </a>
          )}

          {/* 1-Click Session Key */}
          {wallet.isConnected && (
            <button
              onClick={handleToggleSessionKey}
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 border text-xs font-mono font-bold transition-all ${
                sessionKey
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-white'
              }`}
              title="1-Click Fast Execution Mode"
            >
              <Zap className={`w-3 h-3 ${sessionKey ? 'text-emerald-400' : 'text-zinc-500'}`} />
              <span>{sessionKey ? '1-Click Active' : '1-Click Off'}</span>
            </button>
          )}

          {/* Network Switcher Toggle */}
          <div className="relative" ref={networkDropdownRef}>
            <button
              onClick={() => setNetworkDropdownOpen(!networkDropdownOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-mono font-bold transition-all ${
                isSepolia
                  ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                  : 'border-orrange-500/40 bg-orrange-950/30 text-orrange-300'
              }`}
            >
              <span>{isSepolia ? '🧪 SEPOLIA' : '⚡ MAINNET'}</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {networkDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-zinc-950 border border-zinc-800 shadow-2xl p-1 z-50 corner-box">
                <button
                  onClick={() => {
                    setNetworkId('mainnet');
                    setNetworkDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono font-bold text-left ${
                    !isSepolia ? 'bg-orrange-500/20 text-orrange-300' : 'text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <span>Starknet Mainnet</span>
                  {!isSepolia && <CheckCircle2 className="w-3.5 h-3.5 text-orrange-400" />}
                </button>
                <button
                  onClick={() => {
                    setNetworkId('sepolia');
                    setNetworkDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono font-bold text-left ${
                    isSepolia ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <span>Sepolia Testnet</span>
                  {isSepolia && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Wallet Dropdown / Connect */}
          <div className="relative" ref={dropdownRef}>
            {wallet.isConnected ? (
              <button
                onClick={() => setWalletDropdownOpen(!walletDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-mono font-bold text-white transition-all"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{shortenAddress(wallet.address)}</span>
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>
            ) : (
              <button
                onClick={() => wallet.connect()}
                disabled={wallet.isConnecting}
                className="px-4 py-1.5 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-mono text-xs font-black tracking-wider uppercase transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {wallet.isConnecting ? 'CONNECTING...' : 'CONNECT WALLET'}
              </button>
            )}

            {/* Wallet Menu */}
            {walletDropdownOpen && wallet.isConnected && (
              <div className="absolute right-0 mt-2 w-56 bg-zinc-950 border border-zinc-800 shadow-2xl p-1.5 z-50 corner-box">
                <div className="px-3 py-2 border-b border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Connected Wallet</div>
                  <div className="text-xs font-mono font-bold text-white truncate">{wallet.address}</div>
                </div>
                <div className="p-1 space-y-0.5 font-mono text-xs">
                  <button
                    onClick={() => {
                      onOpenPublishModal();
                      setWalletDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-orrange-400 transition-colors"
                  >
                    <Key className="w-3.5 h-3.5 text-orrange-400" />
                    <span>Viewing Key Escrow</span>
                  </button>
                  <a
                    href={`${currentNetwork.explorerUrl}/contract/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-zinc-300 hover:bg-zinc-900 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Explorer Record</span>
                  </a>
                  <button
                    onClick={() => {
                      wallet.disconnect();
                      setWalletDropdownOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-rose-400 hover:bg-rose-500/10 transition-colors"
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
