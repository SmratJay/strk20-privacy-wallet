'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, Sparkles, AlertCircle, Loader2, Info, CheckCircle2 } from 'lucide-react';
import { MAINNET_TOKENS, TokenInfo } from '@/config/tokens';
import { ShieldedBalance } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';
import { avnuService, SwapQuoteResult } from '@/services/avnuService';

interface SwapTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  onSuccess: (txHash: string, fromToken: TokenInfo, toToken: TokenInfo, amount: string) => void;
}

export const SwapTab: React.FC<SwapTabProps> = ({ balances, wallet, onSuccess }) => {
  const [fromToken, setFromToken] = useState<TokenInfo>(MAINNET_TOKENS[0]); // STRK
  const [toToken, setToToken] = useState<TokenInfo>(MAINNET_TOKENS[2]); // USDC
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<SwapQuoteResult | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentBalance = balances.find((b) => b.token.symbol === fromToken.symbol);
  const publicBal = currentBalance ? currentBalance.publicBalance : 0n;
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;
  const availableBal = shieldedBal > 0n ? shieldedBal : publicBal;

  const handleMax = () => {
    if (availableBal > 0n) {
      setAmount(formatTokenAmount(availableBal, fromToken.decimals, 6));
    }
  };

  // Debounced real-time quote fetcher via AVNU SDK
  useEffect(() => {
    let active = true;
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    setIsLoadingQuote(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await avnuService.getPrivateSwapQuote(
          fromToken,
          toToken,
          amount,
          wallet.address || undefined
        );
        if (active) {
          setQuote(res);
        }
      } catch (err: any) {
        console.warn('Quote error:', err);
        if (active) setError(err.message || 'Could not fetch quote');
      } finally {
        if (active) setIsLoadingQuote(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [fromToken, toToken, amount, wallet.address]);

  const handleSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, fromToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid swap amount');
      return;
    }

    if (amountBigInt > availableBal) {
      setError(`Insufficient ${fromToken.symbol} balance`);
      return;
    }

    setError(null);
    setIsSwapping(true);

    try {
      if (!quote?.rawQuote) {
        // Fetch fresh quote if missing
        const freshQuote = await avnuService.getPrivateSwapQuote(
          fromToken,
          toToken,
          amount,
          wallet.address || undefined
        );
        if (!freshQuote?.rawQuote) {
          throw new Error('Could not obtain live AVNU DEX quote for trade execution');
        }
        const { txHash } = await avnuService.executeRealSwap(
          wallet.walletAccount,
          freshQuote.rawQuote,
          0.01 // 1% max slippage
        );
        setIsSwapping(false);
        onSuccess(txHash, fromToken, toToken, amount);
        setAmount('');
        return;
      }

      // Execute on-chain via connected wallet account
      const { txHash } = await avnuService.executeRealSwap(
        wallet.walletAccount,
        quote.rawQuote,
        0.01
      );

      setIsSwapping(false);
      onSuccess(txHash, fromToken, toToken, amount);
      setAmount('');
    } catch (err: any) {
      console.error('AVNU Swap Execution Error:', err);
      setError(err.message || 'DEX swap failed during transaction submission');
      setIsSwapping(false);
    }
  };

  const handleSwitch = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
  };

  return (
    <div className="max-w-xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <span>Private Swap (AVNU SDK Router)</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Real-time Starknet DEX routing through AVNU aggregator with private note settlement
          </p>
        </div>
      </div>

      <form onSubmit={handleSwap} className="space-y-3">
        {/* Sell Asset */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>You Sell</span>
            <span>
              Available:{' '}
              <strong className="text-purple-400 font-mono">
                {formatTokenAmount(availableBal, fromToken.decimals)} {fromToken.symbol}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={fromToken.symbol}
              onChange={(e) => {
                const found = MAINNET_TOKENS.find((t) => t.symbol === e.target.value);
                if (found) setFromToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2 outline-none"
            >
              {MAINNET_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>
            <div className="relative flex-1">
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isSwapping}
                className="w-full bg-surface border border-surface-border text-white text-base font-mono rounded-xl px-3 py-2 outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={isSwapping}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-purple-400 hover:text-purple-300 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        {/* Switch Button */}
        <div className="flex justify-center -my-1 relative z-10">
          <button
            type="button"
            onClick={handleSwitch}
            className="p-2 rounded-xl bg-surface-elevated border border-surface-border hover:bg-surface-border text-zinc-300 transition-colors shadow-md"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>

        {/* Buy Asset */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>You Receive (Estimated)</span>
            {isLoadingQuote && <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={toToken.symbol}
              onChange={(e) => {
                const found = MAINNET_TOKENS.find((t) => t.symbol === e.target.value);
                if (found) setToToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2 outline-none"
            >
              {MAINNET_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>
            <div className="flex-1 bg-surface border border-surface-border text-zinc-200 text-base font-mono font-semibold rounded-xl px-3 py-2">
              {quote ? quote.buyAmount : '0.00'}
            </div>
          </div>
        </div>

        {/* Live Route & Rate Details */}
        {quote && (
          <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border text-xs space-y-1.5 font-mono">
            <div className="flex justify-between text-zinc-400">
              <span>Exchange Rate</span>
              <span className="text-zinc-200">
                1 {fromToken.symbol} ≈ {quote.priceRatio.toFixed(4)} {toToken.symbol}
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>AVNU DEX Routes</span>
              <span className="text-purple-400">{quote.routes.join(' → ')}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Estimated Gas Fee</span>
              <span className="text-zinc-300">~{quote.estimatedGasFeeStrk} STRK</span>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/20 text-xs text-purple-200/80 flex items-start gap-2">
          <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div>
            <p>
              AVNU aggregates Starknet DEX liquidity (Ekubo, JediSwap, 10kSwap). Open notes allow output tokens to be credited into your STRK20 channel without public recipient linkage.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSwapping || !amount || !wallet.isConnected}
          className="w-full py-3.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-purple-600/20 flex items-center justify-center gap-2 transition-all"
        >
          {isSwapping ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Submitting Multi-Call Swap to Starknet...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>{wallet.isConnected ? 'Execute Swap via AVNU' : 'Connect Wallet to Swap'}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
