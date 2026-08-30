'use client';

import React from 'react';
import Link from 'next/link';
import { TrendingUp, Shield } from 'lucide-react';
import { LaunchTokenEntry } from '@/config/launch';
import { LaunchMetadataRecord } from '@/services/launchMetadata';
import { TokenSnapshot } from '@/services/launchService';

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v === 0) return '—';
  return `$${v.toFixed(2)}`;
}

function formatPriceUsd(v: number): string {
  if (v === 0) return '—';
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v >= 0.0001) return `$${v.toFixed(6)}`;
  return `$${v.toExponential(2)}`;
}

interface Props {
  snapshot: TokenSnapshot;
  metadata?: LaunchMetadataRecord | null;
}

/** V2 pump.fun-style token card. Links straight to /launch/<token-address> so the token
 * page always reads the real on-chain token/curve addresses. */
export default function TokenCard({ snapshot, metadata }: Props) {
  const { entry, metrics, live, migrated } = snapshot;
  const pct = metrics?.graduationPct ?? 0;
  const graduated = metrics?.graduated ?? false;
  const image = metadata?.image || '';
  const social = (metadata?.socials?.x || metadata?.socials?.website || '') as string;
  return (
    <Link
      href={`/launch/${entry.token}`}
      className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 hover:border-violet-500/40 hover:bg-zinc-900/60 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {image ? (
            <img
              src={image}
              alt={`${entry.symbol} artwork`}
              className="w-11 h-11 rounded-2xl object-cover border border-zinc-800"
              loading="lazy"
            />
          ) : (
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 border border-violet-500/30 flex items-center justify-center text-2xl shrink-0">
              {entry.emoji}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-zinc-100">{entry.symbol}</span>
              {graduated && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  GRADUATED
                </span>
              )}
              {graduated && migrated === true && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  MIGRATED
                </span>
              )}
            </div>
            <div className="text-[12px] text-zinc-500 truncate">
              {metadata?.description || entry.name}
            </div>
            {social && <div className="text-[10px] text-violet-400/70 truncate">{social}</div>}
          </div>
        </div>
        <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
      </div>

      {live && metrics ? (
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">MC</div>
            <div className="text-[13px] font-semibold text-zinc-100">{formatUsd(metrics.marketCap)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Liquidity</div>
            <div className="text-[13px] font-semibold text-zinc-100">{formatUsd(metrics.liquidity)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Volume</div>
            <div className="text-[13px] font-semibold text-zinc-100">{formatUsd(metrics.volume)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Price</div>
            <div className="text-[13px] font-semibold text-violet-300">{formatPriceUsd(metrics.priceUsd)}</div>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-[12px] text-zinc-600">
          Live curve data appears once the contracts are deployed and configured.
        </div>
      )}

      {/* Graduation bar */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Graduation</span>
          <span className="flex items-center gap-1">
            {live ? `${pct.toFixed(0)}%` : '—'}
            {metrics?.graduated && metrics?.volume > 0 && (
              <Shield className="w-3 h-3 text-violet-400/70" />
            )}
          </span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              graduated
                ? migrated === true
                  ? 'bg-sky-400'
                  : 'bg-emerald-400'
                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
            }`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
    </Link>
  );
}