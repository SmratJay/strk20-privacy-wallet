'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, CircleDot, ShieldCheck } from 'lucide-react';
import { LaunchMetadataRecord } from '@/services/launchMetadata';
import { TokenSnapshot, TradeEvent } from '@/services/launchService';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';

function compact(v: number, suffix = 'STRK'): string {
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ${suffix}`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K ${suffix}`;
  if (v < 0.001) return `${v.toExponential(2)} ${suffix}`;
  return `${v.toFixed(3)} ${suffix}`;
}

function price(v: number): string {
  if (!v) return '—';
  return v < 0.001 ? v.toExponential(3) : v.toFixed(5);
}

interface Props {
  snapshot: TokenSnapshot;
  metadata?: LaunchMetadataRecord | null;
  recentTrade?: TradeEvent | null;
}

/** Dense V2 discovery card. All market figures are STRK-denominated on Sepolia. */
export default function TokenCard({ snapshot, metadata, recentTrade }: Props) {
  const { entry, metrics, live, migrated } = snapshot;
  const pct = metrics?.graduationPct ?? 0;
  const graduated = metrics?.graduated ?? false;
  const image = metadata?.image || '';
  const banner = metadata?.banner || image;

  return (
    <Link
      href={`/launch/${entry.token}`}
      className="launch-token-card group overflow-hidden"
      aria-label={`Open ${metadata?.name || entry.name} token page`}
    >
      <div className="launch-token-card-media" style={banner ? { backgroundImage: `url(${banner})` } : undefined}>
        <div className="launch-token-card-media-shade" />
        <div className="launch-token-card-topline">
          <span className="launch-live-pill"><CircleDot className="h-3 w-3" /> {recentTrade ? 'Trading now' : live ? 'On-chain' : 'Offline'}</span>
          <ArrowUpRight className="h-4 w-4 text-white/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <div className="launch-token-card-identity">
          {image ? <img src={image} alt="" className="launch-token-card-avatar" loading="lazy" /> : <div className="launch-token-card-avatar launch-token-card-avatar-fallback">{entry.emoji}</div>}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <strong>{entry.symbol}</strong>
              {graduated && <span className="launch-badge launch-badge-success">CURVE GRADUATED</span>}
              {graduated && migrated === true && <span className="launch-badge launch-badge-info">LIQUIDITY MIGRATED</span>}
            </div>
            <span>{metadata?.name || entry.name}</span>
          </div>
        </div>
      </div>

      <div className="launch-token-card-body">
        <div className="launch-token-card-price-row">
          <div><small>Price</small><b>{metrics ? `${price(metrics.price)} STRK` : '—'}</b></div>
          <div className="text-right"><small>Creator</small><b className="font-mono">{entry.creator ? shortenAddress(entry.creator, 4) : '—'}</b></div>
        </div>
        {live && metrics ? (
          <div className="launch-token-card-stats">
            <div><small>MC</small><b>{compact(metrics.marketCap)}</b></div>
            <div><small>Liquidity</small><b>{compact(metrics.liquidity)}</b></div>
            <div><small>Volume</small><b>{compact(metrics.volume)}</b></div>
          </div>
        ) : <p className="launch-token-card-empty">Live curve data is temporarily unavailable.</p>}

        <div className="launch-token-card-progress">
          <div><small>{graduated ? (migrated === true ? 'Migration confirmed' : 'Awaiting migration') : 'Progress to graduation'}</small><b>{live ? `${pct.toFixed(1)}%` : '—'}</b></div>
          <div className="launch-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
        </div>

        <div className="launch-token-card-foot">
          <span>{recentTrade ? `${recentTrade.side} · ${formatTokenAmount(recentTrade.output, recentTrade.side === 'BUY' ? (snapshot.metadata?.decimals ?? 18) : 18, 3)} ${recentTrade.side === 'BUY' ? entry.symbol : 'STRK'}` : 'No trades indexed yet'}</span>
          {recentTrade?.private && <span className="launch-private-mark"><ShieldCheck className="h-3 w-3" /> private lane</span>}
        </div>
      </div>
    </Link>
  );
}
