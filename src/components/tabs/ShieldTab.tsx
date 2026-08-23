'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Info, AlertCircle, Loader2, Wallet } from 'lucide-react';
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

interface ShieldTabProps {
  balances: ShieldedBalance[];
  wallet: any;
  privateBalancePermission?: WalletBalancePermission;
  onRequestPrivateBalanceAccess?: () => void;
  onSuccess: (txHash: string, token: TokenInfo, amount: string) => void;
}

type TxPhase =
  | 'IDLE'
  | 'PREPARING'
  | 'WALLET_APPROVAL'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'COMPLETE'
  | 'FAILED';

export const ShieldTab: React.FC<ShieldTabProps> = ({
  balances,
  wallet,
  privateBalancePermission = 'UNKNOWN',
  onRequestPrivateBalanceAccess,
  onSuccess,
}) => {
  const { currentNetwork } = useNetwork();
  const [selectedToken, setSelectedToken] = useState<TokenInfo>(currentNetwork.tokens[0]);
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<TxPhase>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletApiStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      const s = await strk20WalletApiService.getWalletApiStatus(wallet);
      setStatus(s);
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
  const publicBal = currentBalance ? currentBalance.publicBalance : 0n;
  const ready = isWalletLaneReady(status);

  const handleMax = () => {
    if (publicBal > 0n) {
      setAmount(formatTokenAmount(publicBal, selectedToken.decimals, 6));
    }
  };

  const handleShield = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;

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
    setPhase('PREPARING');

    try {
      // The privacy wallet performs the private deposit (approve + deposit) and
      // proof generation. The dapp only describes the action.
      setPhase('WALLET_APPROVAL');
      const receipt = await strk20WalletApiService.shield(
        wallet,
        selectedToken.address,
        amountBigInt,
      );
      setTxHash(receipt.transactionHash);
      setPhase('SUBMITTED');

      // Reconcile with the real chain; never claim "confirmed" from a hash alone.
      const reconcile = await strk20WalletApiService.waitForStrk20Confirmation(
        receipt.transactionHash,
      );
      if (reconcile === 'CONFIRMED') {
        setPhase('COMPLETE');
        onSuccess(receipt.transactionHash, selectedToken, amount);
        setAmount('');
      } else if (reconcile === 'REVERTED') {
        setPhase('FAILED');
        setError('The private deposit transaction reverted on-chain.');
      } else {
        // PENDING (timeout): submitted but not yet confirmed. Honest state.
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
            <Shield className="w-4 h-4 text-orrange-400" />
            <span>Shield Tokens (Public → Private)</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Privacy wallet · Wallet API · STRK20 private note
          </p>
        </div>
        <span className="text-[10px] text-orrange-400 font-bold border border-orrange-500/30 px-2 py-0.5 bg-orrange-950/40">
          [ WALLET_LANE ]
        </span>
      </div>

      <Strk20WalletLaneGate
        status={status}
        checking={checking}
        onConnect={() => (wallet.openConnectModal ? wallet.openConnectModal() : wallet.connectWallet())}
      />

      {ready && (
        <form onSubmit={handleShield} className="space-y-4">
          <PrivateBalanceAccessNote
            permission={privateBalancePermission}
            onRequest={onRequestPrivateBalanceAccess ?? (() => {})}
          />
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

          <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-white uppercase text-[10px]">
              <Info className="w-3.5 h-3.5 text-orrange-400" />
              <span>How Shielding Works:</span>
            </div>
            <p>1. Your wallet approves the token (prompt 1 of 2).</p>
            <p>2. Your wallet builds the private deposit + SNIP-36 proof (prompt 2 of 2).</p>
            <p className="text-amber-400">
              Fresh notes mature ~10 blocks before they can be spent.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {txHash && (phase === 'SUBMITTED' || phase === 'CONFIRMING') && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
              Submitted — awaiting on-chain confirmation. This can take longer than a normal
              transaction (proof generation happens in your wallet). Explorer:{' '}
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
            disabled={busy || !amount || parseFloat(amount) <= 0}
            className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {phase === 'PREPARING' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Preparing private deposit…</span>
              </>
            )}
            {phase === 'WALLET_APPROVAL' && (
              <>
                <Wallet className="w-4 h-4" />
                <span>Approve in your wallet (approve + deposit)…</span>
              </>
            )}
            {phase === 'SUBMITTED' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Confirming on-chain…</span>
              </>
            )}
            {phase === 'CONFIRMING' && (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Reconciling private balance…</span>
              </>
            )}
            {phase === 'COMPLETE' && <span>✓ Shield submitted — balance reconciles from your wallet</span>}
            {phase === 'FAILED' && <span>Retry Shield</span>}
            {phase === 'IDLE' && <span>Shield Tokens (Private)</span>}
          </button>
        </form>
      )}
    </div>
  );
};