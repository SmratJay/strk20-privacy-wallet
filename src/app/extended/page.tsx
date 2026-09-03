'use client';

import React from 'react';
import { TrendingUp, Construction } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';

/**
 * Extended trading (perps/leverage) — explicitly unavailable until it is migrated to the Wallet
 * Core runtime. The previous extended-trading UI managed its own external-wallet session via
 * get-starknet-discovery, which conflicts with the single-wallet-runtime rule. It is never
 * silently routed to another wallet.
 */
export default function ExtendedPage() {
  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / TRADE</div>
            <h1 className="product-page-title">Extended trading</h1>
            <p className="product-page-description">Leveraged trading on Starknet.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
          <TrendingUp className="w-8 h-8 mx-auto text-zinc-500" />
          <h2 className="mt-3 text-sm font-semibold text-zinc-200">Extended trading is being migrated to Wallet Core</h2>
          <p className="mt-2 text-[12px] text-zinc-500 max-w-md mx-auto">
            Extended/perps trading previously managed its own external-wallet session. It is
            explicitly unavailable until it is migrated to the Orrange Wallet Core runtime — it
            will never use a separate wallet identity.
          </p>
          <Construction className="w-5 h-5 mx-auto mt-4 text-zinc-600" />
        </div>
      </div>
    </AppShell>
  );
}