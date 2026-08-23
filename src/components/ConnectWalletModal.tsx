'use client';

import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Sparkles, 
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Wallet
} from 'lucide-react';
import { SupportedWalletMeta } from '@/hooks/useStarknetWallet';

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  supportedWallets: SupportedWalletMeta[];
  otherWallets?: any[];
  isConnecting: boolean;
  connectingWalletId: string | null;
  connectionError: string | null;
  onSelectWallet: (wallet: SupportedWalletMeta | any) => Promise<void>;
  onRescan?: () => void;
}

export const ConnectWalletModal: React.FC<ConnectWalletModalProps> = ({
  isOpen,
  onClose,
  supportedWallets,
  otherWallets = [],
  isConnecting,
  connectingWalletId,
  connectionError,
  onSelectWallet,
  onRescan,
}) => {
  const [showOtherWallets, setShowOtherWallets] = useState(false);
  const [installPromptWallet, setInstallPromptWallet] = useState<SupportedWalletMeta | null>(null);

  if (!isOpen) return null;

  const handleWalletClick = async (wallet: SupportedWalletMeta) => {
    if (!wallet.isDetected) {
      setInstallPromptWallet(wallet);
      if (typeof window !== 'undefined') {
        window.open(wallet.downloadUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    setInstallPromptWallet(null);
    await onSelectWallet(wallet);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md font-mono select-none animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-lg bg-zinc-950 border border-orrange-500/60 corner-box shadow-2xl overflow-hidden p-5 sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-zinc-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orrange-500/10 border border-orrange-500/40 text-orrange-400">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  Connect Wallet
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-800 font-bold">
                  STARKNET
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Select your preferred Starknet wallet to connect
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* STRK20 Privacy Recommendation Callout */}
        <div className="p-3 bg-zinc-900/70 border border-orrange-500/30 text-xs flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-orrange-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-zinc-300 leading-relaxed">
            <span className="font-bold text-white uppercase mr-1">Ready Wallet Recommended:</span>
            <span>
              Supports native STRK20 zero-knowledge shielded transactions, confidential balances, and in-wallet proving.
            </span>
          </div>
        </div>

        {/* Error Banner if any */}
        {connectionError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1 text-[11px]">
              <span className="font-bold uppercase block text-rose-200">Connection Failed</span>
              <span className="text-rose-300/90">{connectionError}</span>
            </div>
          </div>
        )}

        {/* Install Reminder Banner */}
        {installPromptWallet && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start justify-between gap-2 animate-in fade-in">
            <div className="text-[11px]">
              <span className="font-bold uppercase block text-amber-300">
                Opening {installPromptWallet.name} Install Page
              </span>
              <span>After installing the browser extension, click Rescan or refresh.</span>
            </div>
            {onRescan && (
              <button
                onClick={onRescan}
                className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[10px] font-bold uppercase transition-colors shrink-0 cursor-pointer"
              >
                Rescan
              </button>
            )}
          </div>
        )}

        {/* 3 Core Supported Wallets List */}
        <div className="space-y-2.5">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center justify-between">
            <span>Supported Starknet Wallets</span>
            {onRescan && (
              <button
                onClick={onRescan}
                className="flex items-center gap-1 text-zinc-500 hover:text-orrange-400 transition-colors cursor-pointer text-[10px]"
                title="Rescan installed extensions"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Rescan</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {supportedWallets.map((wallet) => {
              const isTargetConnecting = isConnecting && connectingWalletId === wallet.id;

              return (
                <button
                  key={wallet.id}
                  onClick={() => handleWalletClick(wallet)}
                  disabled={isConnecting}
                  className={`w-full p-3.5 flex items-center justify-between border transition-all text-left group cursor-pointer ${
                    wallet.isPrivacyNative
                      ? 'bg-zinc-900/80 hover:bg-zinc-900 border-orrange-500/50 hover:border-orrange-500 shadow-md shadow-orrange-950/20'
                      : 'bg-zinc-900/50 hover:bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                  } ${isTargetConnecting ? 'ring-1 ring-orrange-500 bg-zinc-900' : ''}`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Wallet Custom Icon Badge */}
                    <div className={`w-10 h-10 flex items-center justify-center border shrink-0 transition-transform group-hover:scale-105 ${
                      wallet.id === 'ready'
                        ? 'bg-orrange-500/10 border-orrange-500/40 text-orrange-400'
                        : wallet.id === 'braavos'
                        ? 'bg-sky-500/10 border-sky-500/40 text-sky-400'
                        : 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                    }`}>
                      {wallet.id === 'ready' ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm0 2.18l7 3.89v4.93c0 4.54-3.05 8.79-7 9.87-3.95-1.08-7-5.33-7-9.87V8.07l7-3.89zM11 7v6h4v-2h-2V7h-2z" />
                        </svg>
                      ) : wallet.id === 'braavos' ? (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm0 2.24l6 2.25v4.6c0 3.99-2.61 7.74-6 8.77-3.39-1.03-6-4.78-6-8.77V6.49l6-2.25zM8 9h4.5a2.5 2.5 0 012.5 2.5v.5a2.5 2.5 0 01-2.5 2.5H8V9zm2 1.8v1.4h2.5a.7.7 0 00.7-.7.7.7 0 00-.7-.7H10z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 3h4l8 12v6h-4L6 9V3zm8 0h4v4l-4 6-4-6V3h4zM6 15l4 6H6v-6z" />
                        </svg>
                      )}
                    </div>

                    {/* Wallet Details */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white uppercase tracking-wide truncate">
                          {wallet.name}
                        </span>
                        {wallet.badge && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 border shrink-0 ${
                            wallet.badgeType === 'recommended'
                              ? 'bg-orrange-500/20 text-orrange-400 border-orrange-500/40'
                              : wallet.badgeType === 'smart'
                              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                              : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          }`}>
                            {wallet.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {wallet.tagline}
                      </p>
                    </div>
                  </div>

                  {/* Status & Action */}
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {isTargetConnecting ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orrange-500/10 border border-orrange-500/40 text-orrange-400 text-[10px] font-bold">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Connecting...</span>
                      </div>
                    ) : wallet.isDetected ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold group-hover:bg-emerald-500 group-hover:text-black transition-colors">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Detected</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-[10px] font-bold group-hover:border-zinc-500 group-hover:text-white transition-colors">
                        <span>Install</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Other Detected Wallets Collapsible */}
        {otherWallets && otherWallets.length > 0 && (
          <div className="pt-2 border-t border-zinc-900 space-y-2">
            <button
              onClick={() => setShowOtherWallets(!showOtherWallets)}
              className="w-full flex items-center justify-between text-[10px] font-bold text-zinc-500 hover:text-zinc-400 uppercase tracking-widest transition-colors cursor-pointer py-1"
            >
              <span>Other Detected Wallets ({otherWallets.length})</span>
              {showOtherWallets ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showOtherWallets && (
              <div className="space-y-1.5 animate-in fade-in duration-100">
                {otherWallets.map((other) => (
                  <button
                    key={other.id}
                    onClick={() => onSelectWallet(other)}
                    disabled={isConnecting}
                    className="w-full p-2.5 bg-zinc-900/40 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between text-xs transition-colors cursor-pointer"
                  >
                    <span className="font-bold text-zinc-300">{other.name}</span>
                    <span className="text-[10px] text-emerald-400 font-bold">Detected →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer info & help link */}
        <div className="pt-3 border-t border-zinc-900 text-[10px] text-zinc-500 flex items-center justify-between">
          <span>Starknet Cairo v2 • Wallet API ≥ 0.10</span>
          <a
            href="https://www.starknet.io/ecosystem/wallets/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-orrange-400 transition-colors flex items-center gap-1"
          >
            <span>Wallet Guide</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
