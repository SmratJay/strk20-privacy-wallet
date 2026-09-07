'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy, Loader2, Lock, RefreshCw } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { copyToClipboard, formatTokenAmount } from '@/utils/formatters';
import { crossChainConfigFor, type NearIntentOpState } from '@/features/near-intents';
import type { NearIntentRoute } from '@/features/near-intents/routes';
import { validateChainAddress } from '@/features/near-intents/address';
import type { PrivacyHubIntent, PrivacyHubQuote } from '@/features/privacy-hub';
import { TransactionReview, WalletError } from './TransactionFeedback';
import { networkLabel, transactionUrl, walletOperationPending } from '@/utils/walletUx';

const LABELS: Record<NearIntentOpState['phase'], string> = {
  idle: 'Ready', quoting: 'Getting best route…', preparing: 'Preparing your transfer…', 'intent-created': 'Route reserved',
  'awaiting-source-deposit': 'Preparing private deposit', 'source-confirming': 'Awaiting deposit confirmation',
  'solver-executing': 'Processing destination transfer…', 'destination-pending': 'Waiting for destination confirmation…', success: 'Funds delivered',
  failed: 'Transfer not completed', refunded: 'Refund recovery required', expired: 'Quote expired',
  unknown: 'Settlement unconfirmed — check status before retrying',
};
const TERMINAL = ['idle', 'success', 'failed', 'refunded', 'expired'];
const field = 'w-full min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] disabled:opacity-50';
const fmt = (amount: bigint, decimals: number) => formatTokenAmount(amount, decimals, Math.min(decimals, 8));

