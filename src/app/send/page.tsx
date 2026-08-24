'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { SendForm } from '@/components/wallet/SendForm';
import { EnablePrivateReceiving } from '@/components/wallet/EnablePrivateReceiving';
import { useWallet } from '@/context/WalletContext';

function SendContent() {
  const searchParams = useSearchParams();
  const { wallet, privateReceivingState } = useWallet();

  const modeParam = searchParams.get('mode');
  const initialMode =
    modeParam === 'deposit' ? 'DEPOSIT' : modeParam === 'withdraw' ? 'WITHDRAW' : 'SEND';

  return (
    <div className="space-y-6">
      <div className="pt-2 space-y-1">
        <h1 className="text-2xl font-semibold text-zinc-100">Send</h1>
        <p className="text-sm text-zinc-500">
          Send privately — sender, recipient, amount, and token stay hidden.
        </p>
      </div>

      {!wallet.isConnected ? (
        <ConnectGate />
      ) : (
        <>
          {privateReceivingState === 'NEEDS_REGISTRATION' && <EnablePrivateReceiving />}
          <SendForm initialMode={initialMode} />
        </>
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
