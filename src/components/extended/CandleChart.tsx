'use client';

import React, { useMemo, useState } from 'react';
import type { Candle } from '@/extended/types';

interface CandleChartProps {
  candles: Candle[];
  height?: number;
}

/**
 * Lightweight SVG candlestick + volume chart (no external dependencies).
 * Renders oldest→newest left→right and includes a time axis and a live
 * last-price line. Candles must already be in ascending time order.
 */
export function CandleChart({ candles, height = 380 }: CandleChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 880;
  const volumeHeight = 56;
  const axisHeight = 22;
  const priceArea = height - volumeHeight - axisHeight - 12;

  const bounds = useMemo(() => {
    if (!candles.length) return null;
    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;
    for (const c of candles) {
      const lo = Math.min(Number(c.l), Number(c.o), Number(c.c));
      const hi = Math.max(Number(c.h), Number(c.o), Number(c.c));
      if (lo < min) min = lo;
      if (hi > max) max = hi;
      if (Number(c.v) > maxVol) maxVol = Number(c.v);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const pad = (max - min) * 0.05 || max * 0.001 || 1;
    return { min: min - pad, max: max + pad, maxVol: maxVol || 1 };
  }, [candles]);

  if (!bounds || candles.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-zinc-600 text-sm font-mono">
        No candle data yet.
      </div>
    );
  }

  const n = candles.length;
  const step = width / n;
  const bodyW = Math.max(2, step * 0.6);
  const priceToY = (v: number) => priceArea - ((v - bounds.min) / (bounds.max - bounds.min)) * priceArea + 4;
  const volToH = (v: number) => (v / bounds.maxVol) * volumeHeight;

  const last = candles[candles.length - 1];
  const lastPrice = Number(last.c);
  const lastY = priceToY(lastPrice);
  const hovered = hoverIdx !== null ? candles[hoverIdx] : null;

  // Time-axis labels (5 evenly spaced).
  const axisLabels = Array.from({ length: 5 }, (_, i) => {
    const idx = Math.round((i / 4) * (n - 1));
    return { x: (idx / n) * width + step / 2, label: new Date(candles[idx].T).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) };
  });

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none" onMouseLeave={() => setHoverIdx(null)}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = 4 + priceArea * f;
          return (
            <g key={f}>
              <line x1={0} x2={width} y1={y} y2={y} stroke="#27272a" strokeWidth={0.6} />
              <text x={width - 4} y={y - 3} textAnchor="end" fill="#71717a" fontSize={9} fontFamily="monospace">
                {(bounds.max - (bounds.max - bounds.min) * f).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </text>
            </g>
          );
        })}

        {/* Candles */}
        {candles.map((c, i) => {
          const x = i * step + step / 2;
          const open = Number(c.o);
          const close = Number(c.c);
          const hi = Number(c.h);
          const lo = Number(c.l);
          const up = close >= open;
          const color = up ? '#10b981' : '#f43f5e';
          const bodyTop = priceToY(Math.max(open, close));
          const bodyBottom = priceToY(Math.min(open, close));
          const bodyH = Math.max(1, bodyBottom - bodyTop);
          return (
            <g key={i} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}>
              <line x1={x} x2={x} y1={priceToY(hi)} y2={priceToY(lo)} stroke={color} strokeWidth={1} />
              <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
              {/* Volume */}
              <rect
                x={x - bodyW / 2}
                y={priceArea + 10 + (volumeHeight - volToH(Number(c.v)))}
                width={bodyW}
                height={volToH(Number(c.v))}
                fill={color}
                opacity={0.28}
              />
              <rect
                x={x - step / 2}
                y={0}
                width={step}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          );
        })}

        {/* Last price line */}
        <line x1={0} x2={width} y1={lastY} y2={lastY} stroke="#f59e0b" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.7} />
        <rect x={width - 74} y={lastY - 9} width={74} height={15} fill="#b45309" />
        <text x={width - 6} y={lastY + 2} textAnchor="end" fill="#fff" fontSize={9} fontFamily="monospace">
          {lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </text>

        {/* Time axis */}
        {axisLabels.map((a, i) => (
          <text key={i} x={Math.min(Math.max(a.x, 30), width - 30)} y={height - 8} textAnchor="middle" fill="#52525b" fontSize={8.5} fontFamily="monospace">
            {a.label}
          </text>
        ))}
      </svg>

      {hovered && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-400 border-t border-zinc-800/60 pt-2">
          <span>{new Date(hovered.T).toLocaleString()}</span>
          <span className="text-emerald-400">O {Number(hovered.o).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span className="text-rose-400">C {Number(hovered.c).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>H {Number(hovered.h).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>L {Number(hovered.l).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>V {Number(hovered.v).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        </div>
      )}
    </div>
  );
}