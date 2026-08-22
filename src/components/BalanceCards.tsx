'use client';

import React from 'react';
import { Shield, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, RefreshCw, Lock, Globe, Zap, Database } from 'lucide-react';
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
  const totalShieldedNotes = balances.reduce((acc, b) => acc + (b.pendingNotesCount || 0), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 font-mono">
      {/* 1. Shielded Private Balance Card */}
      <div className="p-5 bg-zinc-950 border border-orrange-500/50 corner-box shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-orrange-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orrange-500 animate-pulse" />
                <span>SHIELDED PRIVATE POOL</span>
              </span>
              <p className="text-[10px] text-zinc-500 uppercase">Encrypted UTXO Notes • Stwo Substrate</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {totalShieldedNotes > 0 && (
              <span className="text-[10px] px-2 py-0.5 bg-orrange-950/60 text-orrange-300 font-bold border border-orrange-500/40">
                {totalShieldedNotes} {totalShieldedNotes === 1 ? 'NOTE' : 'NOTES'}
              </span>
            )}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 text-zinc-400 hover:text-orrange-400 hover:bg-zinc-900 border border-zinc-800 transition-colors"
              title="Refresh Balances"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Shielded Token Rows */}
        <div className="space-y-2">
          {balances.map((b) => (
            <div
              key={b.token.symbol}
              className="flex items-center justify-between p-2.5 bg-zinc-900/60 border border-zinc-800/80 hover:border-orrange-500/40 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-lg">{b.token.icon}</span>
                <div>
                  <div className="text-xs font-bold text-white">{b.token.symbol}</div>
                  <div className="text-[10px] text-zinc-500">{b.token.name}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold text-orrange-400">
                  {formatTokenAmount(b.shieldedBalance, b.token.decimals)} {b.token.symbol}
                </div>
                <div className="text-[9px] text-zinc-500 uppercase">
                  {b.shieldedBalance > 0n
                    ? `[ 🔒 ${b.pendingNotesCount || 1} SPENDABLE UTXO ]`
                    : '[ ZERO NOTES ]'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => onSelectAction('SEND')}
            className="flex items-center justify-center gap-1.5 py-2 px-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black text-xs font-bold uppercase transition-all"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Send Privately</span>
          </button>
          <button
            onClick={() => onSelectAction('UNSHIELD')}
            className="flex items-center justify-center gap-1.5 py-2 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white text-xs font-bold uppercase transition-all"
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Unshield</span>
          </button>
        </div>
      </div>

      {/* 2. Public Wallet Balance Card */}
      <div className="p-5 bg-zinc-950 border border-zinc-800 corner-box shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Public On-Chain Balance
              </span>
              <p className="text-[10px] text-zinc-500 uppercase">Transparent ERC-20 Ledger</p>
            </div>
          </div>
          <span className="text-[10px] text-zinc-600">[ VOYAGER_SYNCED ]</span>
        </div>

        {/* Public Token Rows */}
        <div className="space-y-2">
          {balances.map((b) => (
            <div
              key={b.token.symbol}
              className="flex items-center justify-between p-2.5 bg-zinc-900/60 border border-zinc-800/80"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-lg">{b.token.icon}</span>
                <div>
                  <div className="text-xs font-bold text-zinc-300">{b.token.symbol}</div>
                  <div className="text-[10px] text-zinc-500">{b.token.name}</div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold text-zinc-200">
                  {b.publicBalanceAvailable
                    ? `${formatTokenAmount(b.publicBalance, b.token.decimals)} ${b.token.symbol}`
                    : '— (RPC unavailable)'}
                </div>
                <div className="text-[9px] text-zinc-600 uppercase">
                  {b.publicBalanceAvailable ? '[ PUBLIC ]' : '[ OFFLINE — NOT A ZERO ]'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => onSelectAction('SHIELD')}
            className="flex items-center justify-center gap-1.5 py-2 px-3 border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold uppercase transition-all"
          >
            <Shield className="w-3.5 h-3.5 text-orrange-400" />
            <span>Shield (Deposit)</span>
          </button>
          <button
            onClick={() => onSelectAction('SWAP')}
            className="flex items-center justify-center gap-1.5 py-2 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white text-xs font-bold uppercase transition-all"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Trade Router</span>
          </button>
        </div>
      </div>
    </div>
  );
};
