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
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / ACTIVITY</div>
            <h1 className="product-page-title">Activity</h1>
            <p className="product-page-description">A quiet record of your private payments.</p>
          </div>
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
