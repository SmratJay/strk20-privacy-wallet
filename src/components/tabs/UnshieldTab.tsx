'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowDownLeft, Info, AlertCircle, Loader2, Wallet } from 'lucide-react';
import { TokenInfo } from '@/config/tokens';
import { ShieldedBalance } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';
import {
  strk20WalletApiService,
  WalletApiStatus,
  WalletBalancePermission,
  translateWalletError,
} from '@/services/strk20WalletApiService';
import {
  Strk20WalletLaneGate,
  isWalletLaneReady,
  PrivateBalanceAccessNote,
} from '@/components/terminal/Strk20WalletLaneGate';

interface UnshieldTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  privateBalancePermission?: WalletBalancePermission;
  onRequestPrivateBalanceAccess?: () => void;
  onSuccess: (txHash: string, token: TokenInfo, amount: string, destination: string) => void;
}

type TxPhase =
  | 'IDLE'
  | 'PREPARING'
  | 'WALLET_APPROVAL'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'COMPLETE'
  | 'FAILED';

export const UnshieldTab: React.FC<UnshieldTabProps> = ({
  balances,
  wallet,
  privateBalancePermission = 'UNKNOWN',
  onRequestPrivateBalanceAccess,
  onSuccess,
}) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<TxPhase>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletApiStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await strk20WalletApiService.getWalletApiStatus(wallet));
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, [wallet]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Sync selected token when network changes
  useEffect(() => {
    const matching = currentNetwork.tokens.find((t) => t.symbol === selectedToken.symbol) || currentNetwork.tokens[0];
    setSelectedToken(matching);
  }, [currentNetwork]);

  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;
  const shieldedBalAvailable = currentBalance?.shieldedBalanceAvailable === true;
  const ready = isWalletLaneReady(status);

  const handleMax = () => {
    if (shieldedBalAvailable && shieldedBal > 0n) {
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
    if (!ready) return;

    if (!destination.trim()) {
      setError('Please enter a destination Starknet address');
      return;
    }
    try {
      BigInt(destination);
    } catch {
      setError('Please enter a valid destination Starknet address.');
      return;
    }

    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) {
      setError('Enter a valid amount');
      return;
    }

    if (shieldedBalAvailable && amountBigInt > shieldedBal) {
      setError(`Insufficient private ${selectedToken.symbol} balance`);
      return;
    }

    setError(null);
    setPhase('PREPARING');

    try {
      // The privacy wallet performs the private withdrawal + proof.
      setPhase('WALLET_APPROVAL');
      const receipt = await strk20WalletApiService.unshield(
        wallet,
        selectedToken.address,
        amountBigInt,
        destination.trim(),
      );
      setTxHash(receipt.transactionHash);
      setPhase('SUBMITTED');

      const reconcile = await strk20WalletApiService.waitForStrk20Confirmation(
        receipt.transactionHash,
      );
      if (reconcile === 'CONFIRMED') {
        setPhase('COMPLETE');
        onSuccess(receipt.transactionHash, selectedToken, amount, destination);
        setAmount('');
      } else if (reconcile === 'REVERTED') {
        setPhase('FAILED');
        setError('The unshield transaction reverted on-chain.');
      } else {
        setPhase('SUBMITTED');
      }
    } catch (err: any) {
      const t = translateWalletError(err, { asset: selectedToken.symbol });
      setError(t.userMessage);
      setPhase('FAILED');
    }
  };

  const busy = phase !== 'IDLE' && phase !== 'FAILED' && phase !== 'COMPLETE';

  return (
    <div className="max-w-xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <ArrowDownLeft className="w-4 h-4 text-orrange-400" />
            <span>Unshield Tokens (Private → Public)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Privacy wallet · Wallet API · STRK20 withdrawal
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ WALLET_LANE ]
        </span>
      </div>

      <Strk20WalletLaneGate status={status} checking={checking} />

      {ready && (
        <form onSubmit={handleUnshield} className="space-y-4">
          <PrivateBalanceAccessNote
            permission={privateBalancePermission}
            onRequest={onRequestPrivateBalanceAccess ?? (() => {})}
          />
          <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>SELECT ASSET & AMOUNT</span>
              <span>
                Private Balance:{' '}
                <strong className="text-orrange-400">
                  {shieldedBalAvailable
                    ? `${formatTokenAmount(shieldedBal, selectedToken.decimals)} ${selectedToken.symbol}`
                    : '—'}
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
                  disabled={busy}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={busy}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-orrange-400 hover:underline uppercase"
                >
                  [MAX]
                </button>
              </div>
            </div>
          </div>

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
              placeholder="0x… (public recipient address)"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={busy}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white font-mono text-xs outline-none"
            />
          </div>

          <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-white uppercase text-[10px]">
              <Info className="w-3.5 h-3.5 text-orrange-400" />
              <span>Unshielding:</span>
            </div>
            <p>Your wallet builds the private withdrawal + proof and submits it to Starknet.</p>
            <p>Deposit/withdrawal amounts are public (they are the ERC-20 legs).</p>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {txHash && (phase === 'SUBMITTED' || phase === 'CONFIRMING') && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
              Submitted — awaiting on-chain confirmation. Proof generation happens in your
              wallet, so this can take longer than a normal transaction. Explorer:{' '}
              <a
                href={`https://sepolia.voyager.online/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline break-all"
              >
                {txHash.slice(0, 18)}…
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !amount || parseFloat(amount) <= 0 || !destination}
            className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {phase === 'PREPARING' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Preparing private withdrawal…</span>
              </>
            )}
            {phase === 'WALLET_APPROVAL' && (
              <>
                <Wallet className="w-4 h-4" />
                <span>Approve in your wallet (proof generation)…</span>
              </>
            )}
            {phase === 'SUBMITTED' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming on-chain…</span>
              </>
            )}
            {phase === 'COMPLETE' && <span>✓ Unshield submitted — reconcile public balance</span>}
            {phase === 'FAILED' && <span>Retry Unshield</span>}
            {phase === 'IDLE' && <span>Unshield to Public Address</span>}
          </button>
        </form>
      )}
    </div>
  );
};