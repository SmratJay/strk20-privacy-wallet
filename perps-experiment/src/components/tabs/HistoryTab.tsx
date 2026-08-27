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
    <div className="max-w-2xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <History className="w-4 h-4 text-orrange-400" />
            <span>Encrypted Activity & Note History</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Decrypted with client viewing key • Zero on-chain observer linkage
          </p>
        </div>

        {transactions.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase font-bold"
          >
            [CLEAR]
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        <div className="p-12 text-center bg-zinc-900/30 border border-dashed border-zinc-800 space-y-2">
          <Lock className="w-6 h-6 text-zinc-600 mx-auto" />
          <h3 className="text-xs font-bold text-white uppercase">No Encrypted Records Found</h3>
          <p className="text-[10px] text-zinc-500 max-w-sm mx-auto">
            Shield tokens or execute a private transfer to view encrypted activity here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="p-3 bg-zinc-900/60 border border-zinc-800 flex items-center justify-between hover:border-orrange-500/40 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-950 border border-zinc-800 text-zinc-300">
                  {tx.type === 'SHIELD' && <ShieldCheck className="w-3.5 h-3.5 text-orrange-400" />}
                  {tx.type === 'PRIVATE_TRANSFER' && <Lock className="w-3.5 h-3.5 text-emerald-400" />}
                  {tx.type === 'UNSHIELD' && <ArrowDownLeft className="w-3.5 h-3.5 text-amber-400" />}
                  {tx.type === 'SWAP' && <Sparkles className="w-3.5 h-3.5 text-purple-400" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white uppercase">
                      {tx.type === 'SHIELD' && 'Shielded Deposit'}
                      {tx.type === 'PRIVATE_TRANSFER' && 'Private Transfer'}
                      {tx.type === 'UNSHIELD' && 'Unshield Withdrawal'}
                      {tx.type === 'SWAP' && 'Private Swap'}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 bg-orrange-500/10 text-orrange-400 border border-orrange-500/30 uppercase font-bold">
                      Encrypted
                    </span>
                  </div>

                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {tx.privacyDetails}
                    {tx.recipient && (
                      <span className="text-zinc-300 ml-1">
                        → {shortenAddress(tx.recipient, 4)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs font-bold text-white">
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
                    className="text-[10px] text-zinc-500 hover:text-orrange-400 inline-flex items-center gap-1 font-mono mt-0.5"
                  >
                    <span>Tx: {shortenAddress(tx.txHash, 3)}</span>
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
