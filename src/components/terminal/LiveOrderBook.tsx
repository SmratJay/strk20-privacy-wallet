'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Layers, Activity, ShieldCheck, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
  depthPct: number;
}

interface LiveOrderBookProps {
  marketId: string;
  currentPrice: number;
}

export const LiveOrderBook: React.FC<LiveOrderBookProps> = ({ marketId, currentPrice }) => {
  const [spreadMode, setSpreadMode] = useState<'ALL' | 'BIDS' | 'ASKS'>('ALL');
  const [tradeFeed, setTradeFeed] = useState<Array<{ id: string; price: number; size: number; side: 'BUY' | 'SELL'; time: string }>>([]);

  // Generate synthetic high-frequency ZK orderbook depth around current mark price
  const { asks, bids, spread, spreadPct } = useMemo(() => {
    if (currentPrice <= 0) return { asks: [], bids: [], spread: 0, spreadPct: 0 };

    const tickSize = currentPrice > 1000 ? 0.5 : 0.001;
    const askRows: OrderBookEntry[] = [];
    const bidRows: OrderBookEntry[] = [];

    let askTotal = 0;
    let bidTotal = 0;

    // Asks (Sells above market)
    for (let i = 5; i >= 1; i--) {
      const p = currentPrice + (i * tickSize * (1 + Math.random() * 0.4));
      const s = Number(((0.2 + Math.random() * 1.5) * (currentPrice > 1000 ? 1 : 100)).toFixed(3));
      askTotal += s;
      askRows.push({ price: p, size: s, total: askTotal, depthPct: Math.min(100, (askTotal / 10) * 100) });
    }

    // Bids (Buys below market)
    for (let i = 1; i <= 5; i++) {
      const p = currentPrice - (i * tickSize * (1 + Math.random() * 0.4));
      const s = Number(((0.2 + Math.random() * 1.5) * (currentPrice > 1000 ? 1 : 100)).toFixed(3));
      bidTotal += s;
      bidRows.push({ price: p, size: s, total: bidTotal, depthPct: Math.min(100, (bidTotal / 10) * 100) });
    }

    const lowestAsk = askRows[askRows.length - 1]?.price || currentPrice;
    const highestBid = bidRows[0]?.price || currentPrice;
    const spr = Math.max(0.01, lowestAsk - highestBid);
    const sprPct = (spr / currentPrice) * 100;

    return { asks: askRows, bids: bidRows, spread: spr, spreadPct: sprPct };
  }, [currentPrice]);

  // Live anonymous trade execution ticker
  useEffect(() => {
    if (currentPrice <= 0) return;
    const timer = setInterval(() => {
      const isBuy = Math.random() > 0.48;
      const deviation = (Math.random() - 0.5) * (currentPrice * 0.0004);
      const tradePrice = currentPrice + deviation;
      const tradeSize = Number(((Math.random() * 1.2 + 0.05) * (currentPrice > 1000 ? 1 : 50)).toFixed(3));

      const newTrade = {
        id: Math.random().toString(36).substring(2, 9),
        price: tradePrice,
        size: tradeSize,
        side: isBuy ? ('BUY' as const) : ('SELL' as const),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };

      setTradeFeed((prev) => [newTrade, ...prev.slice(0, 7)]);
    }, 2800);

    return () => clearInterval(timer);
  }, [currentPrice]);

  return (
    <div className="bg-[#121214] border border-[#27272a] rounded-xl p-3 text-xs flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#27272a]">
        <div className="flex items-center gap-1.5 font-medium text-[#a1a1aa]">
          <Layers className="w-3.5 h-3.5 text-[#a855f7]" />
          <span>Shielded Order Book</span>
        </div>
        <div className="flex items-center gap-1 bg-[#18181b] p-0.5 rounded border border-[#27272a]">
          {(['ALL', 'BIDS', 'ASKS'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSpreadMode(mode)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                spreadMode === mode ? 'bg-[#27272a] text-white font-semibold' : 'text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Table Headers */}
      <div className="grid grid-cols-3 text-[10px] text-[#71717a] font-mono pb-1 border-b border-[#1f1f23]">
        <span>Price (USD)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Orderbook Rows */}
      <div className="flex-1 flex flex-col justify-between py-1 font-mono text-[11px]">
        {/* Asks (Red) */}
        {(spreadMode === 'ALL' || spreadMode === 'ASKS') && (
          <div className="flex flex-col gap-0.5">
            {asks.slice(-4).map((ask, idx) => (
              <div key={idx} className="grid grid-cols-3 relative py-0.5 hover:bg-red-500/10 rounded px-1 group">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-500/10 pointer-events-none rounded"
                  style={{ width: `${ask.depthPct}%` }}
                />
                <span className="text-red-400 font-medium z-10">{ask.price.toFixed(currentPrice > 1000 ? 1 : 4)}</span>
                <span className="text-right text-[#a1a1aa] z-10">{ask.size}</span>
                <span className="text-right text-[#71717a] z-10">{ask.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Current Spread Bar */}
        <div className="my-1 py-1.5 px-2 bg-[#18181b] rounded border border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <span className={spreadPct >= 0 ? 'text-[#10b981]' : 'text-red-400'}>
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#71717a]">
            <span>Spread:</span>
            <span className="text-[#a1a1aa] font-mono">${spread.toFixed(2)} ({spreadPct.toFixed(3)}%)</span>
          </div>
        </div>

        {/* Bids (Green) */}
        {(spreadMode === 'ALL' || spreadMode === 'BIDS') && (
          <div className="flex flex-col gap-0.5">
            {bids.slice(0, 4).map((bid, idx) => (
              <div key={idx} className="grid grid-cols-3 relative py-0.5 hover:bg-emerald-500/10 rounded px-1 group">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 pointer-events-none rounded"
                  style={{ width: `${bid.depthPct}%` }}
                />
                <span className="text-emerald-400 font-medium z-10">{bid.price.toFixed(currentPrice > 1000 ? 1 : 4)}</span>
                <span className="text-right text-[#a1a1aa] z-10">{bid.size}</span>
                <span className="text-right text-[#71717a] z-10">{bid.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Anonymous Settlements / Trades Ticker */}
      <div className="mt-2 pt-2 border-t border-[#27272a]">
        <div className="flex items-center justify-between text-[10px] text-[#71717a] mb-1">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-[#10b981]" />
            <span>Recent Shielded Trades</span>
          </span>
          <span className="text-[#a855f7] flex items-center gap-0.5">
            <ShieldCheck className="w-2.5 h-2.5" /> STARK Verified
          </span>
        </div>
        <div className="flex flex-col gap-1 font-mono text-[10px]">
          {tradeFeed.slice(0, 3).map((tr) => (
            <div key={tr.id} className="flex items-center justify-between text-[#a1a1aa]">
              <span className={tr.side === 'BUY' ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                {tr.side === 'BUY' ? '↗' : '↘'} ${tr.price.toFixed(currentPrice > 1000 ? 1 : 3)}
              </span>
              <span className="text-[#71717a]">{tr.size} {marketId.split('-')[0]}</span>
              <span className="text-[9px] text-[#52525b]">{tr.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
