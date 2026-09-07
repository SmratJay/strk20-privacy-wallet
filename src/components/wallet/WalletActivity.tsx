'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowUpRight, Loader2 } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { getNetworkConfig } from '@/config/networks';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';
import { networkLabel, transactionUrl } from '@/utils/walletUx';
import type { RecentTransaction } from '@/wallet/runtime';
import { WalletError } from './TransactionFeedback';

const names: Record<NonNullable<RecentTransaction['kind']>, string> = {
  public: 'Send / public transaction', shield: 'Shield', withdraw: 'Unshield', privateTransfer: 'Private send / execution',
  register: 'Enable privacy', swap: 'Swap', privateSwap: 'Private swap', crossChain: 'Cross-chain',
};
const statuses: Record<string, string> = {
  success: 'Confirmed', pending: 'Pending', submitted: 'Submitted', reverted: 'Reverted', rejected: 'Rejected', failed: 'Not completed',
  unknown: 'Check status', refunded: 'Refund recovery required', expired: 'Expired', 'source-confirming': 'Confirming source',
  'solver-executing': 'Processing destination', 'destination-pending': 'Awaiting destination', 'awaiting-source-deposit': 'Preparing deposit',
};

export function WalletActivity({ limit = 20 }: { limit?: number }) {
  const { runtime, state } = useWalletRuntime();
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const rows = [...state.recentTransactions].sort((a, b) => b.at - a.at).slice(0, limit);
  async function refresh(tx: RecentTransaction) {
    setChecking(tx.hash); setError(null);
    try {
      if (tx.kind === 'crossChain' && tx.hash === state.nearIntentOp.transactionHash && state.nearIntentOp.depositAddress) await runtime.getPrivacyHubStatus(state.nearIntentOp.depositAddress);
      else await runtime.refreshTransaction(tx.hash);
    } catch (err) { setError(err); }
    finally { setChecking(null); }
  }
  return <div className="space-y-4">
    <WalletError error={error} />
    {state.nearIntentOp.phase !== 'idle' && !state.nearIntentOp.transactionHash && <Link href="/cross-chain" className="text-sm underline">Cross-chain transfer: review the latest status →</Link>}
    {rows.length === 0 ? <div className="py-6 text-center space-y-2"><Activity className="w-6 h-6 mx-auto text-[var(--app-accent)]" /><p className="text-sm font-medium">Your next move starts here</p><p className="text-xs text-zinc-500">Transactions you submit in this session will appear here.</p><Link href="/receive" className="inline-block text-sm underline pt-2">Add funds to your wallet</Link></div> : <ul className="divide-y divide-[var(--app-border)]">{rows.map(tx => {
      const token = getNetworkConfig(tx.network ?? state.network).tokens.find(t => t.symbol === tx.symbol);
      const completed = tx.status === 'success';
      return <li key={tx.hash} className="py-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{names[tx.kind ?? 'public']}</strong><span className={completed ? 'text-[var(--app-success)]' : 'text-[var(--app-text-secondary)]'}>{tx.kind === 'crossChain' && completed ? 'Delivered' : statuses[tx.status ?? 'submitted'] ?? 'Processing'}</span></div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500"><span>{tx.amount && token ? formatTokenAmount(BigInt(tx.amount), token.decimals, 8) + ' ' + token.symbol : 'View transaction for amounts'}</span><time dateTime={new Date(tx.at).toISOString()}>{new Date(tx.at).toLocaleString()}</time></div>
        <p className="text-xs text-zinc-500">{networkLabel(tx.network ?? state.network)}{tx.recipient ? ' · To ' + shortenAddress(tx.recipient, 6) : ''}</p>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <a href={transactionUrl(tx.network ?? state.network, tx.hash)} className="inline-flex items-center gap-1 underline" target="_blank" rel="noopener noreferrer">View transaction <ArrowUpRight className="w-3 h-3" /></a>
          {tx.kind === 'crossChain' && <Link href="/cross-chain" className="underline">Track destination</Link>}
          {!['success', 'reverted', 'rejected', 'refunded'].includes(tx.status ?? '') && (tx.kind !== 'crossChain' || tx.hash === state.nearIntentOp.transactionHash) && <button disabled={checking !== null} onClick={() => void refresh(tx)} className="inline-flex items-center gap-1 underline disabled:opacity-50">{checking === tx.hash && <Loader2 className="w-3 h-3 animate-spin" />}{checking === tx.hash ? 'Checking confirmation…' : 'Check status'}</button>}
        </div>
      </li>;
    })}</ul>}
    <p className="text-xs text-zinc-500 leading-relaxed">Session activity only. History clears when you lock, switch wallets or reload. Incoming transfers are reflected in balances; they are not indexed here yet. Save transaction references before leaving.</p>
  </div>;
}
