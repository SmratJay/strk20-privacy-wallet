'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Zap, Loader2, CircleCheck, TriangleAlert, Lock } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { getNetworkConfig } from '@/config/networks';
import type { PrivateExecutionOpState } from '@/privacy/execution';

const PHASE_LABEL: Record<PrivateExecutionOpState['phase'], string> = {
  idle: 'Idle',
  preparing: 'Preparing…',
  proving: 'Proving…',
  submitted: 'Submitted — waiting for finality…',
  pending: 'Pending on-chain…',
  success: 'Success',
  reverted: 'Reverted on-chain',
  rejected: 'Rejected on-chain',
  failed: 'Failed',
};

const ACTIVE_PHASES: PrivateExecutionOpState['phase'][] = ['preparing', 'proving', 'submitted', 'pending'];

/**
 * Wallet Core private execution — the Phase 1 minimal surface. It shows the private balance,
 * lets the user pick a shadow identity, an amount, and an application target, then runs
 * `runtime.executePrivate(intent)`. The UI only ever sees the safe `executionOp` lifecycle and a
 * transaction hash — never the viewing key, proofs, notes, or secret material.
 *
 * This is intentionally ONE small panel, not a dashboard redesign and not a cross-chain surface.
 */
export const WalletCorePrivateExecute: React.FC = () => {
  const { runtime, state } = useWalletRuntime();
  const networkConfig = getNetworkConfig(state.network);
  const strk = networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];
  const defaultTarget =
    process.env.NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA?.trim() || networkConfig.poolAddress;

  const [amount, setAmount] = useState('');
  const [target, setTarget] = useState(defaultTarget);
  const [purpose, setPurpose] = useState('');
  const [selectedIdentity, setSelectedIdentity] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identities, setIdentities] = useState<{ id: string; purpose: string }[]>([]);

  const activePhase = ACTIVE_PHASES.includes(state.executionOp.phase);
  const disabled = busy || activePhase;
  const privateBalance = state.privateBalances.find((r) => r.token.symbol === strk?.symbol)?.balance ?? 0n;

  useEffect(() => {
    if (!state.account) return;
    const safe = runtime
      .listPrivateIdentities()
      .filter((i) => i.status === 'active')
      .map((i) => ({ id: i.id, purpose: i.purpose }));
    setIdentities(safe);
    if (!safe.some((i) => i.id === selectedIdentity)) {
      setSelectedIdentity(safe[0]?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.account?.walletId, state.network]);

  const handleCreateIdentity = useCallback(async () => {
    setError(null);
    if (!purpose.trim()) {
      setError('Identity purpose is required.');
      return;
    }
    setBusy(true);
    try {
      const identity = await runtime.createPrivateIdentity(purpose.trim());
      setIdentities((prev) => [...prev.filter((i) => i.id !== identity.id), { id: identity.id, purpose: identity.purpose }]);
      setSelectedIdentity(identity.id);
      setPurpose('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Private identity creation failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, purpose]);

  const handleExecute = useCallback(async () => {
    setError(null);
    const amountBase = parseAmountToBase(amount, strk.decimals);
    if (amountBase <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!selectedIdentity) {
      setError('Create or select a private identity first.');
      return;
    }
    if (!target?.trim()) {
      setError('Target application contract is required.');
      return;
    }
    setBusy(true);
    try {
      await runtime.executePrivate({
        action: 'application.invoke',
        token: strk.address,
        amount: amountBase,
        targetContract: target.trim(),
        identity: selectedIdentity,
      });
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Private execution failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, strk, amount, target, selectedIdentity]);

  if (!state.privacy.available) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Private execute — unavailable</h2>
        <p className="text-xs text-zinc-500">
          {state.privacy.reason ?? 'STRK20 privacy is not available for this wallet yet.'}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-zinc-200">Private execute</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-800 px-2.5 py-0.5 text-[11px] text-violet-300">
          <Zap className="w-3 h-3" />
          application action
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Spend a private STRK20 balance to trigger an action on an external Starknet application.
        Executed through the privacy layer — the application only sees your private execution
        identity, never your wallet.
      </p>

      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4">
        <span className="text-zinc-500">Private balance: </span>
        <span className="font-mono text-violet-200">
          {(Number(privateBalance) / 10 ** (strk?.decimals ?? 18)).toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })}{' '}
          {strk?.symbol ?? ''}
        </span>
      </div>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}

      {state.executionOp.phase !== 'idle' && (
        <div className="rounded-md border border-violet-900 bg-violet-950/30 text-violet-200 text-xs p-3 mb-4 flex items-start gap-2">
          {activePhase ? <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" /> : state.executionOp.phase === 'success' ? <CircleCheck className="w-3.5 h-3.5 mt-0.5" /> : <TriangleAlert className="w-3.5 h-3.5 mt-0.5" />}
          <span className="min-w-0">
            {state.executionOp.action ? `${state.executionOp.action}` : ''} — {PHASE_LABEL[state.executionOp.phase]}
            {state.executionOp.amount !== null ? ` · ${(Number(state.executionOp.amount) / 10 ** (strk?.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${state.executionOp.tokenSymbol ?? ''}` : ''}
            {state.executionOp.targetContract ? ` · ${state.executionOp.targetContract.slice(0, 10)}…` : ''}
            {state.executionOp.transactionHash ? ` · ${state.executionOp.transactionHash.slice(0, 14)}…` : ''}
            {state.executionOp.message ? ` — ${state.executionOp.message}` : ''}
          </span>
        </div>
      )}

      <label className="block text-sm text-zinc-400 mb-1">Identity (shadow execution identity)</label>
      {identities.length > 0 ? (
        <select
          value={selectedIdentity}
          onChange={(e) => setSelectedIdentity(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3 disabled:opacity-40"
        >
          {identities.map((i) => (
            <option key={i.id} value={i.id}>
              {i.purpose} · {i.id.slice(0, 10)}…
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs text-zinc-500 mb-3">No private identity yet — create one below.</p>
      )}
      <div className="flex gap-2 mb-4">
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="identity purpose (e.g. acceptance)"
          disabled={disabled}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40"
        />
        <button
          onClick={handleCreateIdentity}
          disabled={disabled || !purpose.trim()}
          className="rounded-md border border-violet-800 px-3 py-2 text-sm text-violet-300 disabled:opacity-40"
        >
          Create identity
        </button>
      </div>

      <label className="block text-sm text-zinc-400 mb-1">Target application (privacy_invoke contract)</label>
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="0x…"
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4 disabled:opacity-40"
      />

      <label className="block text-sm text-zinc-400 mb-1">Amount ({strk?.symbol ?? ''})</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4 disabled:opacity-40"
      />

      <button
        onClick={handleExecute}
        disabled={disabled || !amount || !selectedIdentity || !target?.trim()}
        className="inline-flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Execute privately
      </button>

      <p className="text-[11px] text-zinc-600 mt-3 flex items-center gap-1">
        <Lock className="w-3 h-3" />
        The wallet core signs the private proof. The viewing key, notes, and proofs never leave the
        privacy session.
      </p>
    </section>
  );
};