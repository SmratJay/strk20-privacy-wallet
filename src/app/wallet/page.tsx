'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Copy,
  Check,
  Repeat,
  Lock,
  ChevronRight,
  Loader2,
  TriangleAlert,
  CircleCheck,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletCoreSend } from '@/components/wallet/WalletCoreSend';
import { WalletCorePrivacyPanel } from '@/components/wallet/WalletCorePrivacyPanel';
import { WalletCorePrivateExecute } from '@/components/wallet/WalletCorePrivateExecute';
import { PrivateSwapPanel } from '@/components/wallet/PrivateSwapPanel';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { priceService } from '@/services/priceService';
import { shortenAddress, copyToClipboard } from '@/utils/formatters';
import type { WalletDeploymentStatus } from '@/wallet';

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

const DEPLOYMENT_LABEL: Record<WalletDeploymentStatus, { label: string; tone: 'ready' | 'pending' | 'busy' | 'error' | 'unknown' }> = {
  deployed: { label: 'Ready', tone: 'ready' },
  not_deployed: { label: 'Deployment pending', tone: 'pending' },
  pending: { label: 'Deploying…', tone: 'busy' },
  finalizing: { label: 'Confirming…', tone: 'busy' },
  error: { label: 'Deployment failed', tone: 'error' },
  unknown: { label: 'Unknown', tone: 'unknown' },
};

