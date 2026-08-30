'use client';

import React from 'react';
import { PricePoint } from '@/services/launchService';

interface Props {
  points: PricePoint[];
  height?: number;
  className?: string;
}

/**
 * Pure-SVG price sparkline for the launchpad token page. Every point is reconstructed from
 * real on-chain Buy/Sell event reserve state (base_after/token_after) — no mock data.
 * Renders the price trajectory oldest → newest.
 */
export default function PriceChart({ points, height = 160, className }: Props) {
  if (!points || points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-[12px] text-zinc-600 ${className ?? ''}`}
        style={{ height }}
      >
        Chart appears once the curve has on-chain trades.
      </div>
    );
  }

  const width = 600;
  const padX = 4;
  const padY = 12;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const stepX = (width - padX * 2) / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = padX + i * stepX;
    const y = padY + (height - padY * 2) * (1 - (p.price - min) / span);
    return { x, y };
  });

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height} L${coords[0].x.toFixed(1)},${height} Z`;
  const rising = prices[prices.length - 1] >= prices[0];
  const stroke = rising ? '#34d399' : '#fb7185';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className ?? 'w-full'}
      style={{ height }}
      role="img"
      aria-label="Token price chart"
    >
      <defs>
        <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#price-fill)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}