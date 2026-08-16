'use client';

import React, { useState, useEffect } from 'react';
import { ArrowDownLeft, Info, AlertCircle, Loader2 } from 'lucide-react';
import { TokenInfo } from '@/config/tokens';
import { ShieldedBalance, privacyService } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount, shortenAddress } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';

interface UnshieldTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  onSuccess: (txHash: string, token: TokenInfo, amount: string, destination: string) => void;
}

export const UnshieldTab: React.FC<UnshieldTabProps> = ({
  balances,
  wallet,
  onSuccess,
}) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'IDLE' | 'PROVING' | 'SUBMITTING'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  // Sync selected token when network changes
  useEffect(() => {
    const matching = currentNetwork.tokens.find(t => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;

  const handleMax = () => {
    if (shieldedBal > 0n) {
      setAmount(formatTokenAmount(shieldedBal, selectedToken.decimals, 6));
    }
  };

  const handleFillSelf = () => {
    if (wallet.address) {
      setDestination(wallet.address);
    }
  };

  const handleUnshield = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected) {
      setError('Please connect your wallet first');
      return;
    }

    if (!destination.trim()) {
      setError('Please enter a destination Starknet address');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid amount');
      return;
    }

    if (amountBigInt > shieldedBal) {
      setError(`Insufficient shielded ${selectedToken.symbol} balance`);
      return;
    }

    setError(null);
    setStep('PROVING');

    try {
      const { txHash } = await privacyService.executeUnshield(
        wallet.walletAccount,
        selectedToken,
        destination.trim(),
        amountBigInt,
        (currentStep) => setStep(currentStep),
        currentNetwork.poolAddress,
        currentNetwork.id
      );

      onSuccess(txHash, selectedToken, amount, destination);
      setAmount('');
      setStep('IDLE');
    } catch (err: any) {
      console.error('Unshield error:', err);
      setError(err.message || 'Failed to unshield tokens');
      setStep('IDLE');
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-amber-400" />
            <span>Unshield Tokens (Private → Public)</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Withdraw private {currentNetwork.name} pool notes back to any public Starknet address
          </p>
        </div>
      </div>

      <form onSubmit={handleUnshield} className="space-y-4">
        {/* Destination Address */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Destination Public Address</span>
            {wallet.address && (
              <button
                type="button"
                onClick={handleFillSelf}
                className="text-[11px] text-sky-400 hover:underline"
              >
                Use Connected ({shortenAddress(wallet.address, 3)})
              </button>
            )}
          </div>
          <input
            type="text"
            placeholder="0x..."
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={step !== 'IDLE'}
            className="w-full bg-surface border border-surface-border text-white text-xs font-mono rounded-xl px-3 py-2.5 outline-none focus:border-amber-500 transition-colors"
          />
        </div>

        {/* Asset & Amount */}
        <div className="p-4 rounded-xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Asset & Shielded Amount</span>
            <span>
              Shielded Balance:{' '}
              <strong className="text-amber-400 font-mono">
                {formatTokenAmount(shieldedBal, selectedToken.decimals)} {selectedToken.symbol}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Token Selector */}
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="bg-surface border border-surface-border text-white text-sm font-semibold rounded-xl px-3 py-2.5 outline-none focus:border-amber-500 transition-colors"
            >
              {currentNetwork.tokens.map((t) => (
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
                className="w-full bg-surface border border-surface-border text-white text-base font-mono rounded-xl px-3 py-2 outline-none focus:border-amber-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={step !== 'IDLE'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-400 hover:text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        {/* Public disclosure */}
        <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/20 text-xs text-amber-200/80 flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p>
              <strong>Notice:</strong> The unshield leg transfers tokens out of the pool to the destination address. Observers will see the pool paid this address, but your past transfers remain unlinked.
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
          disabled={step !== 'IDLE' || !amount || !destination}
          className="w-full py-3.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2 transition-all"
        >
          {step !== 'IDLE' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {step === 'PROVING' && 'Proving nullifier & withdrawal...'}
                {step === 'SUBMITTING' && 'Executing pool withdrawal...'}
              </span>
            </>
          ) : (
            <>
              <ArrowDownLeft className="w-4 h-4" />
              <span>Unshield to Public Address</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