function DeploymentBadge({ status }: { status: WalletDeploymentStatus }) {
  const { label, tone } = DEPLOYMENT_LABEL[status] ?? { label: status, tone: 'unknown' as const };
  const toneClass = {
    ready: 'text-emerald-300 border-emerald-900 bg-emerald-950/40',
    pending: 'text-amber-300 border-amber-900 bg-amber-950/40',
    busy: 'text-orange-300 border-orange-900 bg-orange-950/40',
    error: 'text-red-300 border-red-900 bg-red-950/40',
    unknown: 'text-zinc-400 border-zinc-700 bg-zinc-900/40',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {tone === 'busy' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
      {tone === 'ready' ? <CircleCheck className="w-3 h-3" /> : null}
      {tone === 'error' || tone === 'unknown' ? <TriangleAlert className="w-3 h-3" /> : null}
      {label}
    </span>
  );
}

/**
 * Primary Orrange wallet page — Wallet Core runtime (create/import/unlock/select/deploy/lock),
 * no Privy, no legacy WalletContext. Everything on this page derives from `WalletRuntime` state.
 * Public + private balances, deployment lifecycle, STRK20 privacy status, shield/private-send/
 * withdraw (Wallet Core signer), wallet selector, lock, delete, and session activity.
 */
export default function WalletPage() {
  const { runtime, state } = useWalletRuntime();
  const account = state.account;

  const [usdTotal, setUsdTotal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    if (account) {
      void runtime.refreshPublicBalances();
      void runtime.refreshPrivateBalances();
      void runtime.refreshDeployment();
      void runtime.refreshPrivacyRegistration();
    }
  }, [runtime, account?.walletId]);

  useEffect(() => {
    if (!account) {
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
  }, [account, state.publicBalances]);

  const handleCopy = useCallback(async () => {
    if (!account) return;
    const ok = await copyToClipboard(account.address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [account]);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    try {
      await runtime.deploy();
    } catch {
      // Runtime state already carries the fail-closed deployment status + error message.
    } finally {
      setDeploying(false);
    }
  }, [runtime]);

  const deployable = account && (state.deploymentStatus === 'not_deployed' || state.deploymentStatus === 'error');

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / WALLET</div>
            <h1 className="product-page-title">{greeting()}</h1>
            <p className="product-page-description">
              {account ? 'Your private money, at a glance.' : 'Create or import your Starknet wallet.'}
            </p>
          </div>
          {account && (
            <div className="product-summary-address" title="Orrange wallet address">
              Orrange · {shortenAddress(account.address, 6)}
            </div>
          )}
        </div>

        {!account && <WalletCoreGate />}

        {account && (
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
              <div className="product-eyebrow mb-3">ACCOUNT</div>
              <div className="product-card p-5">
                <dl className="space-y-2 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-zinc-500">Address</dt>
                    <dd className="font-mono text-zinc-200 break-all">{account.address}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-zinc-500">Type</dt>
                    <dd className="text-zinc-200">{account.accountType}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-zinc-500">Network</dt>
                    <dd className="text-zinc-200">{state.network}</dd>
                  </div>
                  <div className="flex gap-3 items-center">
                    <dt className="w-28 shrink-0 text-zinc-500">Deployment</dt>
                    <dd className="flex items-center gap-2">
                      <DeploymentBadge status={state.deploymentStatus} />
                      {deployable && (
                        <button
                          onClick={handleDeploy}
                          disabled={deploying}
                          className="inline-flex items-center gap-1.5 rounded-md border border-orange-800 px-2 py-1 text-[11px] text-orange-300 disabled:opacity-40"
                        >
                          {deploying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                          Deploy account
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>
                <button
                  onClick={handleCopy}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#F08A3C]"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy address'}
                </button>
              </div>
            </div>

            <div className="mt-6">
              <div className="product-eyebrow mb-3">BALANCES</div>
              <div className="product-balance-grid">
                <div className="product-card p-5">
                  <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Public</div>
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
                <div className="product-card p-5">
                  <div className="text-xs uppercase tracking-widest text-violet-300 mb-3">Private</div>
                  {!state.privacy.available ? (
                    <p className="text-xs text-zinc-500">
                      Unavailable — {state.privacy.reason ?? 'STRK20 proving/discovery services are not configured.'}
                    </p>
                  ) : state.privacy.status === 'loading' ? (
                    <p className="text-sm text-zinc-500">Loading…</p>
                  ) : state.privacy.status === 'error' ? (
                    <p className="text-xs text-red-300">Discovery failed — {state.privacy.reason ?? 'no private balance.'}</p>
                  ) : state.privateBalances.length === 0 ? (
                    <p className="text-xs text-zinc-500">No private balance discovered (shields will appear here).</p>
                  ) : (
                    <ul className="space-y-2">
                      {state.privateBalances.map((row) => (
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

            <div className="mt-6">
              <div className="product-eyebrow mb-3">STRK20 PRIVACY</div>
              <div className="product-card p-5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-300">
                    {!state.privacy.available
                      ? 'Privacy setup unavailable'
                      : state.privacy.maturity === 'waiting'
                        ? 'Privacy setup waiting for chain confirmation'
                        : state.privacy.registered === true
                          ? 'Privacy ready'
                          : state.privacy.registered === false
                            ? 'Privacy available — not registered yet'
                            : 'Checking privacy…'}
                  </span>
                  <DeploymentBadge
                    status={
                      !state.privacy.available
                        ? 'error'
                        : state.privacy.maturity === 'waiting'
                          ? 'finalizing'
                          : state.privacy.registered === true
                            ? 'deployed'
                            : state.privacy.registered === false
                              ? 'not_deployed'
                              : 'unknown'
                    }
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  {!state.privacy.available
                    ? state.privacy.reason ??
                      'Privacy setup unavailable: proving/discovery service is not configured.'
                    : state.privacy.maturity === 'waiting'
                      ? `Account deployed — privacy setup is waiting for chain confirmation. Ready at block ${
                          state.privacy.maturityReadyAtBlock ?? '…'
                        }${state.privacy.currentBlock !== null ? ` (current head ${state.privacy.currentBlock})` : ''}.`
                      : state.privacy.registered === true
                        ? 'Your wallet-native viewing key is registered in the STRK20 pool. Shield, send privately, and withdraw are live.'
                        : state.privacy.registered === false
                          ? 'The STRK20 protocol is available. Your viewing key is not yet registered — the first shield auto-registers it on-chain.'
                          : state.privacy.status === 'error'
                            ? `Privacy setup unavailable: ${state.privacy.reason ?? 'registration check failed.'}`
                            : 'Contacting the discovery service…'}
                </p>
                {state.privacy.syncing && (
                  <p className="text-xs text-amber-300/80 mt-2">
                    The private-balance indexer is still syncing — recent shielded amounts may not
                    appear yet. Balances shown are as of the discovery snapshot.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="product-eyebrow mb-3">ACTIONS</div>
              <div className="product-action-row" aria-label="Wallet actions">
                <Link href="/send" className="product-action">
                  <ArrowUpRight aria-hidden="true" />
                  <span>Public send</span>
                </Link>
                <Link href="/receive" className="product-action">
                  <ArrowDownLeft aria-hidden="true" />
                  <span>Receive</span>
                </Link>
                <Link href="/send?mode=deposit" className="product-action is-primary">
                  <Shield aria-hidden="true" />
                  <span>Shield</span>
                </Link>
                <Link href="/send?mode=withdraw" className="product-action">
                  <ArrowDownLeft aria-hidden="true" />
                  <span>Withdraw</span>
                </Link>
                <Link href="/swap" className="product-action">
                  <Repeat aria-hidden="true" />
                  <span>Swap</span>
                </Link>
              </div>
            </div>

            <div className="mt-6">
              <div className="product-eyebrow mb-3">PUBLIC OPERATIONS</div>
              <WalletCoreSend />
            </div>

            {state.privacy.available && (
              <div className="mt-6">
                <div className="product-eyebrow mb-3">PRIVATE OPERATIONS</div>
                <WalletCorePrivacyPanel />
              </div>
            )}

            {state.privacy.available && (
              <div className="mt-6">
                <div className="product-eyebrow mb-3">PRIVATE EXECUTION</div>
                <WalletCorePrivateExecute />
              </div>
            )}

            {state.privacy.available && (
              <div className="mt-6">
                <div className="product-eyebrow mb-3">PRIVATE SWAP</div>
                <PrivateSwapPanel />
              </div>
            )}

            <section className="product-card-flat p-5 sm:p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-300">Receive on Starknet</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="bg-white p-2 rounded-lg shrink-0">
                  <QRCodeSVG value={account.address} size={112} />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-xs text-zinc-300 break-all">{account.address}</div>
                  <button
                    onClick={handleCopy}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#F08A3C]"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy address'}
                  </button>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Anyone can send public STRK/ERC-20 to this address. Private (STRK20) sending
                    uses the wallet-native viewing key and the STRK20 pool above.
                  </p>
                </div>
              </div>
            </section>

            <div className="product-card-flat p-5 sm:p-6 mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">Recent activity</h2>
                <Link href="/activity" className="flex items-center gap-1 text-[13px] text-[#F08A3C] hover:text-[#fed7aa]">
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {state.recentTransactions.length === 0 ? (
                <p className="text-xs text-zinc-500 mt-3">
                  No activity yet this session. Activity tracking for the Wallet Core runtime is
                  in-memory and session-scoped.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {state.recentTransactions.map((tx) => (
                    <li key={tx.hash} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-zinc-400">{shortenAddress(tx.hash, 8)}</span>
                      <span className="text-zinc-500">{new Date(tx.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="product-card-flat p-5 sm:p-6 mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Lock className="w-4 h-4 text-zinc-500" />
                <span className="text-zinc-300">Wallet unlocked · {account.accountType}</span>
              </div>
              <div className="flex gap-2">
                <select
                  value={state.selectedWalletId ?? ''}
                  onChange={(e) => {
                    if (e.target.value) runtime.selectWallet(e.target.value);
                  }}
                  aria-label="Switch wallet"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200"
                >
                  {state.wallets.map((w) => (
                    <option key={w.walletId} value={w.walletId}>
                      {w.accountType} · {shortenAddress(w.address, 5)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => runtime.lock()}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
                >
                  Lock
                </button>
                <button
                  onClick={() => runtime.deleteWallet(account.walletId)}
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