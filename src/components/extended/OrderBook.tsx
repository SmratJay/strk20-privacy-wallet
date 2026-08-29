'use client';

import React, { useMemo } from 'react';
import type { Orderbook } from '@/extended/types';

const fmt = (v: string | number | undefined, dp = 2): string => {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

interface OrderBookProps {
  book: Orderbook | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Click a level to fill the order form with that price. */
  onSelectPrice?: (price: string, side: 'BUY' | 'SELL') => void;
  levels?: number;
}

/**
 * Live order book with cumulative depth. Bids render best-first from the mid-line
 * downwards; asks render from the deepest price at the top to the best ask just above
 * the mid-line. Clicking any level populates the order form.
 */
export function OrderBook({ book, loading, error, onRetry, onSelectPrice, levels = 12 }: OrderBookProps) {
  const asks = book?.ask ?? [];
  const bids = book?.bid ?? [];

  // Display asks top→bottom with the best ask at the bottom (just above mid).
  const askRows = useMemo(() => [...asks].slice(0, levels).reverse(), [asks, levels]);
  const bidRows = useMemo(() => [...bids].slice(0, levels), [bids, levels]);

  // Cumulative depth accumulates from the BEST ask outward (best level first), then
  // reverses so it aligns with the top→bottom render order (deepest ask first).
  const askCum: number[] = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < askRows.length; i++) {
      const l = asks[i];
      acc += Number(l.qty) * Number(l.price);
      out.push(acc);
    }
    return out.reverse();
  }, [askRows, asks]);

  const bidCum: number[] = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const l of bidRows) {
      acc += Number(l.qty) * Number(l.price);
      out.push(acc);
    }
    return out;
  }, [bidRows]);

  const bestBid = Number(bids[0]?.price ?? 0);
  const bestAsk = Number(asks[0]?.price ?? 0);
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

  const maxCum = Math.max(askCum[0] ?? 0, bidCum[bidCum.length - 1] ?? 0, 1);

  return (
    <div className="text-[11px] font-mono">
      <div className="grid grid-cols-4 text-zinc-500 pb-1 border-b border-zinc-800/60 uppercase text-[9px] tracking-wider">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
        <span className="text-right">Depth</span>
      </div>

      {loading && !book ? (
        <div className="py-8 text-center text-zinc-600">Loading order book…</div>
      ) : error ? (
        <div className="py-8 text-center text-zinc-500">
          {error}
          {onRetry && (
            <button onClick={onRetry} className="ml-2 underline text-orange-400">
              Retry
            </button>
          )}
        </div>
      ) : !book || asks.length + bids.length === 0 ? (
        <div className="py-8 text-center text-zinc-600">Waiting for order book…</div>
      ) : (
        <>
          {/* Asks (deepest at top, best ask just above mid) */}
          {askRows.map((l, i) => {
            const price = Number(l.price);
            const cum = askCum[i] ?? 0;
            return (
              <button
                key={`a${i}-${l.price}`}
                onClick={() => onSelectPrice?.(l.price, 'SELL')}
                className="grid grid-cols-4 py-0.5 w-full text-left hover:bg-zinc-900/50 transition-colors"
                title="Click to place a sell at this price"
              >
                <span className="text-rose-400 font-bold">{fmt(price, 2)}</span>
                <span className="text-right text-zinc-300">{fmt(l.qty, 4)}</span>
                <span className="text-right text-zinc-500">{fmt(price * Number(l.qty), 2)}</span>
                <span className="relative text-right text-rose-400/60">
                  <span
                    className="absolute inset-y-0 right-0 bg-rose-500/10"
                    style={{ width: `${Math.min(100, (cum / maxCum) * 100)}%` }}
                  />
                  <span className="relative">{fmt(cum, 0)}</span>
                </span>
              </button>
            );
          })}

          {/* Mid line / spread */}
          <div className="my-1 py-1 border-y border-zinc-800/80 flex items-center justify-between text-[10px]">
            <span className="text-emerald-400 font-black">{fmt(bestBid, 2)}</span>
            <span className="text-zinc-600">
              Spread {fmt(spread, 2)} ({bestBid > 0 && bestAsk > 0 ? fmt((spread / bestAsk) * 100, 3) : '—'}%)
            </span>
            <span className="text-rose-400 font-black">{fmt(bestAsk, 2)}</span>
          </div>

          {/* Bids (best bid at top) */}
          {bidRows.map((l, i) => {
            const price = Number(l.price);
            const cum = bidCum[i] ?? 0;
            return (
              <button
                key={`b${i}-${l.price}`}
                onClick={() => onSelectPrice?.(l.price, 'BUY')}
                className="grid grid-cols-4 py-0.5 w-full text-left hover:bg-zinc-900/50 transition-colors"
                title="Click to place a buy at this price"
              >
                <span className="text-emerald-400 font-bold">{fmt(price, 2)}</span>
                <span className="text-right text-zinc-300">{fmt(l.qty, 4)}</span>
                <span className="text-right text-zinc-500">{fmt(price * Number(l.qty), 2)}</span>
                <span className="relative text-right text-emerald-400/60">
                  <span
                    className="absolute inset-y-0 right-0 bg-emerald-500/10"
                    style={{ width: `${Math.min(100, (cum / maxCum) * 100)}%` }}
                  />
                  <span className="relative">{fmt(cum, 0)}</span>
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}