'use client';

import React, { useEffect, useState } from 'react';
import { EyeOff, Wallet, RefreshCw } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { privacyService } from '@/services/privacyService';
import { formatTokenAmount } from '@/utils/formatters';

interface Row {
  address: string;
  icon: string;
  symbol: string;
  decimals: number;
  publicBalance: bigint;
  publicBalanceAvailable: boolean;
  shieldedBalance: bigint;
  shieldedBalanceAvailable: boolean;
}

/**
 * Per-token private + public balance split. For the Ready lane it reads the WalletContext
 * balances; for a connected Privy embedded wallet it fetches the real STRK20 private balance
 * (discovery) plus the public ERC-20 balance. No fiat totals are invented.
 */
export const BalanceCard: React.FC = () => {
  const { balances, currentNetwork, privateBalancePermission, privateBalanceStatus, privateBalanceUpdatedAt } =
    useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null && privy.viewingKey !== null;

  const [privyBalances, setPrivyBalances] = useState<Map<string, Row>>(new Map());
  const [privyLoading, setPrivyLoading] = useState(false);

  useEffect(() => {
    if (!privyConnected || !privy.address) {
      setPrivyBalances(new Map());
      return;
    }
    let cancelled = false;
    const load = async () => {
      const map = new Map<string, Row>();
      for (const t of currentNetwork.tokens) {
        const key = t.address.toLowerCase();
        map.set(key, {
          address: t.address,
          icon: t.icon,
          symbol: t.symbol,
          decimals: t.decimals,
          publicBalance: 0n,
          publicBalanceAvailable: false,
          shieldedBalance: 0n,
          shieldedBalanceAvailable: false,
        });
      }
      try {
        const pub = await privacyService.fetchBalances(privy.address!, undefined, currentNetwork);
        for (const b of pub) {
          const key = b.token.address.toLowerCase();
          const row = map.get(key);
          if (row) {
            row.publicBalance = b.publicBalance;
            row.publicBalanceAvailable = b.publicBalanceAvailable;
          }
        }
      } catch {
        // Public balances unavailable — keep rows with availability false.
      }
      for (const t of currentNetwork.tokens) {
        try {
          const priv = await privy.getPrivateBalance(t.address);
          const row = map.get(t.address.toLowerCase());
          if (row) {
            row.shieldedBalance = priv;
            row.shieldedBalanceAvailable = true;
          }
        } catch {
          // Discovery unavailable — keep the row's private balance as unknown.
        }
      }
      if (!cancelled) setPrivyBalances(map);
      if (!cancelled) setPrivyLoading(false);
    };
    setPrivyLoading(true);
    void load();
    // Keep the private balance fresh (matches the Ready lane's polling).
    const timer = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [privyConnected, privy.address, privy, currentNetwork]);

  const rows: Row[] = privyConnected
    ? currentNetwork.tokens.map((t) => privyBalances.get(t.address.toLowerCase()) ?? {
        address: t.address,
        icon: t.icon,
        symbol: t.symbol,
        decimals: t.decimals,
        publicBalance: 0n,
        publicBalanceAvailable: false,
        shieldedBalance: 0n,
        shieldedBalanceAvailable: false,
      })
    : balances.map((b) => ({
        address: b.token.address,
        icon: b.token.icon,
        symbol: b.token.symbol,
        decimals: b.token.decimals,
        publicBalance: b.publicBalance,
        publicBalanceAvailable: b.publicBalanceAvailable,
        shieldedBalance: b.shieldedBalance,
        shieldedBalanceAvailable: b.shieldedBalanceAvailable === true,
      }));

  const totalPrivate = rows.reduce((acc, r) => acc + (r.shieldedBalanceAvailable ? r.shieldedBalance : 0n), 0n);
  const anyPrivateKnown = rows.some((r) => r.shieldedBalanceAvailable);

  const syncing = privyConnected ? privyLoading : privateBalanceStatus === 'LOADING';
  const unavailable = privyConnected ? false : privateBalanceStatus !== 'AVAILABLE' && !anyPrivateKnown;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900/50 overflow-hidden">
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-zinc-500 uppercase tracking-wider">
            Private balance
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-300">
            {syncing ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Syncing
              </span>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Private
              </>
            )}
          </span>
        </div>

        {syncing && !anyPrivateKnown ? (
          <div className="h-9 w-40 rounded-lg bg-zinc-800/60 animate-pulse" />
        ) : (
          <div className="text-3xl font-semibold text-zinc-100 tabular-nums">
            {anyPrivateKnown ? formatTokenAmount(totalPrivate, 18, 4) : '—'}
            <span className="ml-2 text-sm font-normal text-zinc-500">tokens</span>
          </div>
        )}

        {!privyConnected && privateBalancePermission !== 'GRANTED' && (
          <p className="text-[12px] text-zinc-500">
            {privateBalancePermission === 'DENIED'
              ? 'Private balance hidden — you declined access.'
              : 'Connect and share private balances to see your shielded funds.'}
          </p>
        )}

        {unavailable && privateBalancePermission === 'GRANTED' && (
          <p className="text-[12px] text-zinc-500">Private balance not available yet.</p>
        )}

        {privyConnected && !anyPrivateKnown && (
          <p className="text-[12px] text-zinc-500">
            Syncing private balance — discovery may take a moment.
          </p>
        )}

        {!privyConnected && privateBalanceUpdatedAt && (
          <p className="text-[10px] text-zinc-600">
            Synced {new Date(privateBalanceUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="border-t border-zinc-800/70 divide-y divide-zinc-800/60">
        {rows.map((r) => (
          <div key={r.address} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-800/80 flex items-center justify-center text-sm">
                {r.icon}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-100">{r.symbol}</div>
                <div className="text-[11px] text-zinc-500">Private</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-zinc-100 tabular-nums">
                {r.shieldedBalanceAvailable ? formatTokenAmount(r.shieldedBalance, r.decimals, 4) : '—'}
              </div>
              <div className="text-[11px] text-zinc-500 tabular-nums">
                <Wallet className="w-3 h-3 inline -mt-0.5 mr-1" />
                Public:{' '}
                {r.publicBalanceAvailable ? formatTokenAmount(r.publicBalance, r.decimals, 4) : '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};