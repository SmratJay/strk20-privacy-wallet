'use client';

import React, { useState } from 'react';
import { X, ShieldCheck, ExternalLink, CheckCircle2, AlertCircle, RefreshCw, Wallet } from 'lucide-react';
import { SupportedWalletMeta } from '@/hooks/useStarknetWallet';

interface ConnectWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  supportedWallets: SupportedWalletMeta[];
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
  isConnecting,
  connectingWalletId,
  connectionError,
  onSelectWallet,
  onRescan,
}) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div
        className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-zinc-100">Connect your privacy wallet</h3>
            <p className="text-[13px] text-zinc-500 leading-relaxed">
              To use STRK20 private payments, connect a compatible Starknet privacy wallet. This
              app does not custody your funds — your wallet does.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error */}
        {connectionError && (
          <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-[13px] text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{connectionError}</span>
          </div>
        )}

        {/* Install reminder */}
        {installPromptWallet && (
          <div className="flex items-start justify-between gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[13px] text-amber-200">
            <div className="space-y-1">
              <span className="block font-medium text-amber-100">
                Opening {installPromptWallet.name} install page
              </span>
              <span className="text-[12px]">After installing, click Rescan or refresh.</span>
            </div>
            {onRescan && (
              <button
                onClick={onRescan}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 text-[12px] font-medium transition-colors shrink-0"
              >
                Rescan
              </button>
            )}
          </div>
        )}

        {/* Wallet options */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">
              Compatible privacy wallet
            </span>
            {onRescan && (
              <button
                onClick={onRescan}
                className="flex items-center gap-1 text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rescan
              </button>
            )}
          </div>

          {supportedWallets.map((wallet) => {
            const isTargetConnecting = isConnecting && connectingWalletId === wallet.id;
            return (
              <button
                key={wallet.id}
                onClick={() => handleWalletClick(wallet)}
                disabled={isConnecting}
                className={`w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                  wallet.isPrivacyNative
                    ? 'border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10'
                    : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900'
                } ${isTargetConnecting ? 'ring-1 ring-violet-500' : ''}`}
              >
                <div className="w-10 h-10 rounded-xl bg-zinc-800/80 flex items-center justify-center text-zinc-300 shrink-0">
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{wallet.name}</span>
                    {wallet.badge && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-200">
                        {wallet.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-zinc-500 truncate mt-0.5">{wallet.tagline}</p>
                </div>
                {isTargetConnecting ? (
                  <RefreshCw className="w-4 h-4 text-violet-300 animate-spin shrink-0" />
                ) : wallet.isDetected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-zinc-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Install CTA */}
        {supportedWallets[0]?.chromeUrl && (
          <a
            href={supportedWallets[0].chromeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-[13px] font-medium transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-violet-300" />
            Install Ready from the Chrome Web Store
          </a>
        )}

        <p className="text-[11px] text-zinc-600 leading-relaxed">
          STRK20 privacy requires a compatible privacy wallet. Your viewing keys, notes, and proofs
          stay in your wallet — this app never sees them.
        </p>
      </div>
    </div>
  );
};
