'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Repeat, Loader2, CircleCheck, TriangleAlert, Lock, ShieldCheck } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { getNetworkConfig } from '@/config/networks';
import { parseAmountToBase } from '@/wallet';
import { PRIVATE_SWAP_APPS, STRKFTW_TOKEN, resolvePrivateSwapApp } from '@/features/private-swap';
import type { PrivateSwapOpState, PrivateSwapQuote } from '@/features/private-swap';
import { formatTokenAmount } from '@/utils/formatters';

const PHASE_LABEL: Record<PrivateSwapOpState['phase'], string> = {
  idle: 'Idle',
  quoting: 'Quoting…',
  preparing: 'Preparing…',
  funding: 'Funding shadow account…',
  proving: 'Proving…',
  relaying: 'Relaying through the private paymaster…',
  pending: 'Pending on-chain…',
  success: 'Success',
  reverted: 'Reverted on-chain',
  rejected: 'Rejected on-chain',
  failed: 'Failed',
  unknown: 'Submission status unknown — reconcile before retrying',
};

const ACTIVE_PHASES: PrivateSwapOpState['phase'][] = [
  'quoting',
  'preparing',
  'funding',
  'proving',
  'relaying',
  'pending',
];

const DEFAULT_SLIPPAGE_BPS = 100; // 1%

/**
 * Private swap — REAL shadow-account swap surface on /wallet.
 *
 * The user swaps private STRK for the configured swap application's token through a REAL STRK20
 * shadow account: the shadow account (not the wallet) calls the swap application, the buy token
 * is collected back into the private balance, and the outer transaction is relayed by a private
 * paymaster. The UI shows the real on-chain quote + the effective private execution fee before
 * confirmation and only ever sees the safe `swapOp` lifecycle + tx hash — never viewing keys,
 * notes, proofs, or secrets.
 */
export const PrivateSwapPanel: React.FC = () => {
  const { runtime, state } = useWalletRuntime();
  const networkConfig = getNetworkConfig(state.network);
  const app = PRIVATE_SWAP_APPS.find((a) => a.network === 'sepolia');
  const sellToken = app?.sellToken ?? networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];
  const buyToken = app?.buyToken ?? STRKFTW_TOKEN;

  const [amount, setAmount] = useState('');
  const [appName, setAppName] = useState('');
  const [nonce, setNonce] = useState('0');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<PrivateSwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identities, setIdentities] = useState<{ appName: string; nonce: string; shadowAddress: string }[]>([]);

  const activePhase = ACTIVE_PHASES.includes(state.swapOp.phase);
  const disabled = busy || activePhase;
  const privateBalance = state.privateBalances.find((r) => r.token.address.toLowerCase() === sellToken.address.toLowerCase())?.balance ?? 0n;

  useEffect(() => {
    if (!state.account) return;
    const safe = runtime
      .listPrivateIdentities()
      .filter((i) => i.status === 'active')
      .map((i) => ({ appName: i.appName, nonce: i.nonce, shadowAddress: i.shadowAddress }));
    setIdentities(safe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.account?.walletId, state.network]);

  const refreshQuote = useCallback(async () => {
    if (!state.account || !amount) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const amountBase = parseAmountToBase(amount, sellToken.decimals);
    if (amountBase <= 0n) {
      setQuote(null);
      setQuoteError('Amount must be greater than zero.');
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const q = await runtime.quotePrivateSwap({
        action: 'private.swap',
        sellToken: sellToken.address,
        buyToken: buyToken.address,
        sellAmount: amountBase,
        slippageBps,
        appName: appName.trim() || 'orrange',
        nonce: BigInt(nonce.trim() || '0'),
      });
      setQuote(q);
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Could not fetch a private swap quote.');
    } finally {
      setQuoting(false);
    }
  }, [state.account, amount, sellToken, buyToken, slippageBps, appName, nonce, runtime]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

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

  const handleSwap = useCallback(async () => {
    setError(null);
    const amountBase = parseAmountToBase(amount, sellToken.decimals);
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
    const pair = resolvePrivateSwapApp('sepolia', sellToken.address, buyToken.address);
    if (!pair) {
      setError('Unsupported private-swap pair for this network.');
      return;
    }
    setBusy(true);
    try {
      await runtime.executePrivateSwap(
        {
          action: 'private.swap',
          sellToken: pair.sellToken.address,
          buyToken: pair.buyToken.address,
          sellAmount: amountBase,
          slippageBps,
          appName: appName.trim(),
          nonce: nonceBig,
        },
        quote ?? undefined,
      );
      setAmount('');
      void runtime.refreshPrivateBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Private swap failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, sellToken, buyToken, amount, slippageBps, appName, nonce, quote]);

  if (!state.privacy.available) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Private swap — unavailable</h2>
        <p className="text-xs text-zinc-500">
          {state.privacy.reason ?? 'STRK20 privacy is not available for this wallet yet.'}
        </p>
      </section>
    );
  }

  const minReceive = quote ? formatTokenAmount(quote.minOutput, buyToken.decimals, 6) : null;
  const estimatedReceive = quote ? formatTokenAmount(quote.buyAmount, buyToken.decimals, 6) : null;
  const feeDisplay = quote?.feeStrk != null ? formatTokenAmount(quote.feeStrk, 18, 4) : null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-zinc-200">Private swap</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800 px-2.5 py-0.5 text-[11px] text-emerald-300">
          <ShieldCheck className="w-3 h-3" />
          real shadow account
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Swap private STRK for {buyToken.symbol} through a REAL shadow account on{' '}
        {app?.name ?? 'the swap application'}. The shadow account calls the swap application; your
        wallet never is the caller.
      </p>

      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4">
        <span className="text-zinc-500">Private balance: </span>
        <span className="font-mono text-violet-200">
          {formatTokenAmount(privateBalance, sellToken.decimals, 6)} {sellToken.symbol}
        </span>
      </div>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}

      {state.swapOp.phase !== 'idle' && (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 text-emerald-200 text-xs p-3 mb-4 flex items-start gap-2">
          {activePhase ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" />
          ) : state.swapOp.phase === 'success' ? (
            <CircleCheck className="w-3.5 h-3.5 mt-0.5" />
          ) : (
            <TriangleAlert className="w-3.5 h-3.5 mt-0.5" />
          )}
          <span className="min-w-0">
            private swap — {PHASE_LABEL[state.swapOp.phase]}
            {state.swapOp.appName ? ` · ${state.swapOp.appName}:${state.swapOp.nonce ?? '0'}` : ''}
            {state.swapOp.sellAmount !== null
              ? ` · ${formatTokenAmount(state.swapOp.sellAmount, sellToken.decimals, 4)} ${state.swapOp.sellTokenSymbol ?? 'STRK'}`
              : ''}
            {state.swapOp.shadowAddress ? ` · shadow ${state.swapOp.shadowAddress.slice(0, 10)}…` : ''}
            {state.swapOp.transactionHash ? ` · ${state.swapOp.transactionHash.slice(0, 14)}…` : ''}
            {state.swapOp.message ? ` — ${state.swapOp.message}` : ''}
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
          className="rounded-md border border-emerald-800 px-3 py-2 text-sm text-emerald-300 disabled:opacity-40"
        >
          Create identity
        </button>
      </div>
      <p className="text-[11px] text-zinc-600 mb-4">Same appName + nonce → same shadow address. A new nonce → a fresh shadow address.</p>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">You sell</span>
          <span className="text-[11px] text-zinc-500">
            Max: {formatTokenAmount(privateBalance, sellToken.decimals, 4)} {sellToken.symbol}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            disabled={disabled}
            className="flex-1 bg-transparent text-2xl font-semibold text-zinc-100 outline-none placeholder:text-zinc-700"
          />
          <span className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100">
            {sellToken.icon} {sellToken.symbol}
          </span>
        </div>
        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full border border-zinc-800 text-zinc-400 flex items-center justify-center">
            <Repeat className="w-4 h-4" />
          </div>
        </div>
        <div className="text-[11px] text-zinc-500">You receive</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-2xl font-semibold text-zinc-100">
            {estimatedReceive ?? '—'}
            <span className="ml-2 text-sm text-zinc-500">{buyToken.symbol}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-zinc-500">
        <div className="flex justify-between">
          <span>Estimated receive</span>
          <span className="font-mono text-zinc-300">{estimatedReceive ?? '—'} {buyToken.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span>Minimum receive ({formatTokenAmount(BigInt(slippageBps), 4, 2)}% slippage)</span>
          <span className="font-mono text-zinc-300">{minReceive ?? '—'} {buyToken.symbol}</span>
        </div>
        <div className="flex justify-between">
          <span>Private execution fee (paymaster relay)</span>
          <span className="font-mono text-zinc-300">{feeDisplay ? `${feeDisplay} STRK` : '—'}</span>
        </div>
        {quote && (
          <div className="flex justify-between">
            <span>Route</span>
            <span className="text-zinc-300">{quote.route}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-600">
        <span>Slippage</span>
        <select
          value={slippageBps}
          onChange={(e) => setSlippageBps(Number(e.target.value))}
          disabled={disabled}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 disabled:opacity-40"
        >
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
          <option value={200}>2%</option>
          <option value={500}>5%</option>
        </select>
      </div>

      {quoting && (
        <div className="flex items-center gap-2 text-[12px] text-zinc-500 mt-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the live swap quote…
        </div>
      )}
      {quoteError && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2 mt-3">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          {quoteError}
        </div>
      )}

      <button
        onClick={handleSwap}
        disabled={
          disabled ||
          quoting ||
          !amount ||
          !appName.trim() ||
          !quote ||
          parseAmountToBase(amount, sellToken.decimals) > privateBalance
        }
        className="w-full mt-4 py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500 hover:bg-emerald-400 text-black"
      >
        {activePhase ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Swapping privately…
          </span>
        ) : (
          'Swap my private STRK'
        )}
      </button>

      <p className="text-[11px] text-zinc-600 mt-3 flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Your wallet core signs the private proof. The viewing key, notes, and proofs never leave the
        privacy session; the shadow account calls the swap application; the paymaster relays the outer tx.
      </p>
    </section>
  );
};