'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { liveMarketDataService, Candle } from '@/services/liveMarketDataService';
import { RefreshCw, TrendingUp, TrendingDown, Maximize2, BarChart2 } from 'lucide-react';

interface InteractivePerpChartProps {
  pair: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP';
  currentPrice: number;
}

export const InteractivePerpChart: React.FC<InteractivePerpChartProps> = ({ pair, currentPrice }) => {
  const [interval, setIntervalState] = useState<'1m' | '5m' | '15m' | '1h' | '1d'>('15m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  // Fetch real candles from live market data service
  useEffect(() => {
    let isMounted = true;
    const fetchCandles = async () => {
      try {
        const data = await liveMarketDataService.fetchCandles(pair, interval, 45);
        if (isMounted) {
          setCandles(data);
          setIsLoading(false);
        }
      } catch {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchCandles();
    const intervalTimer = setInterval(fetchCandles, 5000);
    return () => {
      isMounted = false;
      clearInterval(intervalTimer);
    };
  }, [pair, interval]);

  // Compute price bounds for SVG scaling
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (candles.length === 0) return { minPrice: 0, maxPrice: 1, priceRange: 1 };
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padding = (max - min) * 0.08 || 1;
    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: max + padding - (min - padding) || 1,
    };
  }, [candles]);

  const activeCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);

  return (
    <div className="bg-zinc-950 border border-zinc-800 p-4 corner-box space-y-3 font-mono">
      {/* Chart Top Header & Timeframe Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white uppercase">
            <BarChart2 className="w-4 h-4 text-orrange-400" />
            <span>{pair} REAL-TIME CANDLES</span>
          </div>

          {activeCandle && (
            <div className="hidden sm:flex items-center gap-3 text-[11px]">
              <span className="text-zinc-500">O: <b className="text-white">${activeCandle.open.toFixed(2)}</b></span>
              <span className="text-zinc-500">H: <b className="text-emerald-400">${activeCandle.high.toFixed(2)}</b></span>
              <span className="text-zinc-500">L: <b className="text-rose-400">${activeCandle.low.toFixed(2)}</b></span>
              <span className="text-zinc-500">C: <b className="text-white">${activeCandle.close.toFixed(2)}</b></span>
            </div>
          )}
        </div>

        {/* Timeframe Selectors */}
        <div className="flex items-center gap-1">
          {(['1m', '5m', '15m', '1h', '1d'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setIntervalState(tf)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors cursor-pointer ${
                interval === tf
                  ? 'border border-orrange-500 bg-orrange-500 text-black font-black'
                  : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Candlestick Viewport */}
      <div className="relative h-64 w-full bg-zinc-900/30 border border-zinc-800/80 p-2 overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 z-10 text-xs text-zinc-400 gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-orrange-400" />
            Streaming live candlesticks...
          </div>
        )}

        <svg
          className="w-full h-full"
          viewBox="0 0 800 240"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredCandle(null)}
        >
          {/* Horizontal Grid lines */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
            const y = ratio * 240;
            const priceLevel = maxPrice - ratio * priceRange;
            return (
              <g key={idx}>
                <line x1="0" y1={y} x2="800" y2={y} stroke="#27272a" strokeDasharray="3 3" strokeWidth="1" />
                <text x="795" y={y - 4} fill="#71717a" fontSize="9" textAnchor="end">
                  ${priceLevel.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Candlestick bars */}
          {candles.map((candle, idx) => {
            const total = candles.length;
            const candleWidth = Math.max(800 / total - 4, 4);
            const x = (idx / total) * 800 + 2;

            const isBullish = candle.close >= candle.open;
            const bodyTopPrice = Math.max(candle.open, candle.close);
            const bodyBottomPrice = Math.min(candle.open, candle.close);

            const yHigh = ((maxPrice - candle.high) / priceRange) * 240;
            const yLow = ((maxPrice - candle.low) / priceRange) * 240;
            const yBodyTop = ((maxPrice - bodyTopPrice) / priceRange) * 240;
            const yBodyBottom = ((maxPrice - bodyBottomPrice) / priceRange) * 240;
            const bodyHeight = Math.max(yBodyBottom - yBodyTop, 2);

            const color = isBullish ? '#10b981' : '#f43f5e';

            return (
              <g
                key={candle.time || idx}
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredCandle(candle)}
              >
                {/* High/Low Wick */}
                <line
                  x1={x + candleWidth / 2}
                  y1={yHigh}
                  x2={x + candleWidth / 2}
                  y2={yLow}
                  stroke={color}
                  strokeWidth="1.5"
                />
                {/* Candle Body */}
                <rect
                  x={x}
                  y={yBodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isBullish ? '#10b981' : '#f43f5e'}
                  stroke={color}
                  strokeWidth="1"
                  rx="1"
                />
              </g>
            );
          })}
        </svg>

        {/* Current Live Mark Price Horizontal Bar */}
        <div className="absolute right-2 bottom-2 px-2 py-1 bg-zinc-950/90 border border-orrange-500 text-[10px] text-orrange-400 font-bold">
          LIVE MARK: ${currentPrice.toFixed(2)}
        </div>
      </div>
    </div>
  );
};