/** Presentation only: all quote/prepare/fund/status work enters WalletRuntime → PrivacyHub. */
export function PrivateCrossChainPanel() {
  const { runtime, state } = useWalletRuntime();
  const [routes, setRoutes] = useState<NearIntentRoute[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);
  const [chain, setChain] = useState<'base' | 'solana'>('base');
  const [routeId, setRouteId] = useState('');
  const [search, setSearch] = useState('');
  const [robinhood, setRobinhood] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100);
  const [quoted, setQuoted] = useState<{ key: string; intent: PrivacyHubIntent; value: PrivacyHubQuote } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setRegistryLoading(true); setRegistryError(null);
    void runtime.getCrossChainRoutes(registryVersion > 0).then(next => {
      if (!cancelled) { setRoutes(next); setRouteId(current => next.some(r => r.id === current) ? current : ''); }
    }).catch(err => {
      if (!cancelled) { setRoutes([]); setRegistryError(err instanceof Error ? err.message : 'Destination registry unavailable.'); }
    }).finally(() => { if (!cancelled) setRegistryLoading(false); });
    return () => { cancelled = true; };
  }, [runtime, registryVersion]);

  const chainRoutes = routes.filter(r => r.destinationChain === chain);
  const route = chainRoutes.find(r => r.id === routeId) ?? chainRoutes[0];
  const visibleRoutes = chainRoutes.filter(r => !search || (r.destinationToken.symbol + ' ' + (r.destinationToken.address ?? '') + ' ' + r.destinationAssetId).toLowerCase().includes(search.toLowerCase()));
  const op = state.nearIntentOp;
  const pending = !TERMINAL.includes(op.phase);
  const disabled = busy || pending || walletOperationPending(state);
  const config = crossChainConfigFor(state.network);
  const balanceRow = state.privateBalances.find(row => row.token.symbol === 'STRK');
  const balance = balanceRow?.available ? balanceRow.balance : null;
  const addressError = validateChainAddress(destination.trim(), chain === 'solana' ? 'solana' : 'evm');
  let units = 0n;
  let amountError = '';
  try { units = parseAmountToBase(amount, 18); if (units <= 0n) amountError = 'Enter an amount greater than zero.'; }
  catch { amountError = 'Enter a valid amount with up to 18 decimal places.'; }
  const key = [state.account?.walletId, state.network, route?.id, amount, destination.trim(), slippageBps].join('|');
  const currentKey = useRef(key);
  currentKey.current = key;
  const quote = quoted?.key === key ? quoted.value : null;
  const expires = quote ? Date.parse(quote.deadline) : 0;
  const fresh = !!quote && Number.isFinite(expires) && expires > now;
  const reviewing = reviewKey === key && !!quote;
  const canQuote = !!state.account && !!route && visibleRoutes.includes(route) && !registryLoading
    && units > 0n && !addressError && state.privacy.available && !disabled;
  const canSend = canQuote && fresh && config.settlementEnabled && state.deploymentStatus === 'deployed'
    && balance !== null && units <= balance && (!robinhood || acknowledged);

  useEffect(() => { generation.current++; setQuoting(false); setError(null); }, [key]);

  async function readQuote() {
    if (!canQuote || !route) return;
    const request = ++generation.current;
    const requestKey = key;
    const intent: PrivacyHubIntent = {
      sourceChain: route.sourceChain, sourceAsset: route.sourceAsset, sourceAmount: units,
      destinationChain: route.destinationChain, destinationAsset: route.destinationAsset,
      destinationAddress: destination.trim(), routeId: route.id, slippageBps, appName: 'orrange', nonce: 0n,
    };
    setQuoting(true); setError(null); setQuoted(null);
    try {
      const value = await runtime.quotePrivacyHub(intent);
      if (mounted.current && request === generation.current && requestKey === currentKey.current) setQuoted({ key: requestKey, intent, value });
    } catch (err) {
      if (mounted.current && request === generation.current) setError(err instanceof Error ? err.message : 'Could not read quote.');
    } finally { if (mounted.current && request === generation.current) setQuoting(false); }
  }

  async function send() {
    if (!canSend || !reviewing || inFlight.current || !quoted || quoted.key !== currentKey.current || Date.parse(quoted.value.deadline) <= Date.now()) return;
    inFlight.current = true;
    const requestKey = key;
    setBusy(true); setError(null);
    try {
      const identity = runtime.listPrivateIdentities().find(i => i.appName === 'orrange' && i.nonce === '0' && i.status === 'active');
      if (!identity) await runtime.createShadowIdentity('orrange', 0n);
      if (requestKey !== currentKey.current || !mounted.current) return;
      await runtime.executePrivacyHub(quoted.intent, quoted.value);
      if (mounted.current) { setReviewKey(null); setQuoted(null); }
      void runtime.refreshPrivateBalances();
    } catch (err) {
      if (mounted.current && requestKey === currentKey.current) setError(err instanceof Error ? err.message : 'Transfer could not be completed.');
    } finally { inFlight.current = false; if (mounted.current) { setBusy(false); setReviewKey(null); } }
  }

  async function checkStatus() {
    if (!op.depositAddress) return;
    setChecking(true); setError(null);
    try { await runtime.getPrivacyHubStatus(op.depositAddress); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Status unavailable. Do not send again.'); }
    finally { if (mounted.current) setChecking(false); }
  }

  async function copy(value: string, label: string) {
    if (await copyToClipboard(value)) setCopied(label);
    else setError('Could not copy. Select the address and copy it manually.');
  }

  function chooseChain(next: 'base' | 'solana', robinhoodPreset = false) {
    setChain(next); setRobinhood(robinhoodPreset); setAcknowledged(false);
    setDestination(''); setRouteId(''); setSearch(''); setQuoted(null);
  }

  return <section className="product-card p-5 sm:p-7" aria-labelledby="cross-chain-title">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div><div className="product-eyebrow">CROSS-CHAIN</div><h2 id="cross-chain-title" className="text-2xl font-semibold mt-2">Send to another chain</h2></div>
      <span className="text-xs rounded-full border border-[var(--app-border)] px-3 py-1.5">Starknet {state.network === 'mainnet' ? 'Mainnet' : 'Sepolia · test network'}</span>
    </div>
    <p className="text-sm text-[var(--app-text-secondary)] mb-5">Send from your private STRK balance to Base or Solana. Transfers on the destination chain are public.</p>
    {!config.settlementEnabled && <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 mb-5" role="status">
      <p className="text-sm font-semibold">Cross-chain transfers aren’t available on this network yet</p><p className="text-xs mt-1">Browse destinations below. Nothing will be sent until this network is ready.</p><details className="text-xs mt-2"><summary>Service details</summary>{config.reason}</details>
      <Link className="underline text-xs inline-block mt-2" href="/settings">Network & wallet settings</Link>
    </div>}
    {!state.privacy.available && <p className="text-sm mb-4">Private balance is unavailable on this network. You can still browse supported destinations.</p>}
    {state.account && state.deploymentStatus !== 'deployed' && <p className="text-sm mb-4">Fund your Starknet address first, then <Link className="underline" href="/wallet">deploy your account</Link>. This is required before private execution.</p>}

    <fieldset disabled={disabled || quoting} hidden={reviewing} className="min-w-0 space-y-4">
      <legend className="text-sm font-semibold mb-2">Choose destination</legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(['base', 'solana'] as const).map(next => <button type="button" key={next} onClick={() => chooseChain(next)} aria-pressed={chain === next && !robinhood} className={field + (chain === next && !robinhood ? ' !border-orange-500' : '')}>{next === 'base' ? 'Base' : 'Solana destination'}</button>)}
        <button type="button" onClick={() => chooseChain('solana', true)} aria-pressed={robinhood} className={field + ' col-span-2 sm:col-span-1' + (robinhood ? ' !border-orange-500' : '')}>Send to Robinhood</button>
      </div>
      {registryLoading ? <p className="text-sm flex gap-2 items-center" role="status"><Loader2 className="w-4 h-4 animate-spin" /> Loading supported assets…</p> : registryError ? <div className="text-sm"><WalletError error={registryError} /><button type="button" className="underline mt-2" onClick={() => setRegistryVersion(v => v + 1)}>Retry destination registry</button></div> : chainRoutes.length === 0 ? <p className="text-sm">No destinations currently confirmed for this chain.</p> : <>
        {chain === 'solana' && <label className="block text-xs">Find an asset<input className={field + ' mt-1'} placeholder="Search ticker or mint address" value={search} onChange={e => setSearch(e.target.value)} /></label>}
        <label className="block text-xs">Destination asset
          <select className={field + ' mt-1'} value={route?.id ?? ''} onChange={e => { setRouteId(e.target.value); setAcknowledged(false); }}>
            {route && !visibleRoutes.includes(route) && <option value={route.id}>{route.destinationToken.symbol} (selected)</option>}
            {visibleRoutes.map(r => <option key={r.id} value={r.id}>{r.destinationToken.symbol}{r.destinationToken.address ? ' · ' + r.destinationToken.address.slice(0, 5) + '…' + r.destinationToken.address.slice(-4) : ' · Native'}</option>)}
          </select>
        </label>
        {search && !visibleRoutes.length && <p className="text-xs" role="status">Unavailable: no supported asset matches this search.</p>}
        {route && <details className="text-xs text-[var(--app-text-secondary)]"><summary className="cursor-pointer">Verify asset identity · {chainRoutes.length} supported destinations</summary><p className="break-all mt-2">{route.destinationToken.address ? 'Contract / mint: ' + route.destinationToken.address : 'Native asset'}<br />Registry ID: {route.destinationAssetId}</p></details>}
      </>}
      {robinhood && <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-4 text-sm">
        <strong>Use the exact Robinhood deposit address and asset/network shown by Robinhood.</strong>
        <p className="text-xs mt-2">NEAR route availability does not confirm Robinhood accepts that asset. This is a user-provided Solana destination, not a Robinhood API integration. We cannot verify address ownership.</p>
        <label className="flex gap-2 items-start mt-3"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 accent-orange-500" /> <span className="text-xs">I verified this asset and the Solana network in Robinhood.</span></label>
      </div>}
      <label className="block text-xs">{robinhood ? 'Robinhood deposit address (Solana)' : (chain === 'solana' ? 'Solana' : 'Base') + ' destination address'}
        <input autoComplete="off" autoCorrect="off" spellCheck={false} className={field + ' mt-1 font-mono'} placeholder={chain === 'solana' ? 'Paste your Solana deposit address' : '0x…'} value={destination} onChange={e => { setDestination(e.target.value); setAcknowledged(false); }} aria-invalid={!!destination && !!addressError} aria-describedby="destination-hint" />
      </label>
      <div id="destination-hint" className="text-xs text-[var(--app-text-secondary)]">{destination && addressError ? addressError : 'Check the address and network carefully. Transfers cannot be reversed.'}</div>
      <div className="flex gap-4 text-xs">
        <button type="button" className="underline" onClick={async () => { try { setDestination((await navigator.clipboard.readText()).trim()); setAcknowledged(false); } catch { setError('Clipboard access unavailable. Paste the address into the field.'); } }}>Paste address</button>
        <button type="button" className="underline disabled:opacity-50" disabled={!destination} onClick={() => void copy(destination, 'destination')}>{copied === 'destination' ? 'Copied' : 'Copy address'}</button>
      </div>
      <div className="grid sm:grid-cols-[1fr_140px] gap-3">
        <label className="block text-xs">You send · private STRK<input inputMode="decimal" className={field + ' mt-1 !text-xl'} value={amount} placeholder="0.00" onChange={e => setAmount(e.target.value)} /></label>
        <label className="block text-xs">Slippage<select className={field + ' mt-1'} value={slippageBps} onChange={e => setSlippageBps(Number(e.target.value))}>{[50, 100, 200, 500].map(bps => <option key={bps} value={bps}>{bps / 100}%</option>)}</select></label>
      </div>
      <p className="text-xs text-[var(--app-text-secondary)]">Private balance: {balance === null ? 'Unavailable' : fmt(balance, 18) + ' STRK'}. Allow extra STRK for the private relay fee, checked before submission.{balance !== null && units > balance ? ' Insufficient private STRK.' : ''}</p>
      {amount && amountError && <p role="status" className="text-xs text-[var(--app-accent)]">{amountError}</p>}
    </fieldset>

    {quote && route && <div className="rounded-xl border border-[var(--app-border)] p-4 mt-5 space-y-2 text-sm" aria-live="polite">
      <div className="flex justify-between gap-3"><strong>{fresh ? 'Quote received' : 'Quote expired'}</strong><span className="text-xs">{fresh ? 'Expires in ' + Math.max(0, Math.floor((expires - now) / 1000)) + 's' : 'Request a fresh quote'}</span></div>
      <p className="text-2xl font-semibold">{fmt(quote.amountOut, route.destinationToken.decimals)} {route.destinationToken.symbol}</p>
      <p className="text-xs">Estimated output · minimum {fmt(quote.minAmountOut, route.destinationToken.decimals)} {route.destinationToken.symbol}</p>
      <p className="text-xs break-words">{quote.route}{quote.timeEstimate > 0 ? ' · ~' + quote.timeEstimate + 's' : ''}</p>
      <p className="text-xs">Refund fee: {quote.refundFee === null ? 'Not provided' : fmt(quote.refundFee, 18) + ' STRK'} · Withdrawal fee: {quote.withdrawFee === null ? 'Not provided' : fmt(quote.withdrawFee, route.destinationToken.decimals) + ' ' + route.destinationToken.symbol}</p>
    </div>}
    <WalletError error={error} />
    {reviewing && route && quote ? <div className="mt-5"><TransactionReview title={'Send to ' + (chain === 'solana' ? 'Solana' : 'Base')} rows={[
      { label: 'You send', value: fmt(units, 18) + ' STRK' }, { label: 'From', value: 'Private balance · ' + networkLabel(state.network) },
      { label: 'You receive', value: '≈ ' + fmt(quote.amountOut, route.destinationToken.decimals) + ' ' + route.destinationToken.symbol },
      { label: 'Minimum received', value: fmt(quote.minAmountOut, route.destinationToken.decimals) + ' ' + route.destinationToken.symbol },
      { label: 'Destination network', value: chain === 'solana' ? 'Solana Mainnet' : 'Base Mainnet' },
      { label: 'Recipient', value: destination.trim() }, { label: 'Slippage', value: slippageBps / 100 + '%' },
      { label: 'Destination fee', value: quote.withdrawFee === null ? 'Not provided by route' : fmt(quote.withdrawFee, route.destinationToken.decimals) + ' ' + route.destinationToken.symbol },
      { label: 'Private execution fee', value: 'Checked before submission · keep extra STRK' },
    ]} note={fresh ? 'Verify the full destination address and asset. Your Private Account is prepared automatically. Destination funds are public; transfers cannot be reversed.' : 'This quote expired. Go back and get a fresh quote before confirming.'} onBack={() => setReviewKey(null)} onConfirm={() => void send()} busy={busy} disabled={!canSend || quoting} confirmLabel="Confirm cross-chain transfer" /></div> : <div className="grid sm:grid-cols-2 gap-3 mt-5">
      <button type="button" className={field + ' flex items-center justify-center gap-2'} disabled={!canQuote || quoting} onClick={() => void readQuote()}>{quoting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} {quoting ? 'Getting best route…' : quote ? 'Refresh quote' : 'Get live quote'}</button>
      <button type="button" className="product-primary-button px-4 disabled:opacity-40 disabled:cursor-not-allowed" disabled={!canSend || quoting} onClick={() => setReviewKey(key)}><Lock className="w-4 h-4" />{disabled ? 'Transfer in progress' : 'Review transfer'}</button>
    </div>}

    {op.phase !== 'idle' && <div className="border border-[var(--app-border)] rounded-xl p-4 mt-5 space-y-3">
      <p role="status" className="font-semibold text-sm flex items-center gap-2">{op.phase === 'success' ? <Check className="w-4 h-4" /> : pending && op.phase !== 'unknown' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{LABELS[op.phase]}</p>
      <ol className="grid grid-cols-3 gap-2 text-xs" aria-label="Transfer progress">{['Private deposit', 'Processing', 'Destination settlement'].map((label, index) => <li key={label} className="border-t-2 pt-2" style={{ borderColor: op.phase === 'success' || (index === 0 && !!op.transactionHash) || (index === 1 && ['solver-executing', 'destination-pending'].includes(op.phase)) ? 'var(--app-accent)' : 'var(--app-border)' }}>{index + 1}. {label}</li>)}</ol>
      {op.route && <p className="text-xs">{op.route}</p>}
      {op.shadowAddress && <details className="text-xs"><summary>Private Account / refund address</summary><p className="break-all mt-2">{op.shadowAddress}</p></details>}
      {op.destinationAddress && <p className="text-xs break-all">Destination: {op.destinationAddress}</p>}
      {op.depositAddress && <div className="text-xs break-all">Deposit reference: {op.depositAddress}<button type="button" className="inline-flex gap-1 items-center ml-2 underline" onClick={() => void copy(op.depositAddress!, 'deposit')}><Copy className="w-3 h-3" />{copied === 'deposit' ? 'Copied' : 'Copy'}</button></div>}
      {op.message && <details className="text-xs"><summary>Transfer details</summary><p className="break-words mt-2">{op.message}</p></details>}
      {op.phase === 'success' && op.amountOut !== null && op.destinationDecimals !== undefined && <p className="font-semibold">Received {fmt(op.amountOut, op.destinationDecimals)} {op.destinationSymbol}</p>}
      {op.refundedAmount !== null && op.refundedAmount > 0n && <p className="text-xs">Reported refund: {fmt(op.refundedAmount, 18)} STRK to the Shadow Account. {op.refundReason}</p>}
      <div className="flex flex-wrap gap-4 text-xs">
        {op.transactionHash && <a href={transactionUrl(state.network, op.transactionHash)} target="_blank" rel="noopener noreferrer" className="underline inline-flex gap-1">Source transaction <ArrowUpRight className="w-3 h-3" /></a>}
        <Link href="/activity" className="underline">View activity</Link>
        {op.destinationTxHashes.map((hash, index) => <a key={hash} href={(op.destinationChain === 'solana' ? 'https://solscan.io/tx/' : 'https://basescan.org/tx/') + encodeURIComponent(hash)} target="_blank" rel="noopener noreferrer" className="underline">Destination transaction {index + 1}</a>)}
        {op.depositAddress && <button type="button" disabled={checking || busy} className="underline disabled:opacity-50" onClick={() => void checkStatus()}>{checking ? 'Checking…' : 'Refresh settlement status'}</button>}
      </div>
      {pending && <p className="text-xs text-[var(--app-text-secondary)]">Keep this wallet open while the deposit is tracked. Save the deposit reference before leaving. Do not send a second deposit to resolve a delayed status.</p>}
    </div>}
    <details className="text-xs text-[var(--app-text-secondary)] mt-5 leading-relaxed"><summary>Privacy and route details</summary><p className="mt-2">STRK20 uses your Private Account to fund the NEAR Intents route, without your root wallet being the depositor. The deposit and destination settlement are public. Reusing a destination can link transfers.</p></details>
  </section>;
}
