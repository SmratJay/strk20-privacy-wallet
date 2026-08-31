'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Globe, RefreshCw, Wallet } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { privacyService } from '@/services/privacyService';
import { formatTokenAmount } from '@/utils/formatters';

interface PubRow {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  available: boolean;
}

/**
 * Live PUBLIC on-chain balance (transparent ERC-20 funds — the opposite of the shielded
 * private balance). Works for both lanes:
 *  - Ready wallet: reads WalletContext.balances, which the provider polls every 12s.
 *  - Privy embedded wallet: fetches real ERC-20 balances directly from the RPC.
 */
export const PublicBalanceCard: React.FC = () => {
  const { balances, currentNetwork, refreshPublicBalances, isLoadingBalances } = useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.address !== null;

  const [privyPub, setPrivyPub] = useState<Map<string, PubRow>>(new Map());
  const [privyLoading, setPrivyLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!privyConnected || !privy.address) {
      setPrivyPub(new Map());
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const pub = await privacyService.fetchBalances(privy.address!, undefined, currentNetwork);
        const map = new Map<string, PubRow>();
        for (const t of currentNetwork.tokens) {
          const key = t.address.toLowerCase();
          map.set(key, {
            address: t.address,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            balance: 0n,
            available: false,
          });
        }
        for (const b of pub) {
          const row = map.get(b.token.address.toLowerCase());
          if (row) {
            row.balance = b.publicBalance;
            row.available = b.publicBalanceAvailable;
          }
        }
        if (!cancelled) {
          setPrivyPub(map);
          setLastSynced(Date.now());
        }
      } catch {
        // RPC unavailable — keep rows with available=false so the UI shows "—", never a fake 0.
      } finally {
        if (!cancelled) setPrivyLoading(false);
      }
    };
    loadRef.current = load;
    setPrivyLoading(true);
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [privyConnected, privy.address, currentNetwork]);

  const handleRefresh = () => {
    if (privyConnected) {
      setPrivyLoading(true);
      void loadRef.current();
    } else {
      void refreshPublicBalances();
    }
  };

  const rows: PubRow[] = privyConnected
    ? currentNetwork.tokens.map(
        (t) =>
          privyPub.get(t.address.toLowerCase()) ?? {
            address: t.address,
            symbol: t.symbol,
            name: t.name,
            decimals: t.decimals,
            balance: 0n,
            available: false,
          }
      )
    : balances.map((b) => ({
        address: b.token.address,
        symbol: b.token.symbol,
        name: b.token.name,
        decimals: b.token.decimals,
        balance: b.publicBalance,
        available: b.publicBalanceAvailable,
      }));

  const total = rows.reduce((acc, r) => acc + (r.available ? r.balance : 0n), 0n);
  const anyAvailable = rows.some((r) => r.available);
  const syncing = privyConnected ? privyLoading : isLoadingBalances;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900/50 overflow-hidden">
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">
            Public balance
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={syncing}
              title="Refresh public balances"
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
              <Globe className="w-3.5 h-3.5" />
              Public
            </span>
          </div>
        </div>

        {syncing && !anyAvailable ? (
          <div className="h-9 w-40 rounded-lg bg-zinc-800/60 animate-pulse" />
        ) : (
          <div className="text-3xl font-semibold text-zinc-100 tabular-nums">
            {anyAvailable ? formatTokenAmount(total, 18, 4) : '—'}
            <span className="ml-2 text-sm font-normal text-zinc-500">tokens</span>
          </div>
        )}

        <p className="text-[12px] text-zinc-500">
          Transparent on-chain funds in this wallet — public to everyone on the blockchain.
        </p>

        {lastSynced && (
          <p className="text-[10px] text-zinc-600">
            Synced {new Date(lastSynced).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800/70 divide-y divide-zinc-800/60">
        {rows.map((r) => (
          <div key={r.address} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-800/80 flex items-center justify-center text-xs font-semibold tracking-tight">
                {r.symbol.slice(0, 1)}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-100">{r.symbol}</div>
                <div className="text-[11px] text-zinc-500">Public</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-zinc-100 tabular-nums">
                {r.available ? `${formatTokenAmount(r.balance, r.decimals, 4)} ${r.symbol}` : '—'}
              </div>
              <div className="text-[11px] text-zinc-600 tabular-nums">
                <Wallet className="w-3 h-3 inline -mt-0.5 mr-1" />
                {r.available ? '[ PUBLIC · ON-CHAIN ]' : '[ RPC UNAVAILABLE ]'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
