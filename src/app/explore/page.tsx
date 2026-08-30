'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ChevronDown, Flame, Loader2, Rocket, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import TokenCard from '@/components/launch/TokenCard';
import { LaunchTokenEntry } from '@/config/launch';
import {
  filterSnapshots,
  listTokens,
  loadTokenSnapshot,
  readRecentTrades,
  sortSnapshots,
  TokenSnapshot,
  TradeEvent,
  ExploreSortMode,
} from '@/services/launchService';
import { fetchAllMetadata, LaunchMetadataRecord } from '@/services/launchMetadata';

const LAUNCH_NETWORK = 'sepolia' as const;
type FeedFilter = 'all' | 'new' | 'trending' | 'recent' | 'near' | 'graduated';

const filters: { key: FeedFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All tokens', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: 'new', label: 'New', icon: <Rocket className="h-3.5 w-3.5" /> },
  { key: 'trending', label: 'Trending', icon: <Flame className="h-3.5 w-3.5" /> },
  { key: 'recent', label: 'Recently traded', icon: <Activity className="h-3.5 w-3.5" /> },
  { key: 'near', label: 'Near graduation', icon: <ChevronDown className="h-3.5 w-3.5" /> },
  { key: 'graduated', label: 'Graduated', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
];

export default function ExplorePage() {
  const [tokens, setTokens] = useState<LaunchTokenEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TokenSnapshot[]>([]);
  const [metadataMap, setMetadataMap] = useState<Record<string, LaunchMetadataRecord>>({});
  const [activityMap, setActivityMap] = useState<Record<string, TradeEvent | null>>({});
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const list = await listTokens(LAUNCH_NETWORK);
      const snaps = await Promise.all(list.map((entry) => loadTokenSnapshot(LAUNCH_NETWORK, entry)));
      const activity = await Promise.all(list.map(async (entry) => {
        const trades = await readRecentTrades(LAUNCH_NETWORK, entry.curve, entry.executor, 1);
        return [entry.token.toLowerCase(), trades[0] ?? null] as const;
      }));
      setTokens(list);
      setSnapshots(snaps);
      setActivityMap(Object.fromEntries(activity));
      setMetadataMap(await fetchAllMetadata());
    } catch (e: any) {
      setError(e?.message || 'Could not load the ORRANGE Launch market.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    let result = filterSnapshots(snapshots, query);
    if (filter === 'graduated') result = result.filter((s) => s.metrics?.graduated === true);
    if (filter === 'near') result = result.filter((s) => !s.metrics?.graduated && (s.metrics?.graduationPct ?? 0) > 0);
    if (filter === 'recent') result = result.filter((s) => Boolean(activityMap[s.entry.token.toLowerCase()]));

    const mode: ExploreSortMode = filter === 'new' ? 'newest' : filter === 'trending' ? 'trending' : filter === 'near' ? 'graduation' : 'newest';
    result = sortSnapshots(result, mode);
    if (filter === 'recent') result.sort((a, b) => (activityMap[b.entry.token.toLowerCase()]?.block ?? 0) - (activityMap[a.entry.token.toLowerCase()]?.block ?? 0));
    return result;
  }, [snapshots, query, filter, activityMap]);

  return (
    <AppShell>
      <div className="product-page launchpad-shell">
        <div className="launchpad-feed-header">
          <div>
            <div className="product-eyebrow">ORRANGE / LAUNCHPAD · SEPOLIA</div>
            <h1 className="product-page-title"><Flame className="h-5 w-5 text-orange-300" /> Explore the live launchpad</h1>
            <p className="product-page-description">Fresh Starknet tokens, real curve state, real trades. Find something early.</p>
          </div>
          <Link href="/launch" className="launch-primary-button"><Rocket className="h-4 w-4" /> Launch a token</Link>
        </div>

        <div className="launchpad-toolbar">
          <label className="launch-search"><Search className="h-4 w-4" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or ticker" /></label>
          <div className="launch-filter-row" role="tablist" aria-label="Launchpad filters">
            {filters.map((item) => <button key={item.key} role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)} className={`launch-filter ${filter === item.key ? 'is-active' : ''}`}>{item.icon}{item.label}</button>)}
          </div>
        </div>

        <div className="launchpad-feed-meta"><span><span className="launch-pulse-dot" /> Live Sepolia feed</span><span>{tokens.length} token{tokens.length === 1 ? '' : 's'} indexed</span><span>Market data is read from V2 contracts and curve events</span></div>

        {loading ? <div className="launch-empty"><Loader2 className="h-5 w-5 animate-spin" /> Loading live tokens…</div> : error ? <div className="launch-alert launch-alert-error">{error}</div> : tokens.length === 0 ? (
          <div className="launch-empty launch-empty-card"><Sparkles className="h-6 w-6" /><p>No tokens are indexed on the Sepolia V2 factory yet.</p><Link href="/launch" className="launch-primary-button">Create the first token</Link></div>
        ) : visible.length === 0 ? <div className="launch-empty launch-empty-card"><Search className="h-6 w-6" /><p>No tokens match this view.</p></div> : <div className="launch-token-grid">{visible.map((snapshot) => <TokenCard key={snapshot.entry.token || snapshot.entry.id} snapshot={snapshot} metadata={metadataMap[snapshot.entry.token.toLowerCase()] ?? null} recentTrade={activityMap[snapshot.entry.token.toLowerCase()]} />)}</div>}

        <div className="launchpad-truth"><ShieldCheck className="h-4 w-4" /><span>Every price, liquidity, cumulative volume and graduation percentage here is derived from the V2 curve. USD estimates are intentionally omitted on Sepolia.</span></div>
      </div>
    </AppShell>
  );
}
