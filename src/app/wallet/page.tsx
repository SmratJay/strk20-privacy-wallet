'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, Shield, ChevronRight, Repeat } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { PublicBalanceCard } from '@/components/wallet/PublicBalanceCard';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { ReceivePanel } from '@/components/wallet/ReceivePanel';
import { TransactionList } from '@/components/wallet/TransactionList';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { PrivyConnect } from '@/components/wallet/PrivyConnect';
import { useWallet } from '@/context/WalletContext';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function WalletPage() {
  const { wallet, transactions, balances } = useWallet();
  const primaryBalance = balances[0];
  const totalAvailable = Boolean(primaryBalance?.publicBalanceAvailable && primaryBalance?.shieldedBalanceAvailable === true);
  const formatBalance = (value: bigint, available: boolean) => available && primaryBalance
    ? `${formatTokenAmount(value, primaryBalance.token.decimals, 4)} ${primaryBalance.token.symbol}`
    : '—';

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / WALLET</div>
            <h1 className="product-page-title">{greeting()}</h1>
            <p className="product-page-description">
            {wallet.isConnected
              ? 'Your private money, at a glance.'
              : 'Receive privately and spend freely on Starknet.'}
            </p>
          </div>
          {wallet.isConnected && wallet.address && (
            <div className="product-summary-address" title="Connected wallet address">
              {wallet.walletName || 'Account 01'} · {shortenAddress(wallet.address, 6)}
            </div>
          )}
        </div>

        {!wallet.isConnected && <ConnectGate />}

        <PrivyConnect />

        {wallet.isConnected && (
          <>
            <section className="product-summary" aria-label="Account balance summary">
              <div className="product-summary-top">
                <div>
                  <div className="product-summary-label">Total balance</div>
                  <div className="product-summary-value">
                    {primaryBalance ? formatBalance(primaryBalance.publicBalance + primaryBalance.shieldedBalance, totalAvailable) : '—'}
                  </div>
                  <div className="product-summary-note">Values shown per asset · no fiat conversion</div>
                </div>
                <span className="product-summary-label">{primaryBalance?.token.symbol || 'STRK20'}</span>
              </div>
              <div className="product-summary-split">
                <div>
                  <div className="product-split-label"><span /> Public</div>
                  <div className="product-split-value">{primaryBalance ? formatBalance(primaryBalance.publicBalance, primaryBalance.publicBalanceAvailable) : '—'}</div>
                </div>
                <div>
                  <div className="product-split-label"><span className="is-private" /> Private</div>
                  <div className="product-split-value">{primaryBalance ? formatBalance(primaryBalance.shieldedBalance, primaryBalance.shieldedBalanceAvailable === true) : '—'}</div>
                </div>
              </div>
            </section>

            <div>
              <div className="product-eyebrow mb-3">ASSETS</div>
              <div className="product-balance-grid">
                <PublicBalanceCard />
                <BalanceCard />
              </div>
            </div>

            {/* Primary actions */}
            <div className="product-action-row" aria-label="Wallet actions">
              <Link
                href="/send"
                className="product-action"
              >
                <ArrowUpRight aria-hidden="true" />
                <span>Send</span>
              </Link>
              <Link
                href="/receive"
                className="product-action"
              >
                <ArrowDownLeft aria-hidden="true" />
                <span>Receive</span>
              </Link>
              <Link
                href="/send?mode=deposit"
                className="product-action is-primary"
              >
                <Shield aria-hidden="true" />
                <span>Shield</span>
              </Link>
              <Link
                href="/swap"
                className="product-action"
              >
                <Repeat aria-hidden="true" />
                <span>Swap</span>
              </Link>
            </div>

            <ReceivePanel />

            <div className="product-card-flat p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">Recent activity</h2>
                <Link
                  href="/activity"
                  className="flex items-center gap-1 text-[13px] text-[#F08A3C] hover:text-[#fed7aa]"
                >
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="mt-4"><TransactionList transactions={transactions} limit={3} /></div>
            </div>

            <PrivacyInfo />
          </>
        )}
      </div>
    </AppShell>
  );
}
