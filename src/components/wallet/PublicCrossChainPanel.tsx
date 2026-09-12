'use client';

import { useEffect, useRef, useState } from 'react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { TransactionReview, WalletError, walletField } from './TransactionFeedback';
import type { NearIntentRoute } from '@/features/near-intents/routes';
import type { PublicCrossQuote, PublicCrossReceipt } from '@/features/public-cross-chain/service';
import { formatTokenAmount } from '@/utils/formatters';
import { validateWalletAmount, walletOperationPending } from '@/utils/walletUx';

export function PublicCrossChainPanel() {
  const { runtime, state } = useWalletRuntime();
  const [routes, setRoutes] = useState<NearIntentRoute[]>([]);
  const [routeId, setRouteId] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [quote, setQuote] = useState<PublicCrossQuote | null>(null);
  const [receipt, setReceipt] = useState<PublicCrossReceipt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const mounted = useRef(true);
  const mainnet = state.network === 'mainnet';
  const pending = walletOperationPending(state);
  const parsed = validateWalletAmount(amount, 18, null);
  const unresolved = receipt && !['success', 'refunded'].includes(receipt.phase);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    runtime.getCrossChainRoutes().then(rows => {
      if (!cancelled) { setRoutes(rows); setRouteId(rows[0]?.id ?? ''); }
    }).catch(e => { if (!cancelled) setError(e); });
    try { setReceipt(runtime.getPublicCrossChainService().readReceipt()); } catch (e) { setError(e); }
    return () => { cancelled = true; mounted.current = false; };
  }, [runtime]);
  async function action(work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true; setBusy(true); setError(null);
    try { await work(); } catch (e) { if (mounted.current) setError(e); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    const value = await runtime.getPublicCrossChainService().refresh();
    if (mounted.current) setReceipt(value);
  }
  useEffect(() => {
    if (!unresolved || !mainnet) return;
    const timer = setInterval(() => { if (!flight.current) void action(refresh); }, 15000);
    return () => clearInterval(timer);
  // The journal is authoritative; polling never submits a transaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!unresolved, mainnet]);
  const fmt = (value: string, decimals = 18) => formatTokenAmount(BigInt(value), decimals, 8);
  return <section className="product-swap-card rounded-2xl space-y-5">
    <div><h2 className="text-lg font-semibold">Swap across chains</h2>
      <p className="text-sm text-zinc-500 mt-2">Public STRK on Starknet → Base or Solana, powered by NEAR Intents. Your wallet, deposit and destination are visible on-chain. This does not use your private balance.</p></div>
    <WalletError error={error} />
    {!mainnet && <p role="status">Switch to Starknet Mainnet in Settings to use cross-chain swaps. Sepolia funds have no Mainnet value.</p>}
    {receipt && <div className="rounded-xl border border-zinc-700 p-4 space-y-2 break-all" role="status">
      <strong>{receipt.phase === 'success' ? 'Delivery reported' : receipt.phase === 'refunded' ? 'Refund reported' : 'Cross-chain receipt'}</strong>
      <p>{receipt.message}</p>
      <p className="text-xs">Deposit: {receipt.quote.depositAddress}</p>
      <p className="text-xs">Destination: {receipt.quote.recipient} · {receipt.quote.route.destinationChain}</p>
      {receipt.transactionHash && <p className="text-xs">Starknet transaction: {receipt.transactionHash}</p>}
      {receipt.destinationTxHashes.map(hash => <p key={hash} className="text-xs">Destination transaction: {hash}</p>)}
      {receipt.refundedAmount && <p>Refund: {fmt(receipt.refundedAmount)} STRK</p>}
      <button className="wallet-secondary-button" disabled={busy || !mainnet} onClick={() => void action(refresh)}>Check settlement status</button>
    </div>}
    {quote?.depositAddress ? <TransactionReview title="Review public cross-chain swap" rows={[
      { label: 'You send', value: fmt(quote.amount) + ' STRK on Starknet Mainnet' },
      { label: 'Expected receive', value: fmt(quote.amountOut, quote.route.destinationToken.decimals) + ' ' + quote.route.destinationToken.symbol },
      { label: 'Minimum received', value: fmt(quote.minAmountOut, quote.route.destinationToken.decimals) + ' ' + quote.route.destinationToken.symbol },
      { label: 'Destination network', value: quote.route.destinationChain },
      { label: 'Recipient', value: quote.recipient },
      { label: 'Refund wallet', value: quote.refundTo },
      { label: 'Estimated network fee (buffered)', value: fmt(quote.networkFee!) + ' STRK' },
      { label: 'Provider refund fee', value: quote.refundFee ? fmt(quote.refundFee) + ' STRK' : 'Not provided' },
      { label: 'Slippage', value: '1%' },
    ]} note="Public transfer. Provider fees are reflected in the output quote; a failed route may incur refund fees. Review expires within 60 seconds. Delivery timing is an estimate, not a guarantee."
      busy={busy} disabled={!mainnet || !!unresolved || pending} onBack={() => setQuote(null)}
      confirmLabel="Confirm public cross-chain swap"
      onConfirm={() => void action(async () => {
        const service = runtime.getPublicCrossChainService();
        try { await service.execute(quote.id); }
        finally { if (mounted.current) { setReceipt(service.readReceipt()); setQuote(null); } }
      })} /> : <fieldset disabled={busy || !!unresolved || !mainnet || pending} className="space-y-4">
      <label className="block text-sm">STRK amount<input className={walletField} inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setQuote(null); }} /></label>
      <label className="block text-sm">Receive asset<select className={walletField} value={routeId} onChange={e => { setRouteId(e.target.value); setQuote(null); }}>
        {routes.map(r => <option key={r.id} value={r.id}>{r.destinationToken.symbol} · {r.destinationChain} · {r.destinationToken.address ?? r.destinationAssetId}</option>)}
      </select></label>
      <label className="block text-sm">Destination wallet address<input className={walletField} value={recipient} onChange={e => { setRecipient(e.target.value.trim()); setQuote(null); }} autoComplete="off" /></label>
      {quote && <p>Estimated receive: {fmt(quote.amountOut, quote.route.destinationToken.decimals)} {quote.route.destinationToken.symbol}</p>}
      <button className="wallet-secondary-button" disabled={!parsed.units || !!parsed.error || !recipient || !routeId} onClick={() => void action(async () => {
        const q = await runtime.getPublicCrossChainService().quote({ routeId, amount: parsed.units, recipient, slippageBps: 100 });
        if (mounted.current) setQuote(q);
      })}>{busy ? 'Checking route…' : 'Get quote'}</button>
      {quote && <button className="product-primary-button" onClick={() => void action(async () => {
        const q = await runtime.getPublicCrossChainService().prepare(quote.id);
        if (mounted.current) setQuote(q);
      })}>Review swap and fees</button>}
    </fieldset>}
  </section>;
}
