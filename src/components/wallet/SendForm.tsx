'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Shield, ArrowDownLeft, Loader2, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { useToast } from '@/components/Toast';
import {
  strk20WalletApiService,
  translateWalletError,
  SN_SEPOLIA_CHAIN_ID,
} from '@/services/strk20WalletApiService';
import { PrivacyTransaction } from '@/services/privacyService';
import { formatTokenAmount, parseTokenAmount } from '@/utils/formatters';

type Mode = 'SEND' | 'DEPOSIT' | 'WITHDRAW';

const MODES: { id: Mode; label: string; Icon: typeof ArrowUpRight }[] = [
  { id: 'SEND', label: 'Send privately', Icon: ArrowUpRight },
  { id: 'DEPOSIT', label: 'Make private', Icon: Shield },
  { id: 'WITHDRAW', label: 'Make public', Icon: ArrowDownLeft },
];

type Phase =
  | 'IDLE'
  | 'PREPARING'
  | 'WALLET_APPROVAL'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'COMPLETE'
  | 'FAILED';

export const SendForm: React.FC<{ initialMode?: Mode }> = ({ initialMode }) => {
  const {
    wallet,
    currentNetwork,
    balances,
    walletApiStatus,
    checkingStatus,
    refreshStatus,
    privateBalancePermission,
    requestPrivateBalanceAccess,
    refreshAfterMutation,
    recordTransaction,
  } = useWallet();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>(initialMode ?? 'SEND');
  const [selectedToken, setSelectedToken] = useState(currentNetwork.tokens[0]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    const matching =
      currentNetwork.tokens.find((t) => t.symbol === selectedToken.symbol) ||
      currentNetwork.tokens[0];
    setSelectedToken(matching);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNetwork]);

  const ready = walletApiStatus?.state === 'READY';
  const currentBalance = balances.find((b) => b.token.symbol === selectedToken.symbol);
  const publicBal = currentBalance ? currentBalance.publicBalance : 0n;
  const shieldedBal = currentBalance ? currentBalance.shieldedBalance : 0n;
  const shieldedBalAvailable = currentBalance?.shieldedBalanceAvailable === true;

  const busy = phase !== 'IDLE' && phase !== 'FAILED' && phase !== 'COMPLETE';

  const handleSwitchToSepolia = async () => {
    setSwitchingNetwork(true);
    try {
      await strk20WalletApiService.switchWalletNetwork(wallet, SN_SEPOLIA_CHAIN_ID);
      if (wallet.refreshWalletChain) await wallet.refreshWalletChain();
      await refreshStatus();
    } finally {
      setSwitchingNetwork(false);
    }
  };

  const handleMax = () => {
    const bal = mode === 'DEPOSIT' ? publicBal : shieldedBal;
    if (bal > 0n) setAmount(formatTokenAmount(bal, selectedToken.decimals, 6));
  };

  const resetForm = () => {
    setPhase('IDLE');
    setError(null);
    setTxHash(null);
    setReviewing(false);
    setAmount('');
    setRecipient('');
  };

  const validate = (): string | null => {
    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBigInt <= 0n) return 'Enter a valid amount.';
    if (mode !== 'DEPOSIT') {
      if (!recipient.trim()) return 'Enter a Starknet address.';
      try {
        BigInt(recipient.trim());
      } catch {
        return 'Enter a valid Starknet address.';
      }
    }
    if (mode === 'DEPOSIT' && amountBigInt > publicBal) {
      return `Insufficient public ${selectedToken.symbol} balance.`;
    }
    if (mode !== 'DEPOSIT' && shieldedBalAvailable && amountBigInt > shieldedBal) {
      return `Insufficient private ${selectedToken.symbol} balance. Make funds private first.`;
    }
    return null;
  };

  const execute = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setPhase('FAILED');
      return;
    }
    const amountBigInt = parseTokenAmount(amount, selectedToken.decimals);

    setError(null);
    setPhase('PREPARING');
    setReviewing(false);

    let tx: PrivacyTransaction;
    try {
      setPhase('WALLET_APPROVAL');
      const receipt =
        mode === 'SEND'
          ? await strk20WalletApiService.privateTransfer(
              wallet,
              selectedToken.address,
              amountBigInt,
              recipient.trim()
            )
          : mode === 'DEPOSIT'
          ? await strk20WalletApiService.shield(wallet, selectedToken.address, amountBigInt)
          : await strk20WalletApiService.unshield(
              wallet,
              selectedToken.address,
              amountBigInt,
              recipient.trim()
            );

      setTxHash(receipt.transactionHash);
      setPhase('SUBMITTED');

      const reconcile = await strk20WalletApiService.waitForStrk20Confirmation(
        receipt.transactionHash
      );

      if (reconcile === 'CONFIRMED') {
        setPhase('COMPLETE');
        tx = {
          id: `tx_${Date.now()}`,
          type: mode === 'SEND' ? 'PRIVATE_TRANSFER' : mode === 'DEPOSIT' ? 'SHIELD' : 'UNSHIELD',
          tokenSymbol: selectedToken.symbol,
          amount,
          recipient: mode === 'DEPOSIT' ? undefined : recipient.trim(),
          txHash: receipt.transactionHash,
          timestamp: Date.now(),
          status: 'CONFIRMED',
          isPrivate: true,
          privacyDetails: 'STRK20 privacy pool',
        };
        recordTransaction(tx);
        showToast({
          type: 'success',
          title: `${MODES.find((m) => m.id === mode)?.label} confirmed`,
          description: 'Your balance will update shortly.',
        });
        await refreshAfterMutation();
        setAmount('');
        setRecipient('');
        setPhase('IDLE');
      } else if (reconcile === 'REVERTED') {
        setPhase('FAILED');
        setError('The transaction reverted on-chain. Your funds were not moved.');
      } else {
        setPhase('SUBMITTED');
      }
    } catch (err: any) {
      const t = translateWalletError(err, {
        asset: selectedToken.symbol,
        recipient: mode === 'SEND',
      });
      setError(t.userMessage);
      setPhase('FAILED');
    }
  };

  const submitLabel = () => {
    switch (phase) {
      case 'PREPARING':
        return 'Preparing…';
      case 'WALLET_APPROVAL':
        return 'Approve in your wallet…';
      case 'SUBMITTED':
        return 'Confirming on-chain…';
      case 'CONFIRMING':
        return 'Confirming on-chain…';
      case 'COMPLETE':
        return 'Confirmed';
      case 'FAILED':
        return 'Retry';
      default:
        return mode === 'SEND'
          ? 'Review'
          : mode === 'DEPOSIT'
          ? 'Review deposit'
          : 'Review withdrawal';
    }
  };

  if (!wallet.isConnected) return null;

  if (checkingStatus || !walletApiStatus) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-center text-sm text-zinc-400">
        Checking private wallet capability…
      </div>
    );
  }

  if (walletApiStatus.state === 'CONNECT_WALLET') {
    return null;
  }

  if (walletApiStatus.state === 'WRONG_NETWORK') {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-3">
        <p className="text-sm text-amber-200">
          Private STRK20 currently works on Starknet Sepolia. Switch your wallet network to
          continue.
        </p>
        <button
          onClick={handleSwitchToSepolia}
          disabled={switchingNetwork}
          className="px-5 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {switchingNetwork ? 'Switching…' : 'Switch to Sepolia'}
        </button>
      </div>
    );
  }

  if (walletApiStatus.state === 'PRIVACY_WALLET_REQUIRED') {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center space-y-3">
        <p className="text-sm text-rose-200">
          A privacy-enabled Starknet wallet (Wallet API ≥ 0.10, e.g. Ready) is required for
          STRK20.
        </p>
        <button
          onClick={wallet.openConnectModal}
          className="px-5 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-sm font-semibold transition-colors"
        >
          Switch wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-2xl bg-zinc-900 border border-zinc-800">
        {MODES.map((m) => {
          const Icon = m.Icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                resetForm();
              }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {m.label}
            </button>
          );
        })}
      </div>

      {privateBalancePermission !== 'GRANTED' && (
        <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <span className="text-[13px] text-zinc-400">Share private balances to send privately</span>
          <button
            onClick={async () => {
              try {
                await requestPrivateBalanceAccess();
              } catch (err: any) {
                const t = translateWalletError(err);
                if (t.code !== 113) {
                  showToast({ type: 'error', title: 'Private balances unavailable', description: t.userMessage });
                }
              }
            }}
            className="text-[13px] font-medium text-violet-300 hover:text-violet-200"
          >
            Share
          </button>
        </div>
      )}

      {reviewing ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-100">
              {MODES.find((m) => m.id === mode)?.label}
            </h2>
            <p className="text-[12px] text-zinc-500">Review before confirming.</p>
          </div>

          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Amount</span>
              <span className="text-zinc-100 font-semibold tabular-nums">
                {amount} {selectedToken.symbol}
              </span>
            </div>
            {mode !== 'DEPOSIT' && (
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">To</span>
                <span className="text-zinc-100 font-mono break-all text-right">{recipient}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-500">Network fee</span>
              <span className="text-zinc-100">Paid by your wallet</span>
            </div>
          </div>

          <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-4 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-violet-200 font-medium">
              <EyeOff className="w-4 h-4" />
              Private
            </div>
            {mode === 'SEND' ? (
              <ul className="text-[13px] text-zinc-300 space-y-1">
                <li>✓ Sender hidden</li>
                <li>✓ Recipient hidden</li>
                <li>✓ Amount hidden</li>
                <li>✓ Token hidden</li>
              </ul>
            ) : (
              <p className="text-[13px] text-zinc-400">
                {mode === 'DEPOSIT'
                  ? 'Moving funds into the privacy pool. The deposit amount is the public leg.'
                  : 'Moving funds out of the privacy pool. The withdrawal amount is the public leg.'}
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setReviewing(false)}
              disabled={busy}
              className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-200 text-sm font-semibold transition-colors hover:bg-zinc-900 disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={execute}
              disabled={busy}
              className="flex-1 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? submitLabel() : `Confirm ${mode === 'SEND' ? 'private payment' : mode === 'DEPOSIT' ? 'deposit' : 'withdrawal'}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
          <div className="flex items-center justify-between text-[12px] text-zinc-500">
            <span>Asset</span>
            <span>
              {mode === 'DEPOSIT' ? 'Public balance: ' : 'Private balance: '}
              <span className="text-zinc-300 font-medium">
                {mode === 'DEPOSIT'
                  ? formatTokenAmount(publicBal, selectedToken.decimals, 4)
                  : shieldedBalAvailable
                  ? formatTokenAmount(shieldedBal, selectedToken.decimals, 4)
                  : '—'}{' '}
                {selectedToken.symbol}
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedToken.symbol}
              onChange={(e) => {
                const found = currentNetwork.tokens.find((t) => t.symbol === e.target.value);
                if (found) setSelectedToken(found);
              }}
              className="px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm font-medium outline-none"
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-violet-500 text-zinc-100 text-base font-medium outline-none"
              />
              <button
                onClick={handleMax}
                disabled={busy}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-violet-300 hover:text-violet-200"
              >
                Max
              </button>
            </div>
          </div>

          {mode !== 'DEPOSIT' && (
            <div>
              <label className="text-[12px] text-zinc-500 block mb-1.5">
                {mode === 'SEND' ? 'Recipient Starknet address' : 'Destination Starknet address'}
              </label>
              <input
                type="text"
                placeholder="0x…"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={busy}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-violet-500 text-zinc-100 font-mono text-sm outline-none"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {txHash && (phase === 'SUBMITTED' || phase === 'CONFIRMING') && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[12px] text-amber-200">
              Submitted — awaiting confirmation. Proof generation happens in your wallet, so this
              can take a little longer than a normal transaction.
            </div>
          )}

          <button
            onClick={() => {
              if (phase === 'FAILED') {
                setError(null);
                setPhase('IDLE');
                setReviewing(false);
                return;
              }
              const validationError = validate();
              if (validationError) {
                setError(validationError);
                return;
              }
              setError(null);
              setReviewing(true);
            }}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {submitLabel()}
          </button>
        </div>
      )}

      {phase === 'COMPLETE' && (
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          Transaction confirmed.
        </div>
      )}
    </div>
  );
};
