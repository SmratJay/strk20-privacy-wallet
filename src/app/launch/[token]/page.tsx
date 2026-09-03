'use client';

import React from 'react';
import { Rocket, Construction } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';

/**
 * Launchpad token page — explicitly unavailable until it is migrated to the Wallet Core runtime.
 * The previous token trading UI required the Privy/Ready wallet lane and the legacy private-curve
 * path; it is never silently routed to another wallet.
 */
export default function LaunchTokenPage() {
  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / LAUNCH</div>
            <h1 className="product-page-title">Token</h1>
            <p className="product-page-description">Trade a launchpad token privately.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
          <Rocket className="w-8 h-8 mx-auto text-zinc-500" />
          <h2 className="mt-3 text-sm font-semibold text-zinc-200">Token trading is being migrated to Wallet Core</h2>
          <p className="mt-2 text-[12px] text-zinc-500 max-w-md mx-auto">
            Launchpad token trading previously ran on the removed Privy/Ready wallet lane. It is
            explicitly unavailable until it is migrated to the Orrange Wallet Core runtime — it
            will never use another wallet.
          </p>
          <Construction className="w-5 h-5 mx-auto mt-4 text-zinc-600" />
        </div>
      </div>
    </AppShell>
  );
}