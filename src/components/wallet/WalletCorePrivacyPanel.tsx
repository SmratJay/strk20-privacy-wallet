'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { getNetworkConfig } from '@/config/networks';
import { normalizeTransferRecipient } from '@/wallet/publicTransfer';
import { formatTokenAmount } from '@/utils/formatters';
import { networkLabel, validateWalletAmount, walletOperationPending } from '@/utils/walletUx';
import { TransactionReview, TransactionStatus, WalletError, walletField } from './TransactionFeedback';

type Op = 'TRANSFER' | 'SHIELD' | 'WITHDRAW';
const labels = { TRANSFER: 'Private send', SHIELD: 'Shield', WITHDRAW: 'Unshield' };

export function WalletCorePrivacyPanel({ initialOp = 'SHIELD' }: { initialOp?: Op }) {
  const { runtime, state } = useWalletRuntime();
  const token = getNetworkConfig(state.network).tokens.find(t => t.symbol === 'STRK')!;
  const [op, setOp] = useState(initialOp);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const row = (op === 'SHIELD' ? state.publicBalances : state.privateBalances).find(r => r.token.symbol === 'STRK');
  const balance = row?.available ? row.balance : null;
  const parsed = validateWalletAmount(amount, token.decimals, balance);
  let addressError = '';
  if (op === 'TRANSFER') { try { normalizeTransferRecipient(recipient.trim()); } catch { addressError = 'Enter a valid Starknet recipient address.'; } }
  const pending = walletOperationPending(state);
  const key = [state.account?.walletId, state.network, op, amount, recipient].join('|');
  const current = useRef(key); current.current = key;
  const valid = !parsed.error && !addressError && state.deploymentStatus === 'deployed' && state.privacy.maturity !== 'waiting';

  async function confirm() {
    if (!valid || review !== key || inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (op === 'SHIELD') await runtime.shield(token.address, parsed.units);
      else if (op === 'WITHDRAW') await runtime.withdraw(token.address, parsed.units);
      else await runtime.privateTransfer(token.address, parsed.units, recipient.trim());
      if (key === current.current) { setReview(null); setAmount(''); }
    } catch (err) { if (key === current.current) { setError(err); setReview(null); } }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="product-card p-5 sm:p-6 space-y-5">
    <div><h2 className="text-lg font-semibold">Your private balance</h2><p className="text-sm text-zinc-500 mt-1">Shield to move funds into your private balance. Unshield to bring them back.</p></div>
    {!state.privacy.available ? <><p className="text-sm">Privacy is unavailable on this network right now. Your public wallet is still available.</p><Link href="/settings" className="underline text-sm">Check privacy settings</Link><details className="text-xs"><summary>Service details</summary>{state.privacy.reason}</details></> : <>
      <TransactionStatus phase={state.privacyOp.phase} hash={state.privacyOp.transactionHash} network={state.network} message={state.privacyOp.message} />
      <WalletError error={error} />
      {review === key ? <TransactionReview title={labels[op] + ' ' + amount + ' STRK'} rows={[
        { label: 'Amount', value: amount + ' STRK' }, { label: 'From', value: op === 'SHIELD' ? 'Public balance' : 'Private balance' },
        { label: 'To', value: op === 'SHIELD' ? 'Your private balance' : op === 'WITHDRAW' ? state.account?.address ?? '' : recipient.trim() },
        { label: 'Network', value: networkLabel(state.network) }, { label: 'Fee', value: 'Not available in advance · checked during execution' },
        { label: 'Total', value: amount + ' STRK + applicable fees' },
      ]} onBack={() => setReview(null)} onConfirm={() => void confirm()} busy={busy} disabled={!valid || pending} confirmLabel={'Confirm ' + labels[op].toLowerCase()} note={op === 'TRANSFER' ? 'The recipient must have private receiving enabled. The wallet verifies eligibility before execution.' : 'Shielding and unshielding amounts are public on-chain. Leave extra STRK available for applicable pool and network fees.'} /> : <>
        <fieldset disabled={busy || pending} className="space-y-4 min-w-0">
          <div className="wallet-tabs" role="group" aria-label="Private action">{(Object.keys(labels) as Op[]).map(id => <button key={id} type="button" aria-pressed={op === id} onClick={() => { setOp(id); setReview(null); setError(null); }}>{labels[id]}</button>)}</div>
          <p className="text-sm">{op === 'SHIELD' ? 'Public → Private' : op === 'WITHDRAW' ? 'Private → Public' : 'Private → Recipient’s private balance'}</p>
          {op === 'TRANSFER' && <label className="block text-sm">Recipient address<input className={walletField + ' mt-2 font-mono'} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={!!recipient && !!addressError} /></label>}
          {recipient && addressError && <p className="text-xs" role="status">{addressError}</p>}
          <label className="block text-sm">Amount · STRK<input className={walletField + ' mt-2 !text-2xl'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" aria-invalid={!!amount && !!parsed.error} /></label>
          <p className="text-xs text-zinc-500">Available {op === 'SHIELD' ? 'public' : 'private'} balance: {balance === null ? 'Unavailable' : formatTokenAmount(balance, 18, 8) + ' STRK'}</p>
          {amount && parsed.error && <p className="text-xs" role="status">{parsed.error}</p>}
        </fieldset>
        {state.deploymentStatus !== 'deployed' && <p className="text-sm"><Link href="/wallet" className="underline">Activate your account</Link> before using private funds.</p>}
        {state.privacy.maturity === 'waiting' && <p className="text-sm">Waiting for network confirmations before privacy is ready.</p>}
        {pending && state.privacyOp.phase === 'idle' && <Link href="/activity" className="text-sm underline">Another transaction is processing. Check Activity.</Link>}
        <button className="product-primary-button w-full disabled:opacity-50" disabled={!valid || busy || pending} onClick={() => setReview(key)}>{pending ? 'Transaction in progress' : 'Review ' + labels[op].toLowerCase()}</button>
      </>}
    </>}
  </section>;
}
