'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Flame, Shield, Globe, Search, Rocket } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import TokenCard from '@/components/launch/TokenCard';
import { useWallet } from '@/context/WalletContext';
import { LaunchTokenEntry } from '@/config/launch';
import {
  listTokens,
  loadTokenSnapshot,
  TokenSnapshot,
  baseUsdFor,
  sortSnapshots,
  filterSnapshots,
  ExploreSortMode,
} from '@/services/launchService';
import { fetchAllMetadata, LaunchMetadataRecord } from '@/services/launchMetadata';

export default function ExplorePage() {
  const { networkId, isSepolia } = useWallet();
  const [tokens, setTokens] = useState<LaunchTokenEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TokenSnapshot[]>([]);
  const [metadataMap, setMetadataMap] = useState<Record<string, LaunchMetadataRecord>>({});
  const [sort, setSort] = useState<ExploreSortMode>('newest');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUsd = useMemo(() => baseUsdFor(networkId), [networkId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTokens(networkId);
      setTokens(list);
      const snaps = await Promise.all(list.map((e) => loadTokenSnapshot(networkId, e)));
      setSnapshots(snaps);
      setMetadataMap(await fetchAllMetadata());
    } catch (e: any) {
      setError(e?.message || 'Could not load the ORRANGE Launch market.');
    } finally {
      setLoading(false);
    }
  }, [networkId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const filtered = filterSnapshots(snapshots, query);
    return sortSnapshots(filtered, sort);
  }, [snapshots, query, sort]);

  const sortedCards = visible.map((s) => (
    <TokenCard key={s.entry.token || s.entry.id} snapshot={s} metadata={metadataMap[s.entry.token?.toLowerCase()] ?? null} />
  ));

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / EXPLORE</div>
            <h1 className="product-page-title flex items-center gap-2">
              <Flame className="w-5 h-5 text-violet-400" /> Explore
            </h1>
            <p className="product-page-description">
              Every coin launched on ORRANGE, straight from the on-chain factory V2.{' '}
              <span className="text-violet-300">No listings. Real contracts.</span>
            </p>
            {isSepolia && (
              <p className="text-[12px] text-amber-300 mt-1">
                Reading the Sepolia TokenFactory. Market data is live on-chain state.
              </p>
            )}
          </div>
          <Link
            href="/launch"
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-[13px] font-bold px-4 py-2.5 transition-colors"
          >
            <Rocket className="w-4 h-4" /> Create a coin
          </Link>
        </div>

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or ticker…"
              className="w-full bg-zinc-950/60 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-zinc-200 outline-none focus:border-violet-500/50 placeholder:text-zinc-600"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                ['newest', 'Newest'],
                ['trending', 'Trending'],
                ['graduation', 'Graduation'],
              ] as [ExploreSortMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${
                  sort === mode
                    ? 'bg-violet-500 text-white border-violet-500'
                    : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <span>Base asset:</span>
          <span className="text-zinc-300 font-mono">STRK</span>
          <span className="text-zinc-600">·</span>
          <span>STRK ≈ ${baseUsd.toFixed(3)}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">Trending = real reserves on-chain · volume = cumulative trades</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading the market…
          </div>
        ) : error ? (
          <div className="text-[13px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-xl p-3">
            {error}
          </div>
        ) : tokens.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
            <Globe className="w-6 h-6 text-zinc-600 mx-auto" />
            <p className="text-[13px] text-zinc-500 mt-3">
              No memecoins launched yet. Deploy the ORRANGE TokenFactory V2 to open the market —
              then every launch appears here instantly.
            </p>
            <Link
              href="/launch"
              className="inline-flex items-center gap-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-[13px] font-bold px-4 py-2.5 mt-4 transition-colors"
            >
              <Rocket className="w-4 h-4" /> Be the first to launch
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-[13px] text-zinc-500 border border-zinc-800 rounded-xl p-4">
            No tokens match “{query}”.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{sortedCards}</div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-zinc-600 pt-2">
          <Shield className="w-3.5 h-3.5 text-violet-400" />
          Public market data. Every price, cap, liquidity, volume and graduation % is read live
          from the bonded curve — nothing is mocked.
        </div>
      </div>
    </AppShell>
  );
}