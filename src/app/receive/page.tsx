'use client';

import React from 'react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { ReceivePanel } from '@/components/wallet/ReceivePanel';
import { TransactionList } from '@/components/wallet/TransactionList';
import { useWallet } from '@/context/WalletContext';

export default function ReceivePage() {
  const { wallet, transactions } = useWallet();

  const incoming = transactions.filter(
    (t) => t.type === 'SHIELD' || t.type === 'UNSHIELD'
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="pt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-100">Receive privately</h1>
          <p className="text-sm text-zinc-500">
            Share your private address — anyone can pay you without seeing your activity.
          </p>
        </div>

        {!wallet.isConnected ? (
          <ConnectGate />
        ) : (
          <>
            <ReceivePanel large />
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-zinc-300">Recent private payments</h2>
              {incoming.length > 0 ? (
                <TransactionList transactions={incoming} limit={5} />
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center">
                  <p className="text-sm text-zinc-400">No private payments yet</p>
                  <p className="text-[12px] text-zinc-600">
                    When someone sends you STRK20 privately, it will appear here.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
