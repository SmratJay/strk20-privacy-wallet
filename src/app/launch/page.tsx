'use client';

import React from 'react';
import { Rocket, Construction } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';

/**
 * Launchpad — explicitly unavailable until it is migrated to the Wallet Core runtime.
 * The previous launchpad required the Privy/Ready wallet lane and Wallet-API signing, which has
 * been removed. It is never silently routed to another wallet.
 */
export default function LaunchPage() {
  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / LAUNCH</div>
            <h1 className="product-page-title">Launch</h1>
            <p className="product-page-description">Launch a token on the ORRANGE launchpad.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
          <Rocket className="w-8 h-8 mx-auto text-zinc-500" />
          <h2 className="mt-3 text-sm font-semibold text-zinc-200">Launchpad is being migrated to Wallet Core</h2>
          <p className="mt-2 text-[12px] text-zinc-500 max-w-md mx-auto">
            The token launchpad previously ran on the removed Privy/Ready wallet lane. It is
            explicitly unavailable until it is migrated to the Orrange Wallet Core runtime — it
            will never use another wallet.
          </p>
          <Construction className="w-5 h-5 mx-auto mt-4 text-zinc-600" />
        </div>
      </div>
    </AppShell>
  );
}