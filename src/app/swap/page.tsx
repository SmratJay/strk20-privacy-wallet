'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  Loader2,
  Shield,
  Globe,
  CheckCircle2,
  X,
  ShieldAlert,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import {
  getSwapQuote,
  buildPublicSwapCalls,
  publicSwapSupported,
  privateSwapSupported,
} from '@/services/swapService';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';

const PUBLIC_SLIPPAGE = 0.01; // 1%

type Step = 'QUOTING' | 'BUILDING' | 'SIGNING' | 'SUBMITTING' | 'DONE';

/**
 * Swap — Wallet Core only. Public swaps are signed by the Wallet Core local signer
 * (`runtime.send`). Private STRK20 swaps are NOT supported by Wallet Core yet and are shown as
 * explicitly unavailable (never a silent fallback to another wallet).
 */
export default function SwapPage() {
  const { runtime, state } = useWalletRuntime();
  const account = state.account;

  const tokens = SEPOLIA_TOKENS;
  const [sellAddr, setSellAddr] = useState<string>(() => tokens[0]?.address ?? '');
  const [buyAddr, setBuyAddr] = useState<string>(() => tokens[1]?.address ?? tokens[0]?.address ?? '');
  const [sellAmount, setSellAmount] = useState('');
  const [quote, setQuote] = useState<{ buyAmount: string; routes: string[]; gasFeeStrk: string } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sellToken = tokens.find((t) => t.address.toLowerCase() === sellAddr.toLowerCase()) ?? tokens[0];
  const buyToken = tokens.find((t) => t.address.toLowerCase() === buyAddr.toLowerCase()) ?? tokens[1];

  const publicBalance = useMemo(() => {
    const row = state.publicBalances.find((b) => b.token.address.toLowerCase() === sellAddr.toLowerCase());
    return row?.available ? row.balance : 0n;
  }, [state.publicBalances, sellAddr]);

  const connected = Boolean(account);

  const refreshQuote = useCallback(async () => {
    if (!connected || !account || !sellAmount || parseFloat(sellAmount) <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const res = await getSwapQuote(state.network, sellToken, buyToken, sellAmount, account.address);
      if (!res) {
        setQuoteError(
          state.network === 'sepolia'
            ? 'No quote found — AVNU currently has no liquidity on Sepolia.'
            : 'No quote found for this pair. Try a different token or amount.',
        );
        return;
      }
      setQuote({ buyAmount: res.buyAmount, routes: res.routes, gasFeeStrk: res.gasFeeStrk });
    } catch (err: any) {
      setQuoteError(err?.message || 'Could not fetch a quote.');
    } finally {
      setQuoting(false);
    }
  }, [connected, account, sellAmount, state.network, sellToken, buyToken]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const execute = async () => {
    if (!connected || !account) return;
    setError(null);
    setTxHash(null);

    let currentQuote: Awaited<ReturnType<typeof getSwapQuote>> | null = null;
    try {
      setStep('QUOTING');
      currentQuote = await getSwapQuote(state.network, sellToken, buyToken, sellAmount, account.address);
      if (!currentQuote) {
        setError(
          state.network === 'sepolia'
            ? 'No quote found — AVNU currently has no liquidity on Sepolia.'
            : 'No quote found for this pair.',
        );
        setStep(null);
        return;
      }
    } catch (err: any) {
      setError(err?.message || 'Could not fetch a quote.');
      setStep(null);
      return;
    }

    try {
      setStep('BUILDING');
      const calls = await buildPublicSwapCalls(state.network, currentQuote.quote, PUBLIC_SLIPPAGE, account.address);
      setStep('SIGNING');
      const res = await runtime.send(calls);
      setStep('SUBMITTING');
      setTxHash(res.transactionHash);
      setStep('DONE');
      void runtime.refreshPublicBalances();
    } catch (err: any) {
      setError(err?.message || 'Swap failed.');
      setStep(null);
    }
  };

  const setMax = () => {
    if (publicBalance > 0n) setSellAmount(formatTokenAmount(publicBalance, sellToken.decimals, sellToken.decimals));
  };

  const insufficient = sellAmount.length > 0 && parseTokenAmount(sellAmount, sellToken.decimals) > publicBalance;

  const switchTokens = () => {
    setSellAddr(buyAddr);
    setBuyAddr(sellAddr);
  };

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / SWAP</div>
            <h1 className="product-page-title">Swap quietly</h1>
            <p className="product-page-description">
              Public swap — Wallet Core balance → AVNU → Wallet Core balance.
            </p>
          </div>
        </div>

        {!connected ? (
          <WalletCoreGate />
        ) : (
          <>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 mb-4 flex items-start gap-2 text-[12px] text-violet-200/80">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-violet-300" />
              <span>
                Public swaps are signed by your Orrange wallet. STRK20 private swaps are not yet
                supported by Wallet Core — they are never routed to another wallet.
              </span>
            </div>

            <div className="product-swap-card border border-zinc-800 bg-zinc-950/60 rounded-2xl p-4 space-y-4">
              {/* Sell */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>You pay</span>
                  <button onClick={setMax} className="hover:text-zinc-200">
                    Max: {formatTokenAmount(publicBalance, sellToken.decimals, 4)} {sellToken.symbol}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                    placeholder="0.0"
                    className="product-swap-input flex-1 bg-transparent text-2xl font-semibold text-zinc-100 outline-none placeholder:text-zinc-700"
                  />
                  <select
                    value={sellAddr}
                    onChange={(e) => setSellAddr(e.target.value)}
                    className="product-token-select bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 outline-none"
                  >
                    {tokens.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.icon} {t.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Switch */}
              <div className="flex justify-center">
                <button
                  onClick={switchTokens}
                  className="w-9 h-9 rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 flex items-center justify-center"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>

              {/* Buy */}
              <div className="space-y-2">
                <div className="text-[11px] text-zinc-500">You receive</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-2xl font-semibold text-zinc-100">
                    {quote ? quote.buyAmount : '—'}
                    <span className="ml-2 text-sm text-zinc-500">{buyToken.symbol}</span>
                  </div>
                  <select
                    value={buyAddr}
                    onChange={(e) => setBuyAddr(e.target.value)}
                    className="product-token-select bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 outline-none"
                  >
                    {tokens.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.icon} {t.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {quoting && (
                <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching quote…
                </div>
              )}
              {quote && !quoting && (
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span>{quote.routes.join(' → ')}</span>
                  <span>·</span>
                  <span>gas ~{quote.gasFeeStrk} STRK</span>
                </div>
              )}
              {quoteError && (
                <div className="flex items-start gap-2 text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-2">
                  <X className="w-4 h-4 shrink-0 mt-0.5" />
                  {quoteError}
                </div>
              )}
              {insufficient && !error && (
                <p className="text-[12px] text-rose-400">Insufficient public balance.</p>
              )}
            </div>

            <button
              onClick={() => void execute()}
              disabled={!connected || quoting || step !== null || !sellAmount || parseFloat(sellAmount) <= 0 || insufficient}
              className={`w-full mt-4 py-3.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                'bg-emerald-500 hover:bg-emerald-400 text-black'
              }`}
            >
              {step === 'QUOTING' || step === 'BUILDING' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Building swap…
                </span>
              ) : step === 'SIGNING' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Signing with Orrange wallet…
                </span>
              ) : step === 'SUBMITTING' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                </span>
              ) : step === 'DONE' ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Submitted
                </span>
              ) : (
                'Public swap'
              )}
            </button>

            {txHash && (
              <div className="flex items-center justify-between text-[12px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-3 break-all mt-3">
                <span>{txHash}</span>
              </div>
            )}

            {error && (
              <div className="text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3 break-words mt-3">
                {error}
              </div>
            )}

            <p className="text-[11px] text-zinc-600 mt-3">
              Public swaps use your on-chain balance and pay gas from your wallet.
              {state.network === 'sepolia' && ' AVNU currently has no liquidity on Sepolia.'}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

void publicSwapSupported;
void privateSwapSupported;
void Globe;
void Shield;