'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import type { Call } from 'starknet';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { PrivateSwapPanel } from '@/components/wallet/PrivateSwapPanel';
import { TransactionReview, TransactionStatus, WalletError, walletField } from '@/components/wallet/TransactionFeedback';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { getSwapQuote, buildPublicSwapCalls, type SwapQuoteResult } from '@/services/swapService';
import { getNetworkConfig } from '@/config/networks';
import { formatTokenAmount } from '@/utils/formatters';
import { networkLabel, validateWalletAmount } from '@/utils/walletUx';

function PublicSwap() {
  const { runtime, state } = useWalletRuntime();
  const tokens = getNetworkConfig(state.network).tokens;
  const [sellSymbol, setSellSymbol] = useState(tokens[0].symbol);
  const [buySymbol, setBuySymbol] = useState(tokens[1].symbol);
  const sell = tokens.find(t => t.symbol === sellSymbol) ?? tokens[0];
  const buy = tokens.find(t => t.symbol === buySymbol) ?? tokens[1];
  const [amount, setAmount] = useState('');
  const [quoted, setQuoted] = useState<{ key: string; at: number; value: SwapQuoteResult; calls: Call[]; fee: bigint } | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);
  const flight = useRef(false);
  const row = state.publicBalances.find(r => r.token.address === sell.address);
  const balance = row?.available ? row.balance : null;
  const parsed = validateWalletAmount(amount, sell.decimals, balance);
  const key = [state.account?.walletId, state.network, sell.address, buy.address, amount].join('|');
  const current = useRef(key); current.current = key;
  const quote = quoted?.key === key ? quoted.value : null;
  const tx = state.recentTransactions.find(t => t.hash === hash);
  const pending = !!hash && (!tx || tx.status === 'pending');
  const valid = !parsed.error && sell.address !== buy.address && state.deploymentStatus === 'deployed';
  const minimum = quote ? quote.quote.buyAmount * 9900n / 10000n : null;

  async function readQuote() {
    if (!valid || !state.account || quoting) return;
    setQuoting(true); setQuoted(null); setError(null); setReview(false);
    try {
      const at = Date.now();
      const value = await getSwapQuote(state.network, sell, buy, amount, state.account.address);
      if (key !== current.current) return;
      if (!value) { setError('No route is available for this pair. Try another asset or amount.'); return; }
      const calls = await buildPublicSwapCalls(state.network, value.quote, 0.01, state.account.address);
      if (key !== current.current) return;
      const fee = await runtime.estimateFee(calls);
      if (key !== current.current) return;
      const gasBalance = state.publicBalances.find(r => r.token.symbol === 'STRK');
      if (!gasBalance?.available) throw new Error('STRK fee balance is unavailable. Refresh your balance.');
      if (gasBalance.balance < fee + (sell.symbol === 'STRK' ? parsed.units : 0n)) throw new Error('Insufficient STRK for amount and network fee.');
      if (Date.now() - at > 30_000) throw new Error('Quote expired. Get a fresh quote.');
      setQuoted({ key, value, at, calls, fee });
    } catch (err) { if (key === current.current) setError(err); }
    finally { setQuoting(false); }
  }

  async function confirm() {
    if (!valid || !state.account || !quote || !quoted || flight.current) return;
    if (Date.now() - quoted.at > 30_000) { setError('Quote expired. Get a fresh quote.'); setReview(false); setQuoted(null); return; }
    flight.current = true; setBusy(true); setError(null);
    try {
      if (key !== current.current || runtime.getState().account?.walletId !== state.account.walletId || runtime.getState().network !== state.network) return;
      if (Date.now() - quoted.at > 30_000) throw new Error('Quote expired. Review again.');
      const result = await runtime.send(quoted.calls, { kind: 'swap', symbol: sell.symbol, amount: parsed.units.toString() });
      if (key === current.current) { setHash(result.transactionHash); setReview(false); setQuoted(null); }
    } catch (err) { if (key === current.current) { setError(err); setReview(false); setQuoted(null); } }
    finally { flight.current = false; setBusy(false); }
  }

  return <section className="product-swap-card rounded-2xl space-y-5">
    <div><h2 className="text-lg font-semibold">Swap from public balance</h2><p className="text-sm text-zinc-500 mt-1">Exchange tokens on {networkLabel(state.network)}. Public swaps are visible on-chain.</p></div>
    <WalletError error={error} />
    {hash && <TransactionStatus phase={tx?.status ?? 'pending'} hash={hash} network={state.network} />}
    {review && quote && quoted && minimum !== null ? <TransactionReview title="Review swap" rows={[
      { label: 'You send', value: amount + ' ' + sell.symbol }, { label: 'You receive', value: '≈ ' + quote.buyAmount + ' ' + buy.symbol },
      { label: 'Minimum received', value: formatTokenAmount(minimum, buy.decimals, 8) + ' ' + buy.symbol },
      { label: 'Network', value: networkLabel(state.network) }, { label: 'Slippage', value: '1%' },
      { label: 'Estimated network fee', value: formatTokenAmount(quoted.fee, 18, 8) + ' STRK' },
      { label: 'Estimated total', value: sell.symbol === 'STRK' ? formatTokenAmount(parsed.units + quoted.fee, 18, 8) + ' STRK' : amount + ' ' + sell.symbol + ' + ' + formatTokenAmount(quoted.fee, 18, 8) + ' STRK' },
      { label: 'Route', value: quote.routes.join(' → ') },
    ]} note="Quotes expire after 30 seconds. The confirmed route is used with a 1% minimum-output protection. Keep STRK in your public balance for fees." onBack={() => setReview(false)} onConfirm={() => void confirm()} busy={busy} disabled={!valid || pending} confirmLabel="Confirm swap" /> : <>
      <fieldset className="space-y-4 min-w-0" disabled={busy || quoting || pending}>
        <label className="block text-sm">You pay<input className={walletField + ' mt-2 !text-2xl'} aria-label="Swap amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label className="block text-sm">From asset<select className={walletField + ' mt-2'} value={sell.symbol} onChange={e => setSellSymbol(e.target.value)}>{tokens.map(t => <option key={t.address} value={t.symbol}>{t.symbol} · {t.name}</option>)}</select></label>
        <p className="text-xs text-zinc-500">Available: {balance === null ? 'Checking balance…' : formatTokenAmount(balance, sell.decimals, 8) + ' ' + sell.symbol}</p>
        <div className="flex justify-center"><button className="wallet-secondary-button" aria-label="Switch swap assets" onClick={() => { setSellSymbol(buySymbol); setBuySymbol(sellSymbol); }}><ArrowDown className="w-4 h-4" /></button></div>
        <label className="block text-sm">To asset<select className={walletField + ' mt-2'} value={buy.symbol} onChange={e => setBuySymbol(e.target.value)}>{tokens.map(t => <option key={t.address} value={t.symbol}>{t.symbol} · {t.name}</option>)}</select></label>
        <div><span className="text-xs text-zinc-500">You receive</span><p className="text-2xl mt-1">{quote ? '≈ ' + quote.buyAmount : '—'} <span className="text-sm">{buy.symbol}</span></p></div>
        {amount && parsed.error && <p className="text-xs" role="status">{parsed.error}</p>}
        {sell.address === buy.address && <p className="text-xs">Choose two different assets.</p>}
      </fieldset>
      {state.deploymentStatus !== 'deployed' && <p className="text-sm">Activate your account from Wallet before swapping.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <button className="wallet-secondary-button" disabled={!valid || busy || quoting || pending} onClick={() => void readQuote()}>{quoting && <Loader2 className="w-4 h-4 animate-spin" />}{quoting ? 'Getting best route…' : quote ? 'Refresh quote' : 'Get quote'}</button>
        <button className="product-primary-button disabled:opacity-50" disabled={!quote || !valid || busy || quoting || pending} onClick={() => setReview(true)}>Review swap</button>
      </div>
    </>}
  </section>;
}

function SwapContent() {
  const params = useSearchParams();
  const { state } = useWalletRuntime();
  const [mode, setMode] = useState(params.get('mode') === 'private' ? 'private' : 'public');
  const requestedMode = params.get('mode');
  useEffect(() => { setMode(requestedMode === 'private' ? 'private' : 'public'); }, [requestedMode]);
  return <div className="product-page wallet-flow-page">
    <div className="product-page-intro"><div><div className="product-eyebrow">ORRANGE / SWAP</div><h1 className="product-page-title">Swap</h1><p className="product-page-description">Choose the balance you want to swap from.</p></div></div>
    {!state.account ? <WalletCoreGate /> : <>
      <div className="wallet-tabs" role="group" aria-label="Swap balance">{['public', 'private'].map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'public' ? 'Public' : 'Private'}</button>)}</div>
      {mode === 'public' ? <PublicSwap /> : <PrivateSwapPanel />}
    </>}
  </div>;
}

export default function SwapPage() {
  return <AppShell><Suspense fallback={<p role="status">Preparing swap…</p>}><SwapContent /></Suspense></AppShell>;
}
