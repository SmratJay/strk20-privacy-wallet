'use client';

import React from 'react';
import { Shield, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, RefreshCw, Lock, Globe } from 'lucide-react';
import { ShieldedBalance } from '@/services/privacyService';
import { formatTokenAmount } from '@/utils/formatters';

interface BalanceCardsProps {
  balances: ShieldedBalance[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectAction: (tab: 'SHIELD' | 'SEND' | 'UNSHIELD' | 'SWAP', tokenSymbol?: string) => void;
}

export const BalanceCards: React.FC<BalanceCardsProps> = ({
  balances,
  isLoading,
  onRefresh,
  onSelectAction,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      {/* 1. Shielded Private Balance Card */}
      <div className="relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br from-surface-elevated via-surface to-emerald-950/20 border border-emerald-500/30 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Shielded Private Pool
              </span>
              <p className="text-[11px] text-zinc-400">Encrypted Notes • UTXO Storage</p>
            </div>
          </div>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-surface-border transition-colors"
            title="Refresh Balances"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Shielded Token Rows */}
        <div className="space-y-2.5">
          {balances.map((b) => (
            <div
              key={b.token.symbol}
              className="flex items-center justify-between p-3 rounded-xl bg-surface/80 border border-surface-border/60 hover:border-emerald-500/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{b.token.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{b.token.symbol}</div>
                  <div className="text-[11px] text-zinc-400">{b.token.name}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-mono font-bold text-emerald-400">
                  {formatTokenAmount(b.shieldedBalance, b.token.decimals)} {b.token.symbol}
                </div>
                <div className="text-[10px] text-zinc-400 font-mono">
                  {b.shieldedBalance > 0n ? '🔒 100% Shielded' : 'No shielded notes'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => onSelectAction('SEND')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Send Privately</span>
          </button>
          <button
            onClick={() => onSelectAction('UNSHIELD')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-surface-elevated hover:bg-surface-border text-zinc-200 border border-surface-border text-xs font-semibold transition-all"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Unshield to Public</span>
          </button>
        </div>
      </div>

      {/* 2. Public Wallet Balance Card */}
      <div className="p-5 rounded-2xl bg-surface border border-surface-border shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                Public On-Chain Balance
              </span>
              <p className="text-[11px] text-zinc-400">Visible on Voyager & Block Explorers</p>
            </div>
          </div>
        </div>

        {/* Public Token Rows */}
        <div className="space-y-2.5">
          {balances.map((b) => (
            <div
              key={b.token.symbol}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated border border-surface-border"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{b.token.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-zinc-200">{b.token.symbol}</div>
                  <div className="text-[11px] text-zinc-400">{b.token.name}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-mono font-medium text-zinc-200">
                  {formatTokenAmount(b.publicBalance, b.token.decimals)} {b.token.symbol}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono">Public ERC-20</div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => onSelectAction('SHIELD')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-lg shadow-sky-600/20 transition-all"
          >
            <Shield className="w-4 h-4" />
            <span>Shield Tokens (Deposit)</span>
          </button>
          <button
            onClick={() => onSelectAction('SWAP')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-surface-elevated hover:bg-surface-border text-zinc-200 border border-surface-border text-xs font-semibold transition-all"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Private Swap (AVNU)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
