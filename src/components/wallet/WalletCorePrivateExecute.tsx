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
 * Wallet Core private execution — REAL STRK20 shadow-account surface. It shows the private
 * balance, lets the user pick/derive a shadow identity (appName + nonce), an amount, and a target
 * application, then runs `runtime.executePrivate(intent)`. The shadow account (not the wallet)
 * calls the application, and the outer transaction is relayed through the private paymaster.
 * The UI only ever sees the safe `executionOp` lifecycle + tx hash — never the viewing key,
 * proofs, notes, or secret material.
 */
export const WalletCorePrivateExecute: React.FC = () => {
  const { runtime, state } = useWalletRuntime();
  const networkConfig = getNetworkConfig(state.network);
  const strk = networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];
  const defaultTarget =
    process.env.NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA?.trim() || networkConfig.poolAddress;

  const [amount, setAmount] = useState('');
  const [appName, setAppName] = useState('');
  const [nonce, setNonce] = useState('0');
  const [target, setTarget] = useState(defaultTarget);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identities, setIdentities] = useState<{ appName: string; nonce: string; shadowAddress: string }[]>([]);

  const activePhase = ACTIVE_PHASES.includes(state.executionOp.phase);
  const disabled = busy || activePhase;
  const privateBalance = state.privateBalances.find((r) => r.token.symbol === strk?.symbol)?.balance ?? 0n;

  useEffect(() => {
    if (!state.account) return;
    const safe = runtime
      .listPrivateIdentities()
      .filter((i) => i.status === 'active')
      .map((i) => ({ appName: i.appName, nonce: i.nonce, shadowAddress: i.shadowAddress }));
    setIdentities(safe);
    if (!safe.some((i) => i.appName === appName.trim() && BigInt(i.nonce) === BigInt(nonce || '0'))) {
      // keep the current form values; do not overwrite the user's in-progress entry
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.account?.walletId, state.network]);

  const handleCreateIdentity = useCallback(async () => {
    setError(null);
    if (!appName.trim()) {
      setError('appName is required.');
      return;
    }
    let nonceBig: bigint;
    try {
      nonceBig = BigInt(nonce.trim() || '0');
      if (nonceBig < 0n) throw new Error('negative');
    } catch {
      setError('nonce must be a non-negative integer.');
      return;
    }
    setBusy(true);
    try {
      const identity = await runtime.createShadowIdentity(appName.trim(), nonceBig);
      setIdentities((prev) => [
        ...prev.filter((i) => !(i.appName === identity.appName && BigInt(i.nonce) === BigInt(identity.nonce))),
        { appName: identity.appName, nonce: identity.nonce, shadowAddress: identity.shadowAddress },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shadow identity creation failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, appName, nonce]);

  const handleExecute = useCallback(async () => {
    setError(null);
    const amountBase = parseAmountToBase(amount, strk.decimals);
    if (amountBase <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!appName.trim()) {
      setError('appName is required (create or select a shadow identity first).');
      return;
    }
    let nonceBig: bigint;
    try {
      nonceBig = BigInt(nonce.trim() || '0');
      if (nonceBig < 0n) throw new Error('negative');
    } catch {
      setError('nonce must be a non-negative integer.');
      return;
    }
    if (!target?.trim()) {
      setError('Target application contract is required.');
      return;
    }
    setBusy(true);
    try {
      const amountHex = '0x' + amountBase.toString(16);
      await runtime.executePrivate({
        action: 'shadow.invoke',
        appName: appName.trim(),
        nonce: nonceBig,
        token: strk.address,
        amount: amountBase,
        calls: [{ contractAddress: target.trim(), entrypoint: 'record', calldata: [amountHex] }],
      });
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Private execution failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, strk, amount, target, appName, nonce]);

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
          real shadow account
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Spend a private STRK20 balance through a REAL shadow account: the shadow account (not your
        wallet) calls the application, and the outer transaction is relayed by a private paymaster.
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
          {activePhase ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" />
          ) : state.executionOp.phase === 'success' ? (
            <CircleCheck className="w-3.5 h-3.5 mt-0.5" />
          ) : (
            <TriangleAlert className="w-3.5 h-3.5 mt-0.5" />
          )}
          <span className="min-w-0">
            {state.executionOp.action ?? ''} — {PHASE_LABEL[state.executionOp.phase]}
            {state.executionOp.appName ? ` · ${state.executionOp.appName}:${state.executionOp.nonce ?? '0'}` : ''}
            {state.executionOp.amount !== null
              ? ` · ${(Number(state.executionOp.amount) / 10 ** (strk?.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${state.executionOp.tokenSymbol ?? ''}`
              : ''}
            {state.executionOp.shadowAddress ? ` · shadow ${state.executionOp.shadowAddress.slice(0, 10)}…` : ''}
            {state.executionOp.transactionHash ? ` · ${state.executionOp.transactionHash.slice(0, 14)}…` : ''}
            {state.executionOp.message ? ` — ${state.executionOp.message}` : ''}
          </span>
        </div>
      )}

      <label className="block text-sm text-zinc-400 mb-1">Shadow identity (appName · nonce)</label>
      {identities.length > 0 ? (
        <div className="flex gap-2 mb-2">
          <select
            value=""
            onChange={(e) => {
              const sel = identities[Number(e.target.value)];
              if (sel) {
                setAppName(sel.appName);
                setNonce(sel.nonce);
              }
            }}
            disabled={disabled}
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40"
          >
            <option value="">Use existing…</option>
            {identities.map((i, idx) => (
              <option key={`${i.appName}-${i.nonce}`} value={idx}>
                {i.appName} · {i.nonce} · shadow {i.shadowAddress.slice(0, 8)}…
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 mb-2">No shadow identity yet — create one below.</p>
      )}
      <div className="flex gap-2 mb-4">
        <input
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="appName (e.g. orrange)"
          disabled={disabled}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40"
        />
        <input
          value={nonce}
          onChange={(e) => setNonce(e.target.value)}
          placeholder="nonce"
          disabled={disabled}
          className="w-20 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm disabled:opacity-40"
        />
        <button
          onClick={handleCreateIdentity}
          disabled={disabled || !appName.trim()}
          className="rounded-md border border-violet-800 px-3 py-2 text-sm text-violet-300 disabled:opacity-40"
        >
          Create identity
        </button>
      </div>
      <p className="text-[11px] text-zinc-600 mb-4">
        Same appName + nonce → same shadow address. A new nonce → a fresh shadow address.
      </p>

      <label className="block text-sm text-zinc-400 mb-1">Target application (the shadow calls it)</label>
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="0x…"
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4 disabled:opacity-40"
      />

      <label className="block text-sm text-zinc-400 mb-1">Amount routed into the shadow ({strk?.symbol ?? ''})</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        disabled={disabled}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4 disabled:opacity-40"
      />

      <button
        onClick={handleExecute}
        disabled={disabled || !amount || !appName.trim() || !target?.trim()}
        className="inline-flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        Execute through shadow account
      </button>

      <p className="text-[11px] text-zinc-600 mt-3 flex items-center gap-1">
        <Lock className="w-3 h-3" />
        The wallet core signs the private proof. The viewing key, notes, and proofs never leave the
        privacy session; the paymaster relays the outer tx.
      </p>
    </section>
  );
};