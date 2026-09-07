'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { buildPublicTransferCall, normalizeTransferRecipient } from '@/wallet/publicTransfer';
import { getNetworkConfig } from '@/config/networks';
import { formatTokenAmount } from '@/utils/formatters';
import { networkLabel, validateWalletAmount } from '@/utils/walletUx';
import { TransactionReview, TransactionStatus, WalletError, walletField } from './TransactionFeedback';

export function WalletCoreSend() {
  const { runtime, state } = useWalletRuntime();
  const tokens = getNetworkConfig(state.network).tokens;
  const [symbol, setSymbol] = useState('STRK');
  const token = tokens.find(t => t.symbol === symbol) ?? tokens[0];
  const row = state.publicBalances.find(r => r.token.address === token.address);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [review, setReview] = useState<{ key: string; fee: bigint } | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const inFlight = useRef(false);
  const balance = row?.available ? row.balance : null;
  const parsed = validateWalletAmount(amount, token.decimals, balance);
  let addressError = '';
  try { normalizeTransferRecipient(recipient.trim()); } catch { addressError = 'Enter a valid Starknet recipient address.'; }
  const key = [state.account?.walletId, state.network, token.address, recipient, amount].join('|');
  const current = useRef(key); current.current = key;
  const tx = state.recentTransactions.find(t => t.hash === hash);
  const pending = !!hash && (!tx || tx.status === 'pending');
  const valid = !parsed.error && !addressError && state.deploymentStatus === 'deployed';
  const currentReview = review?.key === key ? review : null;

  async function prepare() {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const fee = await runtime.estimateFee(buildPublicTransferCall(token.address, recipient.trim(), parsed.units));
      if (key !== current.current) return;
      const gas = state.publicBalances.find(r => r.token.symbol === 'STRK');
      if (!gas?.available || gas.balance < fee + (token.symbol === 'STRK' ? parsed.units : 0n)) throw new Error('Insufficient STRK for the amount and estimated fee.');
      setReview({ key, fee });
    } catch (err) { if (key === current.current) setError(err); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function confirm() {
    if (!valid || !currentReview || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await runtime.send(buildPublicTransferCall(token.address, recipient.trim(), parsed.units), {
        kind: 'public', amount: parsed.units.toString(), symbol: token.symbol, recipient: recipient.trim(),
      });
      if (key === current.current) { setHash(result.transactionHash); setReview(null); }
    } catch (err) { if (key === current.current) { setError(err); setReview(null); } }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="product-card p-5 sm:p-6 space-y-5">
    <div><h2 className="text-lg font-semibold">Send from public balance</h2><p className="text-sm text-zinc-500 mt-1">Send tokens on {networkLabel(state.network)}. This transfer is visible on-chain.</p></div>
    <WalletError error={error} />
    {hash && <TransactionStatus phase={tx?.status ?? 'pending'} hash={hash} network={state.network} />}
    {currentReview ? <TransactionReview title={'Send ' + amount + ' ' + token.symbol} rows={[
      { label: 'From', value: state.account?.address ?? '' }, { label: 'Recipient', value: recipient.trim() },
      { label: 'Network', value: networkLabel(state.network) }, { label: 'Amount', value: amount + ' ' + token.symbol },
      { label: 'Estimated fee', value: formatTokenAmount(currentReview.fee, 18, 8) + ' STRK' },
      { label: 'Estimated total', value: token.symbol === 'STRK' ? formatTokenAmount(parsed.units + currentReview.fee, 18, 8) + ' STRK' : amount + ' ' + token.symbol + ' + ' + formatTokenAmount(currentReview.fee, 18, 8) + ' STRK' },
    ]} note="Network fees can change. Check the full recipient address; transfers cannot be reversed." onBack={() => setReview(null)} onConfirm={() => void confirm()} busy={busy} disabled={!valid} confirmLabel="Confirm send" /> : <>
      <fieldset disabled={busy || pending} className="min-w-0 space-y-4">
        <label className="block text-sm">Asset<select className={walletField + ' mt-2'} value={token.symbol} onChange={e => setSymbol(e.target.value)}>{tokens.map(t => <option key={t.address} value={t.symbol}>{t.symbol} · {t.name}</option>)}</select></label>
        <label className="block text-sm">Recipient address<input className={walletField + ' mt-2 font-mono'} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} aria-invalid={!!recipient && !!addressError} /></label>
        {recipient && addressError && <p role="status" className="text-xs text-[var(--app-accent)]">{addressError}</p>}
        <label className="block text-sm">Amount<input className={walletField + ' mt-2 !text-2xl'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" aria-invalid={!!amount && !!parsed.error} /></label>
        <p className="text-xs text-zinc-500">Available: {balance === null ? 'Checking balance…' : formatTokenAmount(balance, token.decimals, 8) + ' ' + token.symbol}. Keep STRK for network fees.</p>
        {amount && parsed.error && <p role="status" className="text-xs">{parsed.error}</p>}
      </fieldset>
      {state.deploymentStatus !== 'deployed' && <p className="text-sm">Activate your account from <Link className="underline" href="/wallet">Wallet</Link> before sending.</p>}
      <button className="product-primary-button w-full disabled:opacity-50" disabled={!valid || busy || pending} onClick={() => void prepare()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? 'Estimating network fee…' : pending ? 'Transaction in progress' : 'Review send'}</button>
    </>}
  </section>;
}
