'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletCoreSend } from '@/components/wallet/WalletCoreSend';
import { WalletCorePrivacyPanel } from '@/components/wallet/WalletCorePrivacyPanel';
import { SendForm } from '@/components/wallet/SendForm';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';

/**
 * Primary Orrange send flow — fully Wallet Core driven.
 *
 *  - PUBLIC SEND: Wallet Runtime → Wallet Core local signer.
 *  - STRK20 PRIVATE: Wallet Runtime → Wallet Core privacy session (wallet-native viewing key).
 *    The legacy STRK20 private lane (Ready Wallet API / Privy) is rendered ONLY as a clearly
 *    marked compatibility fallback when the Wallet Core privacy capability is unavailable AND a
 *    legacy-compatible wallet is connected. Legacy/Privy state never decides the active wallet.
 */
function SendContent() {
  const searchParams = useSearchParams();
  const runtime = useWalletRuntime();
  const state = runtime.getState();

  const legacy = useWallet();
  const privy = usePrivyWallet();
  const legacyLaneAvailable = legacy.wallet.isConnected || (privy.authenticated && privy.account !== null);

  const modeParam = searchParams.get('mode');
  const privateMode = modeParam === 'deposit' ? 'SHIELD' : modeParam === 'withdraw' ? 'WITHDRAW' : 'TRANSFER';
  const [tab, setTab] = useState<'public' | 'private'>(privateMode === 'TRANSFER' ? 'public' : 'private');

  if (!state.isUnlocked) {
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

  const privacyAvailable = state.privacy.available;

  return (
    <div className="product-page">
      <div className="product-page-intro">
        <div>
          <div className="product-eyebrow">ORRANGE / SEND</div>
          <h1 className="product-page-title">Send</h1>
          <p className="product-page-description">
            Public sends are signed locally by your Orrange wallet. STRK20 private sends use the
            wallet-native privacy session.
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
          STRK20 private
        </button>
      </div>

      {tab === 'public' ? (
        <WalletCoreSend />
      ) : privacyAvailable ? (
        <WalletCorePrivacyPanel initialOp={privateMode} />
      ) : (
        <>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 mb-4">
            <h2 className="text-sm font-semibold text-zinc-200">STRK20 privacy — unavailable in Wallet Core</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {state.privacy.reason ?? 'Wallet Core privacy is not available yet.'} The Wallet Core
              signer and viewing key are ready; proving/discovery services must be configured for
              private operations.
            </p>
            {legacyLaneAvailable && (
              <p className="text-xs text-zinc-600 mt-2">
                Legacy compatibility: a legacy privacy wallet is connected, so the old STRK20 lane
                below remains available.
              </p>
            )}
          </div>
          {legacyLaneAvailable && <SendForm initialMode={modeParam === 'withdraw' ? 'WITHDRAW' : modeParam === 'deposit' ? 'DEPOSIT' : 'SEND'} />}
        </>
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