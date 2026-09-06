'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { shortenAddress, formatTokenAmount } from '@/utils/formatters';

/**
 * Demo / debug evidence panel — surfaces PUBLIC on-chain evidence from the current session.
 *
 * Shows: operation, network, amounts, shadow address, source tx, deposit address, destination tx,
 * and final status. NEVER shows keys, seeds, viewing keys, notes, proofs, or the server prover key.
 */
export const DemoEvidencePanel: React.FC = () => {
  const { state } = useWalletRuntime();
  const account = state.account;
  if (!account) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Network', value: state.network },
    { label: 'Root wallet (public)', value: shortenAddress(account.address, 8) },
  ];

  const p = state.privacyOp;
  if (p.transactionHash && p.operation) {
    rows.push({ label: 'Last privacy op', value: `${p.operation} · ${p.phase}` });
    rows.push({ label: 'Privacy tx', value: p.transactionHash });
  }

  const s = state.swapOp;
  if (s.transactionHash) {
    rows.push({
      label: 'Last private swap',
      value: `${s.sellTokenSymbol ?? '?'} → ${s.buyTokenSymbol ?? '?'} · ${s.phase}`,
    });
    rows.push({ label: 'Swap tx', value: s.transactionHash });
    if (s.shadowAddress) rows.push({ label: 'Shadow (caller)', value: shortenAddress(s.shadowAddress, 8) });
  }

  const c = state.nearIntentOp;
  if (c.phase !== 'idle' && (c.transactionHash || c.depositAddress || c.destinationAddress)) {
    rows.push({ label: 'Cross-chain', value: `${c.phase}${c.status ? ` · ${c.status}` : ''}` });
    if (c.sourceAmount !== null) rows.push({ label: 'Source amount', value: `${formatTokenAmount(c.sourceAmount, 18, 6)} ${c.sourceSymbol ?? 'STRK'}` });
    if (c.depositAddress) rows.push({ label: 'NEAR deposit address', value: shortenAddress(c.depositAddress, 8) });
    if (c.destinationAddress) rows.push({ label: 'Destination (Base)', value: shortenAddress(c.destinationAddress, 8) });
    if (c.transactionHash) rows.push({ label: 'Source tx (shadow)', value: c.transactionHash });
    c.destinationTxHashes.slice(0, 1).forEach((h) => rows.push({ label: 'Destination tx', value: h }));
    if (c.refundReason) rows.push({ label: 'Refund', value: `${c.refundReason} (recovery required)` });
    if (c.message) rows.push({ label: 'Note', value: c.message });
  }

  if (rows.length <= 1) return null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-zinc-500" />
        <h2 className="text-sm font-semibold text-zinc-200">Session evidence (demo)</h2>
      </div>
      <dl className="space-y-1 text-[11px]">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-zinc-500 shrink-0">{r.label}</dt>
            <dd className="text-zinc-300 font-mono break-all text-right">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[10px] text-zinc-600 mt-3">
        Public on-chain evidence only. Keys, viewing keys, notes, and proofs are never shown.
      </p>
    </section>
  );
};