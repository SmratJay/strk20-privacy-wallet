'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Repeat } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { PRIVATE_SWAP_APPS, type PrivateSwapQuote } from '@/features/private-swap';
import { formatTokenAmount } from '@/utils/formatters';
import { networkLabel, validateWalletAmount, walletOperationPending } from '@/utils/walletUx';
import { TransactionReview, TransactionStatus, WalletError, walletField } from './TransactionFeedback';

export function PrivateSwapPanel() {
  const { runtime, state } = useWalletRuntime();
  const app = PRIVATE_SWAP_APPS.find(a => a.network === state.network);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100);
  const [quoted, setQuoted] = useState<{ key: string; value: PrivateSwapQuote; at: number } | null>(null);
  const [review, setReview] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const request = useRef(0);
  const row = state.privateBalances.find(r => r.token.address === app?.sellToken.address);
  const balance = row?.available ? row.balance : null;
  const parsed = validateWalletAmount(amount, app?.sellToken.decimals ?? 18, balance);
  const key = [state.account?.walletId, state.network, app?.id, amount, slippageBps].join('|');
  const current = useRef(key); current.current = key;
  const quote = quoted?.key === key ? quoted.value : null;
  const pending = walletOperationPending(state);
  const intent = app ? { action: 'private.swap' as const, sellToken: app.sellToken.address, buyToken: app.buyToken.address,
    sellAmount: parsed.units, slippageBps, appName: 'orrange', nonce: 0n } : null;

  async function getQuote() {
    if (!intent || parsed.error || quoting) return;
    const id = ++request.current;
    setQuoting(true); setError(null); setQuoted(null); setReview(false);
    try {
      const value = await runtime.quotePrivateSwap(intent);
      if (key === current.current && id === request.current) setQuoted({ key, value, at: Date.now() });
    } catch (err) { if (key === current.current) setError(err); }
    finally { setQuoting(false); }
  }

  async function confirm() {
    if (!intent || !quote || parsed.error || inFlight.current || pending) return;
    if (!quoted || Date.now() - quoted.at > 30_000) { setError('Quote expired. Get a fresh quote.'); setReview(false); setQuoted(null); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const identity = runtime.listPrivateIdentities().find(i => i.appName === 'orrange' && i.nonce === '0' && i.status === 'active');
      if (!identity) await runtime.createShadowIdentity('orrange', 0n);
      if (key !== current.current || runtime.getState().account?.walletId !== state.account?.walletId || runtime.getState().network !== state.network) return;
      await runtime.executePrivateSwap(intent, quote);
      if (key === current.current) { setReview(false); setQuoted(null); }
      void runtime.refreshPrivateBalances();
    } catch (err) { if (key === current.current) { setError(err); setReview(false); setQuoted(null); } }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!state.privacy.available || !app) return <section className="product-card p-6 space-y-3">
    <Repeat className="w-6 h-6 text-[var(--app-accent)]" /><h2 className="text-lg font-semibold">Private swap isn’t available here yet</h2>
    <p className="text-sm text-zinc-500">{!app ? 'There is no private swap market configured on ' + networkLabel(state.network) + '. Your funds have not moved.' : 'Privacy services are not ready on this network. Your funds have not moved.'}</p>
    <Link href="/settings" className="text-sm underline">Check network and privacy settings</Link>
  </section>;

  const fmt = (value: bigint, decimals: number) => formatTokenAmount(value, decimals, 8);
  const fee = quote?.feeStrk;
  const valid = !parsed.error && state.deploymentStatus === 'deployed' && state.privacy.maturity !== 'waiting';
  const insufficientFee = balance !== null && fee != null && parsed.units + fee > balance;

  return <section className="product-card p-5 sm:p-6 space-y-5">
    <div><h2 className="text-lg font-semibold">Swap from private balance</h2><p className="text-sm text-zinc-500 mt-1">Swap {app.sellToken.symbol} for {app.buyToken.symbol}. The output returns to your private balance.</p></div>
    <TransactionStatus phase={state.swapOp.phase} hash={state.swapOp.transactionHash} network={state.network} message={state.swapOp.message} />
    <WalletError error={error} />
    {review && quote ? <TransactionReview title="Review private swap" rows={[
      { label: 'You send', value: amount + ' ' + app.sellToken.symbol },
      { label: 'You receive', value: '≈ ' + fmt(quote.buyAmount, app.buyToken.decimals) + ' ' + app.buyToken.symbol },
      { label: 'Minimum received', value: fmt(quote.minOutput, app.buyToken.decimals) + ' ' + app.buyToken.symbol },
      { label: 'From / To', value: 'Your private balance' }, { label: 'Network', value: networkLabel(state.network) },
      { label: 'Slippage', value: slippageBps / 100 + '%' },
      { label: 'Execution fee', value: fee == null ? 'Unavailable · checked before submission' : fmt(fee, 18) + ' STRK' },
      { label: 'Total', value: fee == null ? amount + ' STRK + applicable fee' : fmt(parsed.units + fee, 18) + ' STRK' },
    ]} note="Your Private Account is prepared automatically. It keeps the public link to your wallet hidden; the swap action and amounts may still be public. Quotes are revalidated before execution." onBack={() => setReview(false)} onConfirm={() => void confirm()} busy={busy} disabled={!valid || pending || insufficientFee} confirmLabel="Confirm private swap" /> : <>
      <fieldset disabled={busy || pending || quoting} className="space-y-4 min-w-0">
        <label className="block text-sm">From<input className={walletField + ' mt-2 !text-2xl'} aria-label={'Amount in ' + app.sellToken.symbol} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
        <p className="text-xs text-zinc-500">{app.sellToken.symbol} · Available: {balance === null ? 'Unavailable' : fmt(balance, app.sellToken.decimals)}</p>
        <div className="rounded-xl border border-[var(--app-border)] p-4"><span className="text-xs text-zinc-500">To · Private balance</span><p className="text-2xl mt-1">{quote ? '≈ ' + fmt(quote.buyAmount, app.buyToken.decimals) : '—'} <span className="text-sm">{app.buyToken.symbol}</span></p></div>
        <label className="block text-sm">Slippage<select className={walletField + ' mt-2'} value={slippageBps} onChange={e => setSlippageBps(Number(e.target.value))}>{[50,100,200,500].map(b => <option key={b} value={b}>{b / 100}%</option>)}</select></label>
        {amount && parsed.error && <p className="text-xs" role="status">{parsed.error}</p>}
      </fieldset>
      {!valid && !parsed.error && <p className="text-sm">Activate your wallet and wait for privacy confirmations before continuing.</p>}
      {insufficientFee && <p className="text-sm">Leave extra private STRK to cover the execution fee.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <button className="wallet-secondary-button" disabled={!valid || busy || pending || quoting} onClick={() => void getQuote()}>{quoting && <Loader2 className="w-4 h-4 animate-spin" />}{quoting ? 'Getting best route…' : quote ? 'Refresh quote' : 'Get quote'}</button>
        <button className="product-primary-button disabled:opacity-50" disabled={!quote || !valid || busy || pending || quoting || insufficientFee} onClick={() => setReview(true)}>Review swap</button>
      </div>
    </>}
    <details className="text-xs text-zinc-500"><summary>How private swaps work</summary><p className="mt-2 leading-relaxed">Your Private Account executes the swap through STRK20. No public-wallet fallback is used. The selected market is {app.name}; only its supported token pair is available.</p></details>
  </section>;
}
