'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownLeft, Shield, Copy, Check, Repeat, Globe, Lock, ChevronRight, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletCorePrivateExecute } from '@/components/wallet/WalletCorePrivateExecute';
import { WalletActivity } from '@/components/wallet/WalletActivity';
import { TransactionReview, WalletError } from '@/components/wallet/TransactionFeedback';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { useToast } from '@/components/Toast';
import { priceService } from '@/services/priceService';
import { shortenAddress, copyToClipboard, formatTokenAmount } from '@/utils/formatters';
import { networkLabel } from '@/utils/walletUx';

const formatUsd = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

export default function WalletPage() {
  const { runtime, state } = useWalletRuntime();
  const account = state.account;
  const { showToast } = useToast();
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [copied, setCopied] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [reviewDeploy, setReviewDeploy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!account || state.network !== 'mainnet') { setPrices({}); return; }
    let cancelled = false;
    const refresh = async () => { try { const next = await priceService.getPrices(); if (!cancelled) setPrices(next); } catch { if (!cancelled) setPrices({}); } };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [account?.walletId, state.network]);

  const valueOf = (rows: typeof state.publicBalances): number | null => {
    if (state.network !== 'mainnet' || !rows.length) return null;
    let total = 0;
    for (const row of rows) {
      if (!row.available) return null;
      if (row.balance === 0n) continue;
      const price = prices[row.token.symbol];
      if (price == null || !Number.isFinite(price)) return null;
      total += Number(row.balance) / 10 ** row.token.decimals * price;
    }
    return Number.isFinite(total) ? total : null;
  };
  const publicUsd = valueOf(state.publicBalances);
  const privateUsd = state.privacy.available && state.privacy.status !== 'error' ? valueOf(state.privateBalances) : null;
  const usdTotal = publicUsd !== null && privateUsd !== null ? publicUsd + privateUsd : null;

  async function copy() {
    if (!account) return;
    if (await copyToClipboard(account.address)) { setCopied(true); setTimeout(() => setCopied(false), 2000); showToast({ type: 'success', title: 'Address copied' }); }
    else showToast({ type: 'error', title: 'Could not copy address', description: 'Open Receive to copy the full address.' });
  }
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true); setError(null);
    try { await Promise.all([runtime.refreshPublicBalances(), runtime.refreshPrivateBalances(), runtime.refreshDeployment()]); }
    catch (err) { setError(err); }
    finally { setRefreshing(false); }
  }
  async function deploy() {
    if (deploying) return;
    setDeploying(true); setError(null);
    try { await runtime.deploy(); setReviewDeploy(false); }
    catch (err) { setError(err); }
    finally { setDeploying(false); }
  }

  return <AppShell><div className="product-page">
    <div className="product-page-intro"><div><div className="product-eyebrow">ORRANGE / WALLET</div><h1 className="product-page-title">{greeting()}</h1><p className="product-page-description">{account ? 'Your private money, at a glance.' : 'Your wallet. Your keys. Your next move.'}</p></div>
      {account && <button onClick={() => void copy()} className="product-summary-address wallet-address-button" aria-label="Copy wallet address">{copied ? <Check /> : <Copy />} {shortenAddress(account.address, 6)} · {networkLabel(state.network)}</button>}
    </div>
    {!account ? <WalletCoreGate /> : <>
      <section className="product-summary" aria-label="Account balance summary">
        <div className="product-summary-top"><div className="space-y-3"><div className="product-summary-label">Total balance</div><div className="product-summary-value">{formatUsd(usdTotal)}</div><div className="product-summary-note">{state.network !== 'mainnet' ? 'Test assets · no real USD value' : usdTotal === null ? 'USD total unavailable until all balances and prices are known.' : 'Public + private · indicative USD value'}</div></div><span className="product-summary-label">{state.network === 'mainnet' ? 'USD' : 'TESTNET'}</span></div>
        <div className="product-summary-split"><div><div className="product-summary-label">Public</div><p className="text-xl font-semibold">{formatUsd(publicUsd)}</p></div><div><div className="product-summary-label">Private</div><p className="text-xl font-semibold">{formatUsd(privateUsd)}</p></div></div>
      </section>

      <div className="product-action-row wallet-home-actions" aria-label="Wallet actions">
        {[{ href: '/send', label: 'Send', Icon: ArrowUpRight }, { href: '/receive', label: 'Receive', Icon: ArrowDownLeft },
          { href: '/send?mode=deposit', label: 'Shield', Icon: Shield }, { href: '/send?mode=withdraw', label: 'Unshield', Icon: ArrowDownLeft },
          { href: '/swap', label: 'Swap', Icon: Repeat }, { href: '/cross-chain', label: 'Cross-chain', Icon: Globe }].map(({ href, label, Icon }) =>
          <Link key={href} href={href} className={'product-action' + (label === 'Shield' ? ' is-primary' : '')}><Icon aria-hidden="true" /><span>{label}</span></Link>)}
      </div>
      <WalletError error={error || state.error} />

      {state.deploymentStatus !== 'deployed' && <section className="product-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">{state.deploymentStatus === 'unknown' ? 'Checking your account…' : deploying ? 'Activating your account…' : 'Activate your wallet'}</h2>
        <p className="text-sm text-zinc-500">Receive STRK on {networkLabel(state.network)} to cover the one-time account activation fee. You can receive funds now; activate before sending or shielding.</p>
        {reviewDeploy ? <TransactionReview title="Activate your wallet" rows={[{ label: 'Account', value: account.address }, { label: 'Network', value: networkLabel(state.network) }, { label: 'Network fee', value: 'Paid from your public STRK · determined during activation' }]} onBack={() => setReviewDeploy(false)} onConfirm={() => void deploy()} busy={deploying} note="This deploys your wallet account on Starknet. A network fee applies." confirmLabel="Confirm activation" /> :
          <div className="flex flex-wrap gap-3"><Link href="/receive" className="wallet-secondary-button">Add STRK</Link><button disabled={deploying || state.deploymentStatus === 'unknown' || state.deploymentStatus === 'pending' || state.deploymentStatus === 'finalizing'} onClick={() => setReviewDeploy(true)} className="product-primary-button px-4 disabled:opacity-50">Review activation</button></div>}
      </section>}

      <section><div className="flex items-center justify-between mb-3"><div className="product-eyebrow">ASSETS</div><button className="wallet-secondary-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing && <Loader2 className="w-4 h-4 animate-spin" />}{refreshing ? 'Refreshing balances…' : 'Refresh balances'}</button></div>
        <div className="product-balance-grid">{(['Public', 'Private'] as const).map(kind => {
          const rows = kind === 'Public' ? state.publicBalances : state.privateBalances;
          const unavailable = kind === 'Private' && (!state.privacy.available || state.privacy.status === 'error');
          return <div key={kind} className="product-card p-5"><h2 className="text-sm font-semibold mb-4">{kind} balance</h2>
            {unavailable ? <div className="text-sm text-zinc-500 space-y-2"><p>Private balance is currently unavailable.</p><Link className="underline inline-block" href="/settings">Check privacy settings</Link></div> :
              rows.length === 0 ? <div role="status"><p className="text-sm text-zinc-500">{kind === 'Private' && state.privacy.status !== 'loading' ? 'Shield STRK to start your private balance.' : 'Checking your ' + kind.toLowerCase() + ' balance…'}</p>{(kind === 'Public' || state.privacy.status === 'loading') && <div className="wallet-skeleton mt-3" />}</div> :
              <ul className="divide-y divide-[var(--app-border)]">{rows.map(row => <li key={row.token.address} className="py-3 flex items-center justify-between gap-3 text-sm"><div><strong>{row.token.symbol}</strong><p className="text-xs text-zinc-500 mt-1">{row.token.name}</p></div><span className="font-mono text-right">{row.available ? formatTokenAmount(row.balance, row.token.decimals, 6) : 'Unavailable'}</span></li>)}</ul>}
            {kind === 'Private' && <div className="flex flex-wrap gap-4 text-xs mt-4"><Link className="underline" href="/send?mode=private">Send privately</Link><Link className="underline" href="/swap?mode=private">Private swap</Link></div>}
          </div>;
        })}</div>
        {state.privacy.syncing && <p className="text-xs text-zinc-500 mt-3" role="status">Private balances are catching up with the network. Recent shields may take a moment to appear.</p>}
      </section>

      <Link href="/cross-chain" className="product-card p-5 flex items-center justify-between gap-4"><div><h2 className="font-semibold">Send beyond Starknet</h2><p className="text-sm text-zinc-500 mt-1">Private STRK to Base or Solana. Choose your asset and review a live route.</p></div><Globe className="w-6 h-6 shrink-0" /></Link>
      <section className="product-card-flat p-5 sm:p-6"><div className="flex items-center justify-between gap-3 mb-2"><h2 className="text-sm font-semibold">Recent activity</h2><Link href="/activity" className="flex items-center gap-1 text-sm text-[var(--app-accent)]">View all <ChevronRight className="w-4 h-4" /></Link></div><WalletActivity limit={5} /></section>
      <details className="product-card-flat p-5"><summary className="text-sm font-medium">Account details & advanced tools</summary>
        <dl className="space-y-2 text-sm mt-4"><div className="wallet-review-row"><dt>Address</dt><dd>{account.address}</dd></div><div className="wallet-review-row"><dt>Account type</dt><dd>{account.accountType}</dd></div><div className="wallet-review-row"><dt>Network</dt><dd>{networkLabel(state.network)}</dd></div></dl>
        <p className="text-xs text-zinc-500 mt-4">{state.privacy.maturity === 'waiting' ? 'Waiting for network confirmations before privacy is ready.' : state.privacy.registered ? 'Privacy is ready.' : 'Your first shield sets up private receiving automatically.'}</p>
        <Link href="/settings" className="text-sm underline inline-block mt-4">Manage account and privacy settings</Link>
        {state.privacy.available && state.network === 'sepolia' && <details className="mt-5"><summary className="text-sm">Developer tools · private execution</summary><div className="mt-4"><WalletCorePrivateExecute /></div></details>}
      </details>
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-zinc-500 flex gap-2 items-center"><Lock className="w-4 h-4" />Your keys stay on this device</span><Link href="/settings" className="wallet-secondary-button">Manage wallet</Link></div>
    </>}
  </div></AppShell>;
}
