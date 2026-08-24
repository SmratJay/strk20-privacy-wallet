'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, Shield, ChevronRight } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { ReceivePanel } from '@/components/wallet/ReceivePanel';
import { TransactionList } from '@/components/wallet/TransactionList';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { EnablePrivateReceiving } from '@/components/wallet/EnablePrivateReceiving';
import { useWallet } from '@/context/WalletContext';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function Home() {
  const { wallet, transactions, privateReceivingState } = useWallet();

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="pt-2">
          <h1 className="text-2xl font-semibold text-zinc-100">
            {greeting()}
            {wallet.isConnected ? '' : ','}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {wallet.isConnected
              ? 'Your private money, at a glance.'
              : 'Receive privately and spend freely on Starknet.'}
          </p>
        </div>

        {!wallet.isConnected && <ConnectGate />}

        {wallet.isConnected && (
          <>
            {privateReceivingState === 'NEEDS_REGISTRATION' && <EnablePrivateReceiving />}

            <BalanceCard />

            {/* Primary actions */}
            <div className="grid grid-cols-3 gap-2">
              <Link
                href="/send"
                className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 py-4 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-rose-500/10 text-rose-300 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-zinc-100">Send</span>
              </Link>
              <Link
                href="/receive"
                className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 py-4 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-300 flex items-center justify-center">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-zinc-100">Receive</span>
              </Link>
              <Link
                href="/send?mode=deposit"
                className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 py-4 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-violet-500/10 text-violet-300 flex items-center justify-center">
                  <Shield className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium text-zinc-100">Make private</span>
              </Link>
            </div>

            <ReceivePanel />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">Recent activity</h2>
                <Link
                  href="/activity"
                  className="flex items-center gap-1 text-[13px] text-violet-300 hover:text-violet-200"
                >
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <TransactionList transactions={transactions} limit={3} />
            </div>

            <PrivacyInfo />
          </>
        )}
      </div>
    </AppShell>
  );
}
