'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, CircleCheck, TriangleAlert, Lock, ShieldCheck, Repeat } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { formatTokenAmount } from '@/utils/formatters';
import type { CrossChainPrivateIntent, NearIntentOpState, NearIntentQuote } from '@/features/near-intents';

const STRK_DECIMALS = 18;
const USDC_DECIMALS = 6;
const DEFAULT_APP_NAME = 'orrange';
const DEFAULT_SLIPPAGE_BPS = 100;

const PHASE_LABEL: Record<NearIntentOpState['phase'], string> = {
  idle: 'Idle',
  quoting: 'Quoting…',
  preparing: 'Preparing…',
  'intent-created': 'Deposit address reserved',
  'awaiting-source-deposit': 'Funding the private source deposit…',
  'source-confirming': 'Confirming the source deposit…',
  'solver-executing': 'Solver executing…',
  'destination-pending': 'Destination pending…',
  success: 'Success',
  failed: 'Failed',
  refunded: 'Refunded',
  unknown: 'Status unknown — reconcile before retrying',
};

const ACTIVE_PHASES: NearIntentOpState['phase'][] = [
  'preparing',
  'awaiting-source-deposit',
  'source-confirming',
  'solver-executing',
  'destination-pending',
];

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Private cross-chain — REAL NEAR Intents routing on /wallet.
 *
 * From: private STRK → To: USDC on Base. The user supplies the amount + destination address; the
 * panel reads a REAL NEAR Intents quote (dry), reserves a deposit address, and executes through the
 * existing STRK20 shadow-account path (the shadow account — never the root wallet — funds the NEAR
 * deposit address). The UI only ever sees the safe `nearIntentOp` lifecycle + amounts — never
 * viewing keys, notes, proofs, or NEAR credentials.
 */
