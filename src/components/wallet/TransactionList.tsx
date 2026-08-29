'use client';

import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Shield, EyeOff, CheckCircle2, Clock, X } from 'lucide-react';
import { PrivacyTransaction } from '@/services/privacyService';
import { shortenAddress } from '@/utils/formatters';

const TYPE_META: Record<
  PrivacyTransaction['type'],
  { label: string; direction: 'in' | 'out' | 'neutral'; Icon: typeof Shield }
> = {
  SHIELD: { label: 'Made private', direction: 'neutral', Icon: Shield },
  PRIVATE_TRANSFER: { label: 'Sent privately', direction: 'out', Icon: ArrowUpRight },
  UNSHIELD: { label: 'Made public', direction: 'in', Icon: ArrowDownLeft },
  SWAP: { label: 'Swap', direction: 'neutral', Icon: Shield },
};

const formatWhen = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const TransactionList: React.FC<{
  transactions: PrivacyTransaction[];
  onClear?: () => void;
  limit?: number;
}> = ({ transactions, onClear, limit }) => {
  const [detail, setDetail] = useState<PrivacyTransaction | null>(null);

  const list = limit ? transactions.slice(0, limit) : transactions;

  if (list.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center space-y-1.5">
        <p className="text-sm text-zinc-400">No activity yet</p>
        <p className="text-[12px] text-zinc-600">
          Your private payments will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {list.map((tx) => {
        const meta = TYPE_META[tx.type] ?? TYPE_META.SHIELD;
        const Icon = meta.Icon;
        const isOut = meta.direction === 'out';
        const isIn = meta.direction === 'in';
        const prefix = isOut ? '−' : isIn ? '+' : '';
        return (
          <button
            key={tx.id}
            onClick={() => setDetail(tx)}
            className="w-full flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900/60 px-4 py-3 transition-colors text-left"
          >
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                isOut
                  ? 'bg-rose-500/10 text-rose-300'
                  : isIn
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'bg-violet-500/10 text-violet-300'
              }`}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-zinc-100">{meta.label}</div>
              <div className="text-[11px] text-zinc-500">{formatWhen(tx.timestamp)}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-zinc-100 tabular-nums">
                {prefix}
                {tx.amount} {tx.tokenSymbol}
              </div>
              <div className="text-[11px] text-violet-300 flex items-center justify-end gap-1">
                <EyeOff className="w-3 h-3" />
                Private
              </div>
            </div>
          </button>
        );
      })}

      {onClear && (
        <div className="text-right">
          <button
            onClick={onClear}
            className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Clear activity
          </button>
        </div>
      )}

      {detail && (
        <div
          className="product-detail-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="product-detail-modal w-full sm:max-w-md bg-zinc-950 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">
                {TYPE_META[detail.type]?.label ?? 'Transaction'}
              </h3>
              <button
                onClick={() => setDetail(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Amount</span>
                <span className="text-zinc-100 font-medium tabular-nums">
                  {detail.amount} {detail.tokenSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className="flex items-center gap-1.5 text-zinc-100">
                  {detail.status === 'CONFIRMED' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : detail.status === 'FAILED' ? (
                    <X className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-400" />
                  )}
                  {detail.status}
                </span>
              </div>
              {detail.recipient && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">To</span>
                  <span className="text-zinc-100 font-mono text-right break-all">
                    {shortenAddress(detail.recipient, 10)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Privacy</span>
                <span className="text-violet-300 inline-flex items-center gap-1.5">
                  <EyeOff className="w-3.5 h-3.5" />
                  Private
                </span>
              </div>
              {detail.txHash && (
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Transaction</span>
                  <a
                    href={`https://sepolia.voyager.online/tx/${detail.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-300 font-mono break-all hover:underline"
                  >
                    {shortenAddress(detail.txHash, 10)}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
