'use client';

import React from 'react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { TransactionList } from '@/components/wallet/TransactionList';
import { useWallet } from '@/context/WalletContext';

export default function ActivityPage() {
  const { wallet, transactions, clearTransactions } = useWallet();

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="pt-2 space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-100">Activity</h1>
          <p className="text-sm text-zinc-500">Your private payments.</p>
        </div>

        {!wallet.isConnected ? (
          <ConnectGate />
        ) : (
          <TransactionList transactions={transactions} onClear={clearTransactions} />
        )}
      </div>
    </AppShell>
  );
}
