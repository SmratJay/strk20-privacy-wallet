'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  Loader2,
  Shield,
  Globe,
  CheckCircle2,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { ConnectGate } from '@/components/wallet/ConnectGate';
import { useWallet } from '@/context/WalletContext';
import {
  getSwapQuote,
  executePublicSwap,
  executePrivateSwapFlow,
  networkIdFromChainId,
} from '@/services/swapService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';

const PUBLIC_SLIPPAGE = 0.01; // 1%
const PRIVATE_SLIPPAGE = 0.03; // 3%

type SwapMode = 'PUBLIC' | 'PRIVATE';
type Step = 'QUOTING' | 'BUILDING' | 'SIGNING' | 'SUBMITTING' | 'DONE';

export default function SwapPage() {
  const { wallet, balances, currentNetwork, isSepolia, networkId, refreshAfterMutation } = useWallet();

  const tokens = currentNetwork.tokens;
  const [mode, setMode] = useState<SwapMode>('PUBLIC');
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

  const balanceRow = useMemo(
    () => balances.find((b) => b.token.address.toLowerCase() === sellAddr.toLowerCase()),
    [balances, sellAddr],
  );

  const publicBalance = balanceRow?.publicBalance ?? 0n;
  const shieldedBalance = balanceRow?.shieldedBalance ?? 0n;
  const shieldedAvailable = balanceRow?.shieldedBalanceAvailable === true;

  const connected = wallet.isConnected;
  const privyOnly = !wallet.isPrivacySupported; // Ready (STRK20) wallet not connected
  const privateCapable = connected && !privyOnly;
  const walletChain = networkIdFromChainId(wallet.chainId);
  const walletOnAppNetwork = walletChain === networkId;

  const refreshQuote = useCallback(async () => {
    if (!connected || !wallet.address || !sellAmount || parseFloat(sellAmount) <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const res = await getSwapQuote(networkId, sellToken, buyToken, sellAmount, wallet.address);
      if (!res) {
        setQuoteError(
          isSepolia
            ? 'No quote found — AVNU currently has no liquidity on Sepolia. Switch your wallet to Mainnet to swap.'
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
  }, [connected, wallet.address, sellAmount, networkId, sellToken, buyToken, isSepolia]);

  useEffect(() => {
    void refreshQuote();
  }, [refreshQuote]);

  const execute = async () => {
    if (!connected || !wallet.address) return;
    setError(null);
    setTxHash(null);

    let currentQuote: Awaited<ReturnType<typeof getSwapQuote>> | null = null;
    try {
      setStep('QUOTING');
      currentQuote = await getSwapQuote(networkId, sellToken, buyToken, sellAmount, wallet.address);
      if (!currentQuote) {
        setError(
          isSepolia
            ? 'No quote found — AVNU currently has no liquidity on Sepolia. Switch to Mainnet to swap.'
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
      let hash: string;
      if (mode === 'PUBLIC') {
        setStep('SIGNING');
        const res = await executePublicSwap(
          wallet.walletAccount || wallet.rawWallet,
          networkId,
          currentQuote.quote,
          PUBLIC_SLIPPAGE,
        );
        hash = res.transactionHash;
      } else {
        setStep('SIGNING');
        const res = await executePrivateSwapFlow({
          wallet,
          networkId,
          quote: currentQuote.quote,
          slippage: PRIVATE_SLIPPAGE,
          takerAddress: wallet.address,
          poolAddress: currentNetwork.poolAddress,
          poolFeeToken: sellToken.address,
        });
        hash = res.transactionHash;
      }
      setStep('SUBMITTING');
      setTxHash(hash);
      setStep('DONE');
      await refreshAfterMutation();
    } catch (err: any) {
      setError(err?.message || 'Swap failed.');
      setStep(null);
    }
  };

  const setMax = () => {
    const bal = mode === 'PRIVATE' ? shieldedBalance : publicBalance;
    if (bal > 0n) setSellAmount(formatTokenAmount(bal, sellToken.decimals, sellToken.decimals));
  };

  const availableBalance = mode === 'PRIVATE' ? shieldedBalance : publicBalance;
  const balanceText = mode === 'PRIVATE'
    ? shieldedAvailable ? formatTokenAmount(shieldedBalance, sellToken.decimals, 4) : '—'
    : formatTokenAmount(publicBalance, sellToken.decimals, 4);
  const insufficient = sellAmount.length > 0 && parseTokenAmount(sellAmount, sellToken.decimals) > availableBalance;

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
            {mode === 'PUBLIC'
              ? 'Public swap — wallet balance → AVNU → wallet balance.'
              : 'Private swap — STRK20 shielded balance → AVNU executor → shielded balance.'}
            </p>
          </div>
        </div>

        {!connected ? (
          <ConnectGate />
        ) : (
          <>
            {!walletOnAppNetwork && (
              <div className="flex items-center gap-2 text-[12px] text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-lg p-3">
                <Globe className="w-4 h-4" />
                Your wallet is on a different network. Switch it to {currentNetwork.label} for swaps.
              </div>
            )}

            {/* Mode toggle */}
            <div className="product-swap-mode grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('PUBLIC')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  mode === 'PUBLIC'
                    ? 'bg-zinc-100 text-black border-zinc-100'
                    : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Globe className="w-4 h-4" /> Public
              </button>
              <button
                onClick={() => setMode('PRIVATE')}
                disabled={!privateCapable}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  mode === 'PRIVATE'
                    ? 'bg-violet-500 text-white border-violet-500'
                    : privyOnly
                      ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                      : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Shield className="w-4 h-4" /> Private
              </button>
            </div>

            {mode === 'PRIVATE' && privyOnly && (
              <p className="text-[12px] text-zinc-500">
                Private swaps need a STRK20-capable wallet. Connect Ready Wallet to unlock the private path.
              </p>
            )}

            <div className="product-swap-card border border-zinc-800 bg-zinc-950/60 rounded-2xl p-4 space-y-4">
              {/* Sell */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>You pay</span>
                  <button onClick={setMax} className="hover:text-zinc-200">
                    Max: {balanceText} {sellToken.symbol}
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
                <p className="text-[12px] text-rose-400">
                  Insufficient {mode === 'PRIVATE' ? 'shielded' : 'public'} balance.
                </p>
              )}
            </div>

            <button
              onClick={() => void execute()}
              disabled={!connected || quoting || step !== null || !sellAmount || parseFloat(sellAmount) <= 0 || insufficient}
              className={`w-full py-3.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === 'PRIVATE'
                  ? 'bg-violet-500 hover:bg-violet-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black'
              }`}
            >
              {step === 'QUOTING' || step === 'BUILDING' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Building swap…
                </span>
              ) : step === 'SIGNING' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Signing in wallet…
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
                `${mode === 'PRIVATE' ? 'Private' : 'Public'} swap`
              )}
            </button>

            {txHash && (
              <div className="flex items-center justify-between text-[12px] font-mono text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-lg p-3 break-all">
                <span>{txHash}</span>
                <a
                  href={`${currentNetwork.explorerUrl}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 shrink-0 text-emerald-300 underline"
                >
                  View
                </a>
              </div>
            )}

            {error && (
              <div className="text-[12px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded-lg p-3 break-words">
                {error}
              </div>
            )}

            <p className="text-[11px] text-zinc-600">
              {mode === 'PRIVATE'
                ? 'Private swaps are gas-sponsored by AVNU: the executor swaps inside the privacy pool and the output returns as a new shielded note. A STRK20-capable wallet (Ready) signs the proof; AVNU relays it.'
                : 'Public swaps use your on-chain balance and pay gas from your wallet.'}
              {isSepolia && ' AVNU currently has no liquidity on Sepolia — switch your wallet to Mainnet to swap.'}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
