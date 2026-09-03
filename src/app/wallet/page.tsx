'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, Shield, ChevronRight, Copy, Check, Repeat, Lock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { TransactionList } from '@/components/wallet/TransactionList';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { useWallet } from '@/context/WalletContext';
import { priceService } from '@/services/priceService';
import { shortenAddress, copyToClipboard } from '@/utils/formatters';

const formatUsd = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

/**
 * Primary Orrange wallet page — Wallet Core runtime (create/import/unlock/select), no Privy.
 * Public balances come from the runtime (RPC). STRK20 private capabilities remain legacy lanes.
 */
export default function WalletPage() {
  const runtime = useWalletRuntime();
  const state = runtime.getState();
  const session = state.session;
  // Legacy context kept ONLY for the display-only recent-activity list.
  const { transactions } = useWallet();

  const [usdTotal, setUsdTotal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (session) void runtime.refreshPublicBalances();
  }, [runtime, session?.walletId]);

  useEffect(() => {
    if (!session) {
      setUsdTotal(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const prices = await priceService.getPrices();
        let total: number | null = 0;
        for (const row of state.publicBalances) {
          const price = prices[row.token.symbol];
          if (price === undefined || price === null || !row.available) {
            total = null;
            break;
          }
          total += Number(row.balance) / 10 ** row.token.decimals * price;
        }
        if (!cancelled) setUsdTotal(total);
      } catch {
        if (!cancelled) setUsdTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, state.publicBalances]);

  const handleCopy = useCallback(async () => {
    if (!session) return;
    const ok = await copyToClipboard(session.address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [session]);

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / WALLET</div>
            <h1 className="product-page-title">{greeting()}</h1>
            <p className="product-page-description">
              {session ? 'Your private money, at a glance.' : 'Create or import your Starknet wallet.'}
            </p>
          </div>
          {session && (
            <div className="product-summary-address" title="Orrange wallet address">
              Orrange · {shortenAddress(session.address, 6)}
            </div>
          )}
        </div>

        {!session && <WalletCoreGate />}

        {session && (
          <>
            <section className="product-summary" aria-label="Account balance summary">
              <div className="product-summary-top">
                <div>
                  <div className="product-summary-label">Total balance</div>
                  <div className="product-summary-value">{formatUsd(usdTotal)}</div>
                  <div className="product-summary-note">
                    Public balance · live USD estimate when prices are available
                  </div>
                </div>
                <span className="product-summary-label">USD</span>
              </div>
            </section>

            <div>
              <div className="product-eyebrow mb-3">ASSETS</div>
              <div className="product-balance-grid">
                <div className="product-card p-5">
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Account</div>
                  <dl className="space-y-2 text-sm">
                    <Row label="Type" value={session.accountType} />
                    <Row label="Network" value={state.network} />
                    <Row label="Deployment" value={state.deploymentStatus} />
                    <Row label="Private mode" value="signer ready (STRK20 legacy lanes)" />
                  </dl>
                  <button
                    onClick={handleCopy}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#F08A3C]"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy address'}
                  </button>
                </div>
                <div className="product-card p-5">
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Public balances</div>
                  {state.publicBalances.length === 0 ? (
                    <p className="text-sm text-zinc-500">Loading…</p>
                  ) : (
                    <ul className="space-y-2">
                      {state.publicBalances.map((row) => (
                        <li key={row.token.address} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">{row.token.symbol}</span>
                          <span className="font-mono text-zinc-200">
                            {row.available
                              ? (Number(row.balance) / 10 ** row.token.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })
                              : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="product-action-row" aria-label="Wallet actions">
              <Link href="/send" className="product-action">
                <ArrowUpRight aria-hidden="true" />
                <span>Send</span>
              </Link>
              <Link href="/receive" className="product-action">
                <ArrowDownLeft aria-hidden="true" />
                <span>Receive</span>
              </Link>
              <Link href="/send?mode=deposit" className="product-action is-primary">
                <Shield aria-hidden="true" />
                <span>Shield</span>
              </Link>
              <Link href="/swap" className="product-action">
                <Repeat aria-hidden="true" />
                <span>Swap</span>
              </Link>
            </div>

            <section className="product-card-flat p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-300">Receive on Starknet</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="bg-white p-2 rounded-lg shrink-0">
                  <QRCodeSVG value={session.address} size={112} />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-xs text-zinc-300 break-all">{session.address}</div>
                  <button
                    onClick={handleCopy}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#F08A3C]"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy address'}
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Anyone can send public STRK/ERC-20 to this address. Private (STRK20) receiving
                    arrives with the privacy lanes in a later stage.
                  </p>
                </div>
              </div>
            </section>

            <div className="product-card-flat p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">Recent activity</h2>
                <Link href="/activity" className="flex items-center gap-1 text-[13px] text-[#F08A3C] hover:text-[#fed7aa]">
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="mt-4"><TransactionList transactions={transactions} limit={3} /></div>
            </div>

            <div className="product-card-flat p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Lock className="w-4 h-4 text-zinc-500" />
                <span className="text-zinc-300">Wallet unlocked · {session.accountType}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => runtime.lock()}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
                >
                  Lock
                </button>
                <button
                  onClick={() => runtime.deleteWallet(session.walletId)}
                  className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300"
                >
                  Delete local state
                </button>
              </div>
            </div>

            <PrivacyInfo />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 break-all">{value}</dd>
    </div>
  );
}