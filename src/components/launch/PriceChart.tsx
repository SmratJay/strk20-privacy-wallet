'use client';

import React, { useMemo, useState } from 'react';
import { PricePoint, TradeEvent } from '@/services/launchService';

interface Props { points: PricePoint[]; trades?: TradeEvent[]; height?: number; className?: string; }

function label(block: number) { return block ? `#${block.toLocaleString()}` : '—'; }

/** Responsive, interactive SVG using only event-derived V2 price points. */
export default function PriceChart({ points, trades = [], height = 210, className }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const pad = { left: 10, right: 10, top: 16, bottom: 28 };
  const data = useMemo(() => {
    if (!points || points.length < 2) return null;
    const values = points.map((p) => p.price);
    const min = Math.min(...values); const max = Math.max(...values); const span = max - min || Math.max(max * 0.05, 1e-12);
    const x = (i: number) => pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
    const y = (v: number) => pad.top + (1 - (v - min) / span) * (height - pad.top - pad.bottom);
    const coords = points.map((p, i) => ({ x: x(i), y: y(p.price), point: p }));
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
    return { coords, line, area: `${line} L${coords.at(-1)!.x},${height - pad.bottom} L${coords[0].x},${height - pad.bottom} Z`, stroke: values.at(-1)! >= values[0] ? '#ff9d2e' : '#fb7185', min, max, x, y };
  }, [points, height]);

  if (!data) return <div className={`launch-chart-empty ${className ?? ''}`} style={{ height }}>Live chart appears after the first two on-chain trades.</div>;
  const active = hover === null ? null : data.coords[hover];
  const tradeMarkers = trades.map((trade) => {
    const idx = points.findIndex((point) => point.block === trade.block);
    if (idx < 0) return null;
    return { trade, x: data.x(idx), y: data.y(Number(trade.priceBase) / Number(trade.priceToken)) };
  }).filter(Boolean) as { trade: TradeEvent; x: number; y: number }[];

  return <div className={`launch-chart-wrap ${className ?? ''}`} style={{ height }}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Live on-chain token price chart" onMouseLeave={() => setHover(null)}>
      <defs><linearGradient id="launch-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={data.stroke} stopOpacity=".28" /><stop offset="1" stopColor={data.stroke} stopOpacity="0" /></linearGradient></defs>
      {[0, .5, 1].map((step) => <line key={step} x1={pad.left} x2={width - pad.right} y1={pad.top + step * (height - pad.top - pad.bottom)} y2={pad.top + step * (height - pad.top - pad.bottom)} className="launch-chart-grid" />)}
      <path d={data.area} fill="url(#launch-chart-fill)" /><path d={data.line} fill="none" stroke={data.stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      {tradeMarkers.map(({ trade, x, y }) => <circle key={`${trade.txHash}-${trade.block}`} cx={x} cy={y} r="3.5" fill={trade.side === 'BUY' ? '#36d399' : '#fb7185'} stroke="#171016" strokeWidth="1.5" />)}
      {data.coords.map((coord, index) => <rect key={coord.point.block} x={coord.x - 7} y={pad.top} width="14" height={height - pad.top - pad.bottom} fill="transparent" onMouseEnter={() => setHover(index)} />)}
      {active && <><line x1={active.x} x2={active.x} y1={pad.top} y2={height - pad.bottom} className="launch-chart-crosshair" /><circle cx={active.x} cy={active.y} r="5" fill={data.stroke} stroke="white" strokeWidth="2" /></>}
      <text x={pad.left} y={height - 8} className="launch-chart-axis">{label(points[0].block)}</text><text x={width - pad.right} y={height - 8} textAnchor="end" className="launch-chart-axis">{label(points.at(-1)!.block)}</text>
    </svg>
    {active && <div className="launch-chart-tooltip" style={{ left: `${(active.x / width) * 100}%` }}><strong>{active.point.price < .001 ? active.point.price.toExponential(3) : active.point.price.toFixed(5)} STRK</strong><span>{label(active.point.block)}</span></div>}
    <div className="launch-chart-range"><span>Low {data.min < .001 ? data.min.toExponential(2) : data.min.toFixed(5)}</span><span>High {data.max < .001 ? data.max.toExponential(2) : data.max.toFixed(5)} STRK</span></div>
  </div>;
}
