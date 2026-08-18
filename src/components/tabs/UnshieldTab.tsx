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
        (currentStep: any) => setStep(currentStep),
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
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <ArrowDownLeft className="w-4 h-4 text-orrange-400" />
            <span>Unshield Tokens (Private → Public)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Withdraw encrypted UTXO notes to any public Starknet address via relayer
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ UNLINKABLE_EXIT ]
        </span>
      </div>

      <form onSubmit={handleUnshield} className="space-y-4">
        {/* Token & Amount */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>SELECT ASSET & AMOUNT</span>
            <span>
              Shielded Balance:{' '}
              <strong className="text-orrange-400">
                {formatTokenAmount(shieldedBal, selectedToken.decimals)} {selectedToken.symbol}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 text-white font-bold text-xs outline-none cursor-pointer"
            >
              {currentNetwork.tokens.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>

            <div className="relative flex-1">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={step !== 'IDLE'}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-sm outline-none"
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={step !== 'IDLE'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
              >
                [MAX]
              </button>
            </div>
          </div>
        </div>

        {/* Destination Public Address */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>DESTINATION STARKNET ADDRESS</span>
            {wallet.address && (
              <button
                type="button"
                onClick={handleFillSelf}
                className="text-[10px] text-orrange-400 hover:underline uppercase font-bold"
              >
                [Use My Connected Wallet]
              </button>
            )}
          </div>

          <input
            type="text"
            placeholder="0x... (Recipient Public Address)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={step !== 'IDLE'}
            className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-mono text-xs outline-none"
          />
        </div>

        {/* Informational Box */}
        <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-white uppercase text-[10px]">
            <Info className="w-3.5 h-3.5 text-orrange-400" />
            <span>Unshielding Guarantee:</span>
          </div>
          <p>
            1. The relayer invokes the withdrawal on Starknet — the public blockchain only sees funds leaving the pool.
          </p>
          <p>
            2. There is <strong className="text-white">NO cryptographic link</strong> between your deposit address and this withdrawal address.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Button */}
        <button
          type="submit"
          disabled={step !== 'IDLE' || !amount || parseFloat(amount) <= 0 || !destination}
          className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {step === 'PROVING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 1/2: Generating Nullifier Proof...</span>
            </>
          )}
          {step === 'SUBMITTING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 2/2: Relayer Withdrawing Public ERC-20...</span>
            </>
          )}
          {step === 'IDLE' && <span>Unshield to Public Address</span>}
        </button>
      </form>
    </div>
  );
};
