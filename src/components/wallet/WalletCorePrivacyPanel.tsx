'use client';

import React, { useCallback, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Shield, Loader2 } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { getNetworkConfig } from '@/config/networks';
import type { PrivacyOpState } from '@/wallet/runtime';

type Op = 'TRANSFER' | 'SHIELD' | 'WITHDRAW';

const OPS: { id: Op; label: string; Icon: typeof Shield }[] = [
  { id: 'TRANSFER', label: 'Private send', Icon: ArrowUpRight },
  { id: 'SHIELD', label: 'Shield', Icon: Shield },
  { id: 'WITHDRAW', label: 'Withdraw', Icon: ArrowDownLeft },
];

const PHASE_LABEL: Record<PrivacyOpState['phase'], string> = {
  idle: 'Idle',
  preparing: 'Preparing…',
  approving: 'Approving STRK allowance…',
  proving: 'Proving…',
  submitted: 'Submitted — waiting for finality…',
  pending: 'Pending on-chain…',
  success: 'Success',
  reverted: 'Reverted on-chain',
  rejected: 'Rejected on-chain',
  failed: 'Failed',
};

const ACTIVE_PHASES: PrivacyOpState['phase'][] = ['preparing', 'approving', 'proving', 'submitted', 'pending'];

/**
 * Wallet Core STRK20 privacy panel: private send / shield / withdraw signed and managed entirely
 * by the Wallet Core local signer + the wallet-native viewing key. No Privy, no external wallet,
 * no Wallet API. The UI receives only a safe lifecycle (`state.privacyOp`) and a transaction
 * hash — never notes, proofs, amounts, or viewing keys.
 */
export const WalletCorePrivacyPanel: React.FC<{ initialOp?: Op }> = ({ initialOp }) => {
  const { runtime, state } = useWalletRuntime();
  const networkConfig = getNetworkConfig(state.network);
  const strk = networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];

  const [op, setOp] = useState<Op>(initialOp ?? 'TRANSFER');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePhase = ACTIVE_PHASES.includes(state.privacyOp.phase);
  const disabled = busy || activePhase;

  const handleRun = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const amountBase = parseAmountToBase(amount, strk.decimals);
      if (amountBase <= 0n) throw new Error('Amount must be greater than zero.');
      if (op === 'TRANSFER') {
        if (!recipient) throw new Error('Recipient is required for a private transfer.');
        await runtime.privateTransfer(strk.address, amountBase, recipient);
      } else if (op === 'SHIELD') {
        await runtime.shield(strk.address, amountBase);
      } else {
        await runtime.withdraw(strk.address, amountBase);
      }
      setRecipient('');
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STRK20 operation failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, op, strk, amount, recipient]);

  if (!state.privacy.available) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">STRK20 privacy — unavailable</h2>
        <p className="text-xs text-zinc-500">
          {state.privacy.reason ?? 'STRK20 privacy is not available for this wallet yet.'} The
          Wallet Core signer and viewing key are ready, but private operations need the proving /
          discovery services to be configured.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-1">STRK20 privacy (Wallet Core)</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Signed and managed by your Orrange wallet + wallet-native viewing key. No extension, no
        third-party wallet.
      </p>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}

      {state.privacyOp.phase !== 'idle' && (
        <div className="rounded-md border border-violet-900 bg-violet-950/30 text-violet-200 text-xs p-3 mb-4 flex items-center gap-2">
          {activePhase ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          <span>
            {state.privacyOp.operation ? `${state.privacyOp.operation}: ` : ''}
            {PHASE_LABEL[state.privacyOp.phase]}
            {state.privacyOp.transactionHash ? ` · ${state.privacyOp.transactionHash.slice(0, 14)}…` : ''}
            {state.privacyOp.message ? ` — ${state.privacyOp.message}` : ''}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        {OPS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setOp(id)}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm border disabled:opacity-40 ${
              op === id ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {op === 'TRANSFER' && (
        <>
          <label className="block text-sm text-zinc-400 mb-1">Recipient</label>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            disabled={disabled}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3 disabled:opacity-40"
          />
        </>
      )}

      <label className="block text-sm text-zinc-400 mb-1">Amount ({strk.symbol})</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4 disabled:opacity-40"
      />

      <button
        onClick={handleRun}
        disabled={disabled || !amount || (op === 'TRANSFER' && !recipient)}
        className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {op === 'SHIELD' ? 'Shield' : op === 'WITHDRAW' ? 'Withdraw' : 'Send privately'}
      </button>
    </section>
  );
};