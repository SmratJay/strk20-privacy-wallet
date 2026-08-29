'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { SendForm } from '@/components/wallet/SendForm';
import { useWallet } from '@/context/WalletContext';

function SendContent() {
  const searchParams = useSearchParams();
  const { wallet } = useWallet();

  const modeParam = searchParams.get('mode');
  const initialMode =
    modeParam === 'deposit' ? 'DEPOSIT' : modeParam === 'withdraw' ? 'WITHDRAW' : 'SEND';

  return (
    <div className="product-page">
      <div className="product-page-intro">
        <div>
          <div className="product-eyebrow">ORRANGE / PRIVACY</div>
          <h1 className="product-page-title">Send privately</h1>
          <p className="product-page-description">
          Send privately — sender, recipient, amount, and token stay hidden.
          </p>
        </div>
      </div>

      {!wallet.isConnected ? (
        <ConnectGate />
      ) : (
        <SendForm initialMode={initialMode} />
      )}
    </div>
  );
}

export default function SendPage() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <SendContent />
      </Suspense>
    </AppShell>
  );
}
