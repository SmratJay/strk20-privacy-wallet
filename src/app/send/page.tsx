'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletCoreSend } from '@/components/wallet/WalletCoreSend';
import { WalletCorePrivacyPanel } from '@/components/wallet/WalletCorePrivacyPanel';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';

/**
 * Primary Orrange send flow — fully Wallet Core driven. There is no legacy STRK20 lane and no
 * Privy fallback:
 *   - PUBLIC SEND: Wallet Runtime → Wallet Core local signer.
 *   - STRK20 PRIVATE: Wallet Runtime → Wallet Core privacy session (wallet-native viewing key).
 * If privacy is unavailable, the panel explains why (never a silent switch to another wallet).
 * There is no legacy wallet lane and no Privy fallback.
 */
function SendContent() {
  const searchParams = useSearchParams();
  const { state } = useWalletRuntime();

  const modeParam = searchParams.get('mode');
  const privateMode = modeParam === 'deposit' ? 'SHIELD' : modeParam === 'withdraw' ? 'WITHDRAW' : 'TRANSFER';
  const [tab, setTab] = useState<'public' | 'private'>(privateMode === 'TRANSFER' ? 'public' : 'private');
  useEffect(() => { setTab(modeParam ? 'private' : 'public'); }, [modeParam]);

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
    <div className="product-page wallet-flow-page">
      <div className="product-page-intro">
        <div>
          <div className="product-eyebrow">ORRANGE / SEND</div>
          <h1 className="product-page-title">{tab === 'private' ? 'Private' : 'Send'}</h1>
          <p className="product-page-description">
            Send from your public balance, or manage your private funds.
          </p>
        </div>
      </div>

      <div className="wallet-tabs" role="group" aria-label="Balance to use">
        <button
          onClick={() => setTab('public')}
          aria-pressed={tab === 'public'}
          className={`px-3 py-1 rounded-md text-sm border ${
            tab === 'public' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
          }`}
        >
          Public
        </button>
        <button
          onClick={() => setTab('private')}
          aria-pressed={tab === 'private'}
          className={`px-3 py-1 rounded-md text-sm border ${
            tab === 'private' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
          }`}
        >
          Private
        </button>
      </div>

      {tab === 'public' ? (
        <WalletCoreSend />
      ) : (
        <WalletCorePrivacyPanel key={privateMode} initialOp={privateMode} />
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
