'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, TrendingUp, Shield, Globe, Flame } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { useWallet } from '@/context/WalletContext';
import { LaunchTokenEntry } from '@/config/launch';
import { listTokens, loadTokenSnapshot, TokenSnapshot, baseUsdFor } from '@/services/launchService';

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

function TokenCard({ snapshot }: { snapshot: TokenSnapshot }) {
  const { entry, metrics, live } = snapshot;
  const pct = metrics?.graduationPct ?? 0;
  const graduated = metrics?.graduated ?? false;
  return (
    <Link
      href={`/launch/${entry.id}`}
      className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 hover:border-violet-500/40 hover:bg-zinc-900/60 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 border border-violet-500/30 flex items-center justify-center text-2xl">
            {entry.emoji}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-zinc-100">{entry.symbol}</span>
              {graduated && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  GRADUATED
                </span>
              )}
              {!live && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  PENDING DEPLOY
                </span>
              )}
            </div>
            <div className="text-[12px] text-zinc-500">{entry.name}</div>
          </div>
        </div>
        <TrendingUp className="w-4 h-4 text-emerald-400" />
      </div>

      {live && metrics ? (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">MC</div>
            <div className="text-[13px] font-semibold text-zinc-100">{formatUsd(metrics.marketCap)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Liquidity</div>
            <div className="text-[13px] font-semibold text-zinc-100">{formatUsd(metrics.liquidity)}</div>
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
          <span>{live ? `${pct.toFixed(0)}%` : '—'}</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${graduated ? 'bg-emerald-400' : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

export default function LaunchPage() {
  const { networkId, isSepolia } = useWallet();
  const [tokens, setTokens] = useState<LaunchTokenEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TokenSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUsd = useMemo(() => baseUsdFor(networkId), [networkId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listTokens(networkId);
        if (cancelled) return;
        setTokens(list);
        const snaps = await Promise.all(list.map((e) => loadTokenSnapshot(networkId, e)));
        if (cancelled) return;
        setSnapshots(snaps);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load the Umbra Launch market.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkId]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="pt-2">
          <h1 className="text-2xl font-semibold text-zinc-100 flex items-center gap-2">
            <Flame className="w-5 h-5 text-violet-400" /> Umbra Launch
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Memecoins with a private execution layer.{' '}
            <span className="text-violet-300">The market is public. Your trade doesn&apos;t have to be.</span>
          </p>
          {isSepolia && (
            <p className="text-[12px] text-amber-300 mt-1">
              On Sepolia the STRK20 private lane uses the Sepolia pool; mainnet is the primary target.
            </p>
          )}
        </div>

        {/* Privacy statement banner */}
        <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
            <div className="text-[13px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-zinc-100">Public market · Private execution.</span>{' '}
              Price, liquidity, curve state and market impact stay on-chain and visible to everyone.
              Your <span className="text-violet-300">wallet → trade link</span> is executed through the
              STRK20 privacy pool: shielded input, private executor, shielded output note.
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-500">
            <div><Globe className="inline w-3 h-3 mr-1 text-zinc-400" /> Market state: PUBLIC</div>
            <div><Globe className="inline w-3 h-3 mr-1 text-zinc-400" /> Price: PUBLIC</div>
            <div><Globe className="inline w-3 h-3 mr-1 text-zinc-400" /> Liquidity: PUBLIC</div>
            <div><Shield className="inline w-3 h-3 mr-1 text-violet-400" /> Wallet→trade: PRIVATE</div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <span>Base asset:</span>
          <span className="text-zinc-300 font-mono">STRK</span>
          <span className="text-zinc-600">·</span>
          <span>STRK ≈ ${baseUsd.toFixed(3)}</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading the market…
          </div>
        ) : error ? (
          <div className="text-[13px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-xl p-3">
            {error}
          </div>
        ) : (
          <>
            {tokens.length === 0 && (
              <div className="text-[13px] text-zinc-500 border border-zinc-800 rounded-xl p-4">
                No memecoins launched yet. Deploy the Umbra TokenFactory to open the market.
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {snapshots.map((s) => (
                <TokenCard key={s.entry.id} snapshot={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}