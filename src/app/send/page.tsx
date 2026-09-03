'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletCoreSend, LegacyStrk20CompatNote } from '@/components/wallet/WalletCoreSend';
import { SendForm } from '@/components/wallet/SendForm';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';

/**
 * Primary Orrange send flow.
 *
 *  - PUBLIC SEND: Wallet Core runtime (local signer, no Privy / no Wallet API).
 *  - STRK20 PRIVATE: the legacy privacy lane. It is rendered ONLY when a legacy privacy-capable
 *    wallet (Ready Wallet API or Privy) is actually connected; otherwise a compatibility note is
 *    shown. The Wallet Core signer is ready for STRK20 but private capabilities land in a later
 *    stage (viewing-key derivation etc.).
 */
function SendContent() {
  const searchParams = useSearchParams();
  const runtime = useWalletRuntime();
  const state = runtime.getState();

  const legacy = useWallet();
  const privy = usePrivyWallet();
  const legacyLaneAvailable = legacy.wallet.isConnected || (privy.authenticated && privy.account !== null);

  const modeParam = searchParams.get('mode');
  const privateMode = modeParam === 'deposit' ? 'DEPOSIT' : modeParam === 'withdraw' ? 'WITHDRAW' : 'SEND';
  const [tab, setTab] = useState<'public' | 'private'>(privateMode === 'SEND' ? 'public' : 'private');

  if (!state.session) {
    return (
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / SEND</div>
            <h1 className="product-page-title">Send</h1>
            <p className="product-page-description">Create or import your Orrange wallet to send.</p>
          </div>
        </div>
        <WalletCoreGate />
      </div>
    );
  }

  return (
    <div className="product-page">
      <div className="product-page-intro">
        <div>
          <div className="product-eyebrow">ORRANGE / SEND</div>
          <h1 className="product-page-title">Send</h1>
          <p className="product-page-description">
            Public sends are signed locally by your Orrange wallet. STRK20 private sends use the
            legacy privacy lane when a compatible wallet is connected.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setTab('public')}
          className={`px-3 py-1 rounded-md text-sm border ${
            tab === 'public' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
          }`}
        >
          Public send (Orrange)
        </button>
        <button
          onClick={() => setTab('private')}
          className={`px-3 py-1 rounded-md text-sm border ${
            tab === 'private' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
          }`}
        >
          STRK20 private (legacy)
        </button>
      </div>

      {tab === 'public' ? (
        <WalletCoreSend />
      ) : legacyLaneAvailable ? (
        <SendForm initialMode={privateMode} />
      ) : (
        <LegacyStrk20CompatNote available={false} modeLabel="transfer" />
      )}
    </div>
  );
}

export default function SendPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="product-page"><div className="product-page-intro"><div className="product-page-title">Send</div></div></div>}>
        <SendContent />
      </Suspense>
    </AppShell>
  );
}