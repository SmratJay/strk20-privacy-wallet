'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { networkLabel, transactionUrl, walletErrorMessage } from '@/utils/walletUx';

export const walletField = 'w-full min-w-0 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-3 text-sm disabled:opacity-50';

export function WalletError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="wallet-feedback border border-red-500/30 rounded-xl p-4 text-sm space-y-2">
    <p className="flex gap-2"><TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />{walletErrorMessage(error)}</p>
    <details className="text-xs text-[var(--app-text-secondary)]"><summary>Advanced details</summary><p className="break-words mt-2 whitespace-pre-wrap">{error instanceof Error ? error.message : String(error)}</p></details>
  </div>;
}

export function TransactionReview({ title, rows, onBack, onConfirm, busy = false, disabled = false, note, confirmLabel = 'Confirm transaction' }: {
  title: string; rows: { label: string; value: string }[]; onBack: () => void; onConfirm: () => void;
  busy?: boolean; disabled?: boolean; note?: string; confirmLabel?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="wallet-review rounded-2xl border border-[var(--app-border)] p-5 space-y-5" aria-label="Review transaction">
    <div><div className="product-eyebrow">Review transaction</div><h2 ref={heading} tabIndex={-1} className="text-xl font-semibold mt-2">{title}</h2></div>
    <dl className="space-y-3">{rows.map(row => <div key={row.label} className="wallet-review-row"><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    {note && <p className="text-xs leading-relaxed text-[var(--app-text-secondary)]">{note}</p>}
    <div className="grid grid-cols-[auto_1fr] gap-3">
      <button type="button" className="wallet-secondary-button" onClick={onBack} disabled={busy}><ArrowLeft className="w-4 h-4" /> Edit</button>
      <button type="button" className="product-primary-button px-4 disabled:opacity-50" onClick={onConfirm} disabled={busy || disabled}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? 'Processing transaction…' : confirmLabel}</button>
    </div>
  </section>;
}

const labels: Record<string, string> = {
  preparing: 'Preparing your transaction…', approving: 'Approving the token for shielding…', proving: 'Preparing your private transaction…',
  submitted: 'Transaction submitted', pending: 'Waiting for network confirmation…', success: 'Transaction confirmed', reverted: 'Transaction reverted',
  rejected: 'Transaction rejected', failed: 'Transaction not completed', unknown: 'Status not confirmed', quoting: 'Checking your quote…',
  funding: 'Preparing your private balance…', relaying: 'Submitting your private transaction…',
};

export function TransactionStatus({ phase, hash, network, message }: { phase: string; hash?: string | null; network: string; message?: string | null }) {
  if (phase === 'idle') return null;
  const failed = ['failed', 'reverted', 'rejected', 'unknown'].includes(phase);
  const pending = !failed && phase !== 'success';
  return <div className="wallet-feedback rounded-xl border border-[var(--app-border)] p-4 space-y-3">
    <p role="status" className="flex items-center gap-2 text-sm font-medium">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : failed ? <TriangleAlert className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}{labels[phase] ?? 'Processing transaction…'}</p>
    <p className="text-xs text-[var(--app-text-secondary)]">{networkLabel(network)}{pending || phase === 'unknown' ? ' · Check the status before submitting again.' : ''}</p>
    {message && <details className="text-xs"><summary>Transaction details</summary><p className="break-words mt-2">{message}</p></details>}
    <div className="flex flex-wrap gap-4 text-xs">
      {hash && <a className="underline inline-flex items-center gap-1" href={transactionUrl(network, hash)} target="_blank" rel="noopener noreferrer">View transaction <ArrowUpRight className="w-3 h-3" /></a>}
      <Link className="underline" href="/activity">View activity</Link>
    </div>
  </div>;
}
