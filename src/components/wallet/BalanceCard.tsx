'use client';

import React from 'react';
import { EyeOff, Wallet } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { formatTokenAmount } from '@/utils/formatters';

/**
 * Per-token private + public balance split. No fiat totals are invented — balances are
 * shown in their native token denomination.
 */
export const BalanceCard: React.FC = () => {
  const { balances, isLoadingBalances, privateBalancePermission } = useWallet();

  const totalPrivate = balances.reduce(
    (acc, b) => acc + (b.shieldedBalanceAvailable ? b.shieldedBalance : 0n),
    0n
  );
  const anyPrivateKnown = balances.some((b) => b.shieldedBalanceAvailable);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900/50 overflow-hidden">
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">
            Private balance
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-300">
            <EyeOff className="w-3.5 h-3.5" />
            Private
          </span>
        </div>

        {isLoadingBalances && !anyPrivateKnown ? (
          <div className="h-9 w-40 rounded-lg bg-zinc-800/60 animate-pulse" />
        ) : (
          <div className="text-3xl font-semibold text-zinc-100 tabular-nums">
            {anyPrivateKnown ? formatTokenAmount(totalPrivate, 18, 4) : '—'}
            <span className="ml-2 text-sm font-normal text-zinc-500">tokens</span>
          </div>
        )}

        {privateBalancePermission !== 'GRANTED' && (
          <p className="text-[12px] text-zinc-500">
            {privateBalancePermission === 'DENIED'
              ? 'Private balance hidden — you declined access.'
              : 'Connect and share private balances to see your shielded funds.'}
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800/70 divide-y divide-zinc-800/60">
        {balances.map((b) => {
          const privateKnown = b.shieldedBalanceAvailable;
          return (
            <div key={b.token.address} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-800/80 flex items-center justify-center text-sm">
                  {b.token.icon}
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-100">{b.token.symbol}</div>
                  <div className="text-[11px] text-zinc-500">Private</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-zinc-100 tabular-nums">
                  {privateKnown ? formatTokenAmount(b.shieldedBalance, b.token.decimals, 4) : '—'}
                </div>
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  <Wallet className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Public:{' '}
                  {b.publicBalanceAvailable
                    ? formatTokenAmount(b.publicBalance, b.token.decimals, 4)
                    : '—'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
