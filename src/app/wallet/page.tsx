'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, Shield, ChevronRight, Repeat } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { PublicBalanceCard } from '@/components/wallet/PublicBalanceCard';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { ReceivePanel } from '@/components/wallet/ReceivePanel';
import { TransactionList } from '@/components/wallet/TransactionList';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { privacyService } from '@/services/privacyService';
import { priceService, type TokenPrices } from '@/services/priceService';
import { shortenAddress } from '@/utils/formatters';
import type { TokenInfo } from '@/config/networks';

interface ValuationRow {
  token: TokenInfo;
  publicBalance: bigint;
  publicAvailable: boolean;
  privateBalance: bigint;
  privateAvailable: boolean;
}

interface WalletValuation {
  prices: TokenPrices;
  rows: ValuationRow[];
}

const formatUsd = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
};

const valueRows = (
  rows: ValuationRow[],
  prices: TokenPrices,
  kind: 'public' | 'private',
): number | null => {
  const relevant = rows.filter((row) => kind === 'public' ? row.publicAvailable : row.privateAvailable);
  if (relevant.length === 0) return null;

  let total = 0;
  for (const row of relevant) {
    const price = prices[row.token.symbol];
    if (price === undefined || price === null) return null;
    const balance = kind === 'public' ? row.publicBalance : row.privateBalance;
    total += Number(balance) / (10 ** row.token.decimals) * price;
  }
  return total;
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function WalletPage() {
  const { wallet, transactions, balances, currentNetwork, privyConnected } = useWallet();
  const privy = usePrivyWallet();
  const [valuation, setValuation] = useState<WalletValuation | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);

  useEffect(() => {
    if (!wallet.isConnected) {
      setValuation(null);
      return;
    }

    let cancelled = false;
    const loadValuation = async () => {
      setValuationLoading(true);
      try {
        const prices = await priceService.getPrices();
        let rows: ValuationRow[];

        if (privyConnected && privy.address) {
          const publicBalances = await privacyService.fetchBalances(privy.address, undefined, currentNetwork);
          const publicByToken = new Map(
            publicBalances.map((balance) => [balance.token.address.toLowerCase(), balance]),
          );

          rows = await Promise.all(currentNetwork.tokens.map(async (token) => {
            const publicBalance = publicByToken.get(token.address.toLowerCase());
            let privateBalance = 0n;
            let privateAvailable = false;
            try {
              privateBalance = await privy.getPrivateBalance(token.address);
              privateAvailable = true;
            } catch {
              // A failed discovery read stays unknown; it must not become a fake zero.
            }
            return {
              token,
              publicBalance: publicBalance?.publicBalance ?? 0n,
              publicAvailable: publicBalance?.publicBalanceAvailable === true,
              privateBalance,
              privateAvailable,
            };
          }));
        } else {
          rows = currentNetwork.tokens.map((token) => {
            const balance = balances.find((entry) => entry.token.address.toLowerCase() === token.address.toLowerCase());
            return {
              token,
              publicBalance: balance?.publicBalance ?? 0n,
              publicAvailable: balance?.publicBalanceAvailable === true,
              privateBalance: balance?.shieldedBalance ?? 0n,
              privateAvailable: balance?.shieldedBalanceAvailable === true,
            };
          });
        }

        if (!cancelled) setValuation({ prices, rows });
      } catch {
        if (!cancelled) setValuation(null);
      } finally {
        if (!cancelled) setValuationLoading(false);
      }
    };

    void loadValuation();
    const timer = setInterval(loadValuation, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wallet.isConnected, balances, currentNetwork, privyConnected, privy.address]);

  const publicUsd = valuation ? valueRows(valuation.rows, valuation.prices, 'public') : null;
  const privateUsd = valuation ? valueRows(valuation.rows, valuation.prices, 'private') : null;
  const totalUsd = publicUsd !== null && privateUsd !== null ? publicUsd + privateUsd : null;

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
              : 'Receive and spend freely on Starknet.'}
            </p>
          </div>
          {wallet.isConnected && wallet.address && (
            <div className="product-summary-address" title="Connected wallet address">
              {wallet.walletName || 'Account 01'} · {shortenAddress(wallet.address, 6)}
            </div>
          )}
        </div>

        {!wallet.isConnected && <ConnectGate />}

        {wallet.isConnected && (
          <>
            <section className="product-summary" aria-label="Account balance summary">
              <div className="product-summary-top">
                <div>
                  <div className="product-summary-label">Total balance</div>
                  <div className="product-summary-value">
                    {valuationLoading && !valuation ? '…' : formatUsd(totalUsd)}
                  </div>
                  <div className="product-summary-note">
                    {totalUsd === null ? 'USD value appears when live prices and balances are available' : 'Live USD estimate · public + private balances'}
                  </div>
                </div>
                <span className="product-summary-label">USD</span>
              </div>
              <div className="product-summary-split">
                <div>
                  <div className="product-split-label"><span /> Public</div>
                  <div className="product-split-value">{formatUsd(publicUsd)}</div>
                </div>
                <div>
                  <div className="product-split-label"><span className="is-private" /> Private</div>
                  <div className="product-split-value">{formatUsd(privateUsd)}</div>
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
