'use client';

import React, { useState } from 'react';
import { Shield, Key, ChevronDown, CheckCircle2, AlertCircle, ExternalLink, FileText } from 'lucide-react';
import { shortenAddress } from '@/utils/formatters';
import { STRK20_POOL_ADDRESS } from '@/config/tokens';

interface HeaderProps {
  wallet: any;
  onOpenPublishModal: () => void;
  onOpenAuditorModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({ wallet, onOpenPublishModal, onOpenAuditorModal }) => {
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);

  return (
    <header className="border-b border-surface-border bg-surface/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
        {/* Left: Branding */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-sky-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-lg shadow-lg shadow-emerald-500/10">
            <Shield className="w-5 h-5 text-emerald-400" />
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">STRK20 Privacy Wallet</h1>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                Umbra Mode
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
              <span>Starknet Mainnet</span>
              <span>•</span>
              <a
                href={`https://voyager.online/contract/${STRK20_POOL_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-emerald-400 transition-colors flex items-center gap-0.5"
              >
                <span>Pool: {shortenAddress(STRK20_POOL_ADDRESS, 3)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        {/* Right: Actions & Wallet */}
        <div className="flex items-center gap-2.5">
          {/* Compliance Proof Trigger */}
          {wallet.isConnected && (
            <button
              onClick={onOpenAuditorModal}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-purple-300 bg-purple-950/40 border border-purple-500/30 rounded-lg hover:bg-purple-900/40 transition-all"
              title="View Selective Disclosure Escrow Record"
            >
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span>Compliance</span>
            </button>
          )}

          {/* Publish Address Button */}
          {wallet.isConnected && (
            <button
              onClick={onOpenPublishModal}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg hover:bg-emerald-900/40 hover:border-emerald-500/50 transition-all shadow-sm"
              title="Publish your privacy address once so anyone can send to you"
            >
              <Key className="w-3.5 h-3.5 text-emerald-400" />
              <span>Publish Address</span>
            </button>
          )}

          {/* Wallet Connection */}
          <div className="relative">
            {wallet.isConnected ? (
              <div className="flex items-center gap-1.5 bg-surface-elevated border border-surface-border rounded-xl p-1 pr-3">
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-zinc-900 text-xs font-mono text-zinc-200">
                  <span className="text-sm">{wallet.walletIcon || '🛡️'}</span>
                  <span>{shortenAddress(wallet.address, 4)}</span>
                </div>

                {/* Capability Indicator */}
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
                  title={
                    wallet.isPrivacySupported
                      ? 'STRK20 Privacy API Active'
                      : 'Standard Starknet Wallet'
                  }
                >
                  {wallet.isPrivacySupported ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" />
                      <span className="hidden md:inline">STRK20 Ready</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400">
                      <AlertCircle className="w-3 h-3" />
                      <span className="hidden md:inline">Standard Mode</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={() => wallet.disconnectWallet()}
                  className="text-xs text-zinc-400 hover:text-rose-400 transition-colors ml-1"
                  title="Disconnect"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setWalletDropdownOpen(!walletDropdownOpen)}
                  disabled={wallet.isConnecting}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-lg shadow-emerald-600/20 transition-all"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{wallet.isConnecting ? 'Connecting...' : 'Connect Wallet'}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                </button>

                {walletDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 p-2 bg-surface-elevated border border-surface-border rounded-xl shadow-2xl z-50">
                    <p className="text-[11px] font-semibold text-zinc-400 px-2 py-1 uppercase tracking-wider">
                      Select Wallet
                    </p>
                    <div className="space-y-1">
                      {wallet.availableWallets.length > 0 ? (
                        wallet.availableWallets.map((w: any) => (
                          <button
                            key={w.id}
                            onClick={() => {
                              wallet.connectWallet(w);
                              setWalletDropdownOpen(false);
                            }}
                            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-zinc-200 hover:bg-surface-border transition-colors text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-base">{w.icon}</span>
                              <span>{w.name}</span>
                            </div>
                            {w.isPrivacyNative && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                STRK20
                              </span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="p-2 text-center">
                          <p className="text-xs text-zinc-400 mb-2">No wallet extension detected</p>
                          <button
                            onClick={() => {
                              wallet.connectWallet();
                              setWalletDropdownOpen(false);
                            }}
                            className="w-full py-1.5 px-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs text-zinc-200"
                          >
                            Connect Injected
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