export const PrivateCrossChainPanel: React.FC = () => {
  const { runtime, state } = useWalletRuntime();

  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [quote, setQuote] = useState<NearIntentQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePhase = ACTIVE_PHASES.includes(state.nearIntentOp.phase);
  const disabled = busy || activePhase;
  const destinationValid = EVM_ADDRESS.test(destination.trim());
  const privateBalance =
    state.privateBalances.find((r) => r.token.symbol === 'STRK')?.balance ?? 0n;

  const refreshQuote = useCallback(async () => {
    if (!state.account || !amount || !destinationValid) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const amountBase = parseAmountToBase(amount, STRK_DECIMALS);
    if (amountBase <= 0n) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const q = await runtime.quoteCrossChain({
        action: 'cross-chain.swap',
        sourceChain: 'starknet',
        sourceAsset: 'strk',
        sourceAmount: amountBase,
        destinationChain: 'base',
        destinationAsset: 'usdc',
        destinationAddress: destination.trim(),
        slippageBps,
        appName: DEFAULT_APP_NAME,
        nonce: 0n,
      });
      setQuote(q);
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Could not fetch a cross-chain quote.');
    } finally {
      setQuoting(false);
    }
  }, [state.account, amount, destination, destinationValid, slippageBps, runtime]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const ensureIdentity = useCallback(async () => {
    const existing = runtime
      .listPrivateIdentities()
      .find((i) => i.appName === DEFAULT_APP_NAME && BigInt(i.nonce) === 0n && i.status === 'active');
    if (!existing) await runtime.createShadowIdentity(DEFAULT_APP_NAME, 0n);
  }, [runtime]);

  const handleSend = useCallback(async () => {
    setError(null);
    const amountBase = parseAmountToBase(amount, STRK_DECIMALS);
    if (amountBase <= 0n) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (!destinationValid) {
      setError('Enter a valid Base (EVM) destination address.');
      return;
    }
    setBusy(true);
    try {
      await ensureIdentity();
      const intent: CrossChainPrivateIntent = {
        action: 'cross-chain.swap',
        sourceChain: 'starknet',
        sourceAsset: 'strk',
        sourceAmount: amountBase,
        destinationChain: 'base',
        destinationAsset: 'usdc',
        destinationAddress: destination.trim(),
        slippageBps,
        appName: DEFAULT_APP_NAME,
        nonce: 0n,
      };
      const prepared = await runtime.createCrossChainIntent(intent, quote ?? undefined);
      await runtime.executeCrossChainIntent(intent, prepared);
      setAmount('');
      void runtime.refreshPrivateBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cross-chain execution failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, amount, destination, destinationValid, slippageBps, quote, ensureIdentity]);

  if (!state.privacy.available) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">Private cross-chain — unavailable</h2>
        <p className="text-xs text-zinc-500">
          {state.privacy.reason ?? 'STRK20 privacy is not available for this wallet yet.'}
        </p>
      </section>
    );
  }

  const estimatedReceive = quote ? formatTokenAmount(quote.amountOut, USDC_DECIMALS, 6) : null;
  const minReceive = quote ? formatTokenAmount(quote.minAmountOut, USDC_DECIMALS, 6) : null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-zinc-200">Private cross-chain</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800 px-2.5 py-0.5 text-[11px] text-emerald-300">
          <ShieldCheck className="w-3 h-3" />
          NEAR Intents
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Route private STRK to USDC on Base through NEAR Intents. The shadow account funds the
        deposit; your wallet is never the depositor.
      </p>

      <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4">
        <span className="text-zinc-500">Private balance: </span>
        <span className="font-mono text-violet-200">
          {formatTokenAmount(privateBalance, STRK_DECIMALS, 6)} STRK
        </span>
      </div>
      <p className="text-[11px] text-amber-300/80 mb-4">
        API layer verified live (quote / deposit address / status). Real cross-chain settlement
        requires Starknet mainnet STRK20, which is not enabled — the source side stays private, but
        a full settle is not claimable in this environment.
      </p>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}

      {state.nearIntentOp.phase !== 'idle' && (
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 text-emerald-200 text-xs p-3 mb-4 flex items-start gap-2">
          {activePhase ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" />
          ) : state.nearIntentOp.phase === 'success' ? (
            <CircleCheck className="w-3.5 h-3.5 mt-0.5" />
          ) : (
            <TriangleAlert className="w-3.5 h-3.5 mt-0.5" />
          )}
          <span className="min-w-0">
            cross-chain — {PHASE_LABEL[state.nearIntentOp.phase]}
            {state.nearIntentOp.sourceAmount !== null
              ? ` · ${formatTokenAmount(state.nearIntentOp.sourceAmount, STRK_DECIMALS, 4)} STRK`
              : ''}
            {state.nearIntentOp.depositAddress ? ` · deposit ${state.nearIntentOp.depositAddress.slice(0, 10)}…` : ''}
            {state.nearIntentOp.transactionHash ? ` · ${state.nearIntentOp.transactionHash.slice(0, 14)}…` : ''}
            {state.nearIntentOp.message ? ` — ${state.nearIntentOp.message}` : ''}
          </span>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">You send (from private STRK)</span>
          <span className="text-[11px] text-zinc-500">
            Max: {formatTokenAmount(privateBalance, STRK_DECIMALS, 4)} STRK
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
          <span className="rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100">⚡ STRK</span>
        </div>
        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full border border-zinc-800 text-zinc-400 flex items-center justify-center">
            <Repeat className="w-4 h-4" />
          </div>
        </div>
        <div className="text-[11px] text-zinc-500">You receive (on Base)</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-2xl font-semibold text-zinc-100">
            {estimatedReceive ?? '—'}
            <span className="ml-2 text-sm text-zinc-500">USDC</span>
          </div>
        </div>
        <div className="text-[11px] text-zinc-500">Destination address (Base)</div>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="0x…"
          disabled={disabled}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono disabled:opacity-40"
        />
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-zinc-500">
        <div className="flex justify-between">
          <span>Estimated receive</span>
          <span className="font-mono text-zinc-300">{estimatedReceive ?? '—'} USDC</span>
        </div>
        <div className="flex justify-between">
          <span>Minimum receive ({slippageBps / 100}% slippage)</span>
          <span className="font-mono text-zinc-300">{minReceive ?? '—'} USDC</span>
        </div>
        <div className="flex justify-between">
          <span>Route</span>
          <span className="text-zinc-300">{quote?.route ?? 'STRK (Starknet) → USDC (Base)'}</span>
        </div>
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
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the live cross-chain quote…
        </div>
      )}
      {quoteError && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2 mt-3">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          {quoteError}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={
          disabled ||
          quoting ||
          !amount ||
          !destinationValid ||
          !quote ||
          parseAmountToBase(amount, STRK_DECIMALS) > privateBalance
        }
        className="w-full mt-4 py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500 hover:bg-emerald-400 text-black"
      >
        {activePhase ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Sending privately…
          </span>
        ) : (
          'Send Privately'
        )}
      </button>

      <p className="text-[11px] text-zinc-600 mt-3 flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Your wallet core signs the private proof. The viewing key, notes, and proofs never leave the
        privacy session; the shadow account funds the NEAR deposit; NEAR is routing only.
      </p>
    </section>
  );
};
