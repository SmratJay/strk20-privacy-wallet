'use client';

import React from 'react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { shortenAddress } from '@/utils/formatters';

/**
 * Activity — bound exclusively to the current WalletRuntime session. Entries are recorded by the
 * runtime itself (public sends + STRK20 privacy ops) and are keyed to the active walletId/network
 * (the runtime drops them on lock / wallet switch / network reload). No legacy wallet activity is
 * ever substituted. Historical indexer activity is not built yet.
 */
export default function ActivityPage() {
  const { state } = useWalletRuntime();
  const account = state.account;
  const transactions = state.recentTransactions;

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / ACTIVITY</div>
            <h1 className="product-page-title">Activity</h1>
            <p className="product-page-description">
              A quiet record of this wallet's submitted transactions.
            </p>
          </div>
          {account && (
            <div className="product-summary-address" title="Orrange wallet address">
              Orrange · {shortenAddress(account.address, 6)}
            </div>
          )}
        </div>

        {!account ? (
          <WalletCoreGate />
        ) : transactions.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
            <p className="text-sm text-zinc-400">Activity for this wallet will appear here.</p>
            <p className="text-[12px] text-zinc-600 mt-1">
              Transactions submitted from this Orrange wallet during this session are shown here.
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-800/60">
            {transactions.map((tx) => (
              <li key={tx.hash} className="flex items-center justify-between px-5 py-3.5 text-sm">
                <span className="font-mono text-zinc-300">{shortenAddress(tx.hash, 12)}</span>
                <span className="text-zinc-500">{new Date(tx.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}