'use client';

import React, { useState } from 'react';
import { Shield, ArrowDown, Info, AlertCircle, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';
import { MAINNET_TOKENS, TokenInfo, NOTE_MATURITY_BLOCKS } from '@/config/tokens';
import { ShieldedBalance, privacyService } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';

interface ShieldTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  onSuccess: (txHash: string, token: TokenInfo, amount: string) => void;
}

export const ShieldTab: React.FC<ShieldTabProps> = ({ balances, wallet, onSuccess }) => {
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(MAINNET_TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'IDLE' | 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const publicBal = currentBalance ? currentBalance.publicBalance : 0n;

  const handleMax = () => {
    if (publicBal > 0n) {
      setAmount(formatTokenAmount(publicBal, selectedToken.decimals, 6));
    }
  };

  const handleShield = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid amount');
      return;
    }

    if (amountBigInt > publicBal) {
      setError(`Insufficient public ${selectedToken.symbol} balance`);
      return;
    }

    setError(null);
    setStep('APPROVING');

    try {
      const { txHash } = await privacyService.executeShield(
        wallet.walletAccount,
        selectedToken,
        amountBigInt,
        (currentStep) => setStep(currentStep)
      );

      setStep('SUBMITTED');
      onSuccess(txHash, selectedToken, amount);
      setAmount('');
      setTimeout(() => setStep('IDLE'), 3000);
    } catch (err: any) {
      console.error('Shield error:', err);
      setError(err.message || 'Failed to shield tokens');
      setStep('IDLE');
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-400" />
            <span>Shield Tokens (Public → Private)</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Deposit public ERC-20 into the STRK20 Privacy Pool as encrypted notes
          </p>
        </div>
      </div>

      <form onSubmit={handleShield} className="space-y-4">
        {/* Token Selection & Amount */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Select Asset & Amount</span>
            <span>
              Public Balance:{' '}
              <strong className="text-zinc-200">
                {formatTokenAmount(publicBal, selectedToken.decimals)} {selectedToken.symbol}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Token Selector */}
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = MAINNET_TOKENS.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2.5 outline-none focus:border-sky-500 transition-colors"
            >
              {MAINNET_TOKENS.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>

            {/* Input */}
            <div className="relative flex-1">
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step !== 'IDLE'}
                className="w-full bg-surface border border-surface-border text-white text-base font-mono rounded-xl px-3 py-2 outline-none focus:border-sky-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={step !== 'IDLE'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-sky-400 hover:text-sky-300 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        {/* 2-Step Progress Indicator */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-surface-border text-xs space-y-2">
          <div className="font-semibold text-zinc-300 flex items-center justify-between">
            <span>Two-Step Transaction Flow:</span>
            <span className="text-[11px] text-zinc-400 font-mono">FPI Screening Active</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className={`p-2 rounded-lg border flex items-center gap-2 ${
              step === 'APPROVING' 
                ? 'bg-sky-500/10 border-sky-500 text-sky-300' 
                : 'bg-surface border-surface-border text-zinc-400'
            }`}>
              {step === 'APPROVING' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 flex items-center justify-center text-[9px]">1</div>}
              <span>1. ERC-20 Approve</span>
            </div>

            <div className={`p-2 rounded-lg border flex items-center gap-2 ${
              step === 'SHIELDING' || step === 'PROVING'
                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300'
                : 'bg-surface border-surface-border text-zinc-400'
            }`}>
              {step === 'SHIELDING' || step === 'PROVING' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <div className="w-3.5 h-3.5 rounded-full border border-zinc-500 flex items-center justify-center text-[9px]">2</div>}
              <span>2. Deposit to Pool</span>
            </div>
          </div>
        </div>

        {/* Honest Privacy Disclosure */}
        <div className="p-3 rounded-xl bg-sky-950/20 border border-sky-500/20 text-xs text-sky-200/80 flex items-start gap-2">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong>What stays visible:</strong> The deposit amount and your public account address are visible during the initial ERC-20 transfer.
            </p>
            <p className="mt-1">
              <strong>What becomes private:</strong> The resulting note inside the STRK20 pool is 100% encrypted and spendable only with your viewing key. Notes mature after ~{NOTE_MATURITY_BLOCKS} blocks.
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
          disabled={step !== 'IDLE' || !amount}
          className="w-full py-3.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2 transition-all"
        >
          {step !== 'IDLE' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {step === 'APPROVING' && 'Waiting for Approval signature...'}
                {step === 'SHIELDING' && 'Depositing into Privacy Pool...'}
                {step === 'PROVING' && 'Generating Zero-Knowledge Proof...'}
                {step === 'SUBMITTED' && 'Deposit Confirmed!'}
              </span>
            </>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              <span>Shield {selectedToken.symbol}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
