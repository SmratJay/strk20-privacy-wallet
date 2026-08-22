'use client';

import React, { useState, useEffect } from 'react';
import { Shield, Info, AlertCircle, Loader2 } from 'lucide-react';
import { TokenInfo, NOTE_MATURITY_BLOCKS } from '@/config/tokens';
import { ShieldedBalance } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';
import { strk20SdkService, getStrk20ViewingKey } from '@/services/strk20SdkService';
import { checkStrk20OperatorStatus, operatorStatusLabel, Strk20OperatorStatus } from '@/services/strk20OperatorHealth';

interface ShieldTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  onSuccess: (txHash: string, token: TokenInfo, amount: string) => void;
}

export const ShieldTab: React.FC<ShieldTabProps> = ({ balances, wallet, onSuccess }) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'IDLE' | 'APPROVING' | 'SHIELDING' | 'PROVING' | 'SUBMITTED'>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [operatorStatus, setOperatorStatus] = useState<Strk20OperatorStatus | null>(null);

  // Real STRK20 shield requires the operator proving + discovery services. Report
  // honest availability (HEALTHY / UNCONFIGURED / UNAVAILABLE) before allowing a deposit.
  useEffect(() => {
    checkStrk20OperatorStatus().then(setOperatorStatus).catch(() => setOperatorStatus(null));
  }, []);

  // Sync selected token when network changes
  useEffect(() => {
    const matching = currentNetwork.tokens.find(t => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const publicBal = currentBalance ? currentBalance.publicBalance : 0n;
  const operatorReady = !!operatorStatus?.healthy;

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

    // The canonical shield path is the REAL STRK20 SDK deposit (approve(pool) ->
    // pool.deposit -> encrypted note). A raw public ERC-20 transfer to the pool address
    // is NOT a valid shield and would strand the USDC with no claimable note.
    if (!operatorReady) {
      setError(
        `STRK20 operator services are not ready (${operatorStatus ? operatorStatusLabel(operatorStatus) : 'CHECKING'}). ` +
          'Shielding requires NEXT_PUBLIC_STRK20_PROVER_URL and NEXT_PUBLIC_STRK20_DISCOVERY_URL to point at running ' +
          'services (see infra/strk20-operator). No funds were moved.'
      );
      return;
    }

    setError(null);
    setStep('SHIELDING');

    try {
      const account = wallet.walletAccount?.signer
        ? wallet.walletAccount
        : wallet.rawWallet?.account || (window as any)?.starknet?.account;
      if (!account?.address) {
        throw new Error('STRK20 requires the wallet account — please reconnect your wallet.');
      }
      const address = account.address;
      const amountUsd = Number(amountBigInt) / 10 ** selectedToken.decimals;

      const viewingKey = await getStrk20ViewingKey(account);
      setStep('PROVING');

      const res = await strk20SdkService.shield(
        { account, address, viewingKey },
        amountUsd
      );

      if (res.status !== 'SUCCESS') {
        throw new Error(`Shield was not confirmed on-chain (status: ${res.status}). No note was created.`);
      }

      setStep('SUBMITTED');
      onSuccess(res.transactionHash, selectedToken, amount);
      setAmount('');
      setTimeout(() => setStep('IDLE'), 3000);
    } catch (err: any) {
      console.error('Shield error:', err);
      setError(err.message || 'Failed to shield tokens');
      setStep('IDLE');
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Shield className="w-4 h-4 text-orrange-400" />
            <span>Shield Tokens (Public → Private)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Deposit public ERC-20 into {currentNetwork.name} STRK20 pool as encrypted UTXO notes
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ DEPOSIT_GATE ]
        </span>
      </div>

      <form onSubmit={handleShield} className="space-y-4">
        {/* Token Selection & Amount */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>SELECT ASSET & AMOUNT</span>
            <span>
              Public Balance:{' '}
              <strong className="text-zinc-200">
                {formatTokenAmount(publicBal, selectedToken.decimals)} {selectedToken.symbol}
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
                  {t.icon} {t.symbol} - {t.name}
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

        {/* STRK20 Operator Readiness */}
        <div className={`p-3 text-[11px] border text-xs space-y-1 ${
          operatorReady
            ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300'
            : 'bg-amber-500/5 border-amber-500/30 text-amber-300'
        }`}>
          <div className="flex items-center gap-1.5 font-bold uppercase text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${operatorReady ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
            <span>STRK20 Operator: {operatorStatus ? operatorStatusLabel(operatorStatus) : 'CHECKING'}</span>
          </div>
          {!operatorReady && (
            <p className="text-[10px] opacity-90">
              Real shielding requires the operator proving + discovery services
              (NEXT_PUBLIC_STRK20_PROVER_URL / NEXT_PUBLIC_STRK20_DISCOVERY_URL). Until they are
              configured and reachable, no USDC will be sent and no note will be created.
            </p>
          )}
        </div>

        {/* Informational Box */}
        <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-white uppercase text-[10px]">
            <Info className="w-3.5 h-3.5 text-orrange-400" />
            <span>How Shielding Works:</span>
          </div>
          <p>
            1. Your wallet approves USDC and the STRK20 pool records an encrypted note owned by your viewing key.
          </p>
          <p>
            2. The operator prover generates the validity proof and the note becomes spendable on-chain.
          </p>
          <p className="text-amber-400">
            3. Note matures in ~{NOTE_MATURITY_BLOCKS} blocks for maximum anonymity set depth.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Button with Multi-step Feedback */}
        <button
          type="submit"
          disabled={step !== 'IDLE' || !amount || parseFloat(amount) <= 0}
          className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {step === 'APPROVING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 1/3: Approving ERC-20 Allowance...</span>
            </>
          )}
          {step === 'SHIELDING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 2/3: Building STRK20 shielded deposit...</span>
            </>
          )}
          {step === 'PROVING' && (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Step 3/3: Generating Stwo ZK Witness & Submitting...</span>
            </>
          )}
          {step === 'SUBMITTED' && <span>✓ Note Submitted — verify via discovery</span>}
          {step === 'IDLE' && <span>Shield Tokens (Deposit)</span>}
        </button>
      </form>
    </div>
  );
};
