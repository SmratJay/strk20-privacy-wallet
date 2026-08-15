'use client';

import React from 'react';
import { History, ExternalLink, ShieldCheck, Lock, ArrowUpRight, ArrowDownLeft, Sparkles } from 'lucide-react';
import { PrivacyTransaction } from '@/services/privacyService';
import { shortenAddress } from '@/utils/formatters';

interface HistoryTabProps {
  transactions: PrivacyTransaction[];
  onClear: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ transactions, onClear }) => {
  return (
    <div className="max-w-2xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            <span>Private Activity & Note History</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Local activity decrypted with your viewing key. Zero public history on-chain.
          </p>
        </div>

        {transactions.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear History
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        <div className="p-12 text-center rounded-xl bg-surface-elevated border border-surface-border">
          <Lock className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-zinc-300">No Private Transactions Yet</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            Shield tokens or send a private transfer to see encrypted note activity here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="p-3.5 rounded-xl bg-surface-elevated border border-surface-border flex items-center justify-between hover:border-emerald-500/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-zinc-900 text-zinc-200">
                  {tx.type === 'SHIELD' && <ShieldCheck className="w-4 h-4 text-sky-400" />}
                  {tx.type === 'PRIVATE_TRANSFER' && <Lock className="w-4 h-4 text-emerald-400" />}
                  {tx.type === 'UNSHIELD' && <ArrowDownLeft className="w-4 h-4 text-amber-400" />}
                  {tx.type === 'SWAP' && <Sparkles className="w-4 h-4 text-purple-400" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">
                      {tx.type === 'SHIELD' && 'Shielded Deposit'}
                      {tx.type === 'PRIVATE_TRANSFER' && 'Private Transfer'}
                      {tx.type === 'UNSHIELD' && 'Unshield Withdrawal'}
                      {tx.type === 'SWAP' && 'Private Swap'}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Encrypted
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {tx.privacyDetails}
                    {tx.recipient && (
                      <span className="font-mono text-zinc-300 ml-1">
                        → {shortenAddress(tx.recipient, 3)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-mono font-bold text-white">
                  {tx.type === 'SHIELD' && `+${tx.amount} ${tx.tokenSymbol}`}
                  {tx.type === 'PRIVATE_TRANSFER' && `-${tx.amount} ${tx.tokenSymbol}`}
                  {tx.type === 'UNSHIELD' && `-${tx.amount} ${tx.tokenSymbol}`}
                  {tx.type === 'SWAP' && `${tx.amount} ${tx.tokenSymbol}`}
                </div>

                {tx.txHash && (
                  <a
                    href={`https://voyager.online/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-zinc-500 hover:text-emerald-400 flex items-center justify-end gap-1 font-mono mt-0.5"
                  >
                    <span>{shortenAddress(tx.txHash, 3)}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
