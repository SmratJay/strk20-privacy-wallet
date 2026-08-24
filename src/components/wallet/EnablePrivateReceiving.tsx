'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import {
  strk20WalletApiService,
  PrivateReceivingStep,
  PrivateReceivingEnableStatus,
} from '@/services/strk20WalletApiService';
import { parseTokenAmount } from '@/utils/formatters';

type State =
  | { step: 'IDLE' }
  | { step: 'CHECKING' }
  | { step: 'WALLET_APPROVAL' }
  | { step: 'SUBMITTED'; txHash?: string }
  | { step: 'CONFIRMING'; txHash?: string }
  | { step: 'READY' }
  | { step: 'ERROR'; message: string };

const ERROR_COPY: Partial<Record<PrivateReceivingEnableStatus, string>> = {
  UNSUPPORTED: "STRK20 privacy isn't supported by this wallet yet. Use the Ready wallet.",
  WRONG_NETWORK: 'Private STRK20 works on Starknet Sepolia. Switch your wallet network and retry.',
  USER_REJECTED: 'You declined the privacy setup in your wallet. No transaction was sent.',
  ACCOUNT_FINALIZING:
    'Your account is still finalizing. Wait a few blocks (~10 blocks), then retry.',
};

/**
 * First-run onboarding: enables private receiving. For the Wallet API lane, there is no
 * standalone "register" RPC — the wallet transparently registers the viewing key + channel
 * and shields the first note in a single real transaction. This card surfaces that honestly.
 */
export const EnablePrivateReceiving: React.FC<{ onEnabled?: () => void }> = ({ onEnabled }) => {
  const { wallet, currentNetwork, refreshAfterMutation, setPrivateReceivingState } = useWallet();
  const [state, setState] = useState<State>({ step: 'IDLE' });
  const [tokenSymbol, setTokenSymbol] = useState(currentNetwork.tokens[0]?.symbol ?? '');
  const [amount, setAmount] = useState('0.01');

  const selectedToken =
    currentNetwork.tokens.find((t) => t.symbol === tokenSymbol) || currentNetwork.tokens[0];

  const checkReadiness = useCallback(async () => {
    if (!wallet.isConnected) return;
    setState({ step: 'CHECKING' });
    const req = await strk20WalletApiService.getPrivateReceivingRequirement(wallet);
    if (req === 'READY') {
      setPrivateReceivingState('READY');
      setState({ step: 'READY' });
    } else if (req === 'NEEDS_REGISTRATION') {
      setPrivateReceivingState('NEEDS_REGISTRATION');
      setState({ step: 'IDLE' });
    } else {
      setState({ step: 'IDLE' });
    }
  }, [wallet, setPrivateReceivingState]);

  // Probe once on mount so already-registered users see "ready" immediately.
  useEffect(() => {
    if (wallet.isConnected) {
      void checkReadiness();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.isConnected]);

  const handleStep = useCallback((step: PrivateReceivingStep, detail?: { transactionHash?: string }) => {
    setState((prev) => {
      switch (step) {
        case 'CHECKING':
          return { step: 'CHECKING' };
        case 'WALLET_APPROVAL':
          return { step: 'WALLET_APPROVAL' };
        case 'SUBMITTED':
          return { step: 'SUBMITTED', txHash: detail?.transactionHash };
        case 'CONFIRMING':
          return { step: 'CONFIRMING', txHash: detail?.transactionHash };
        case 'CONFIRMED':
          return { step: 'READY' };
        default:
          return prev;
      }
    });
  }, []);

  const handleEnable = useCallback(async () => {
    if (!selectedToken) return;
    const amountBase = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBase <= 0n) {
      setState({ step: 'ERROR', message: 'Enter a shield amount greater than zero.' });
      return;
    }
    setState({ step: 'CHECKING' });
    try {
      const result = await strk20WalletApiService.enablePrivateReceiving(
        wallet,
        { token: selectedToken.address, amountBase },
        handleStep
      );
      if (result.status === 'READY' || result.status === 'CONFIRMED') {
        setPrivateReceivingState('READY');
        setState({ step: 'READY' });
        await refreshAfterMutation();
        onEnabled?.();
      } else if (result.status === 'SUBMITTED') {
        setState({ step: 'SUBMITTED', txHash: result.transactionHash });
      } else {
        setState({
          step: 'ERROR',
          message: result.message || ERROR_COPY[result.status] || 'Could not enable private receiving.',
        });
      }
    } catch (err: any) {
      setState({
        step: 'ERROR',
        message: err?.message || 'Could not reach the wallet. Check the connection and retry.',
      });
    }
  }, [wallet, selectedToken, amount, handleStep, setPrivateReceivingState, refreshAfterMutation, onEnabled]);

  const busy =
    state.step === 'CHECKING' ||
    state.step === 'WALLET_APPROVAL' ||
    state.step === 'SUBMITTED' ||
    state.step === 'CONFIRMING';

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">Enable private payments</div>
          <div className="text-[12px] text-zinc-400">
            This lets your wallet privately detect payments sent to you.
          </div>
        </div>
      </div>

      {state.step === 'READY' && (
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4" />
          Private receiving is enabled.
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Loader2 className="w-4 h-4 text-violet-300 animate-spin" />
          {state.step === 'CHECKING' && 'Checking privacy setup…'}
          {state.step === 'WALLET_APPROVAL' && 'Approve the privacy setup in your wallet…'}
          {(state.step === 'SUBMITTED' || state.step === 'CONFIRMING') && 'Waiting for confirmation…'}
        </div>
      )}

      {state.step === 'ERROR' && (
        <div className="flex items-start gap-2 text-sm text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
      )}

      {state.step === 'IDLE' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={selectedToken?.symbol ?? ''}
              onChange={(e) => setTokenSymbol(e.target.value)}
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-100 text-sm font-medium outline-none"
            >
              {currentNetwork.tokens.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.icon} {t.symbol}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-violet-500 text-zinc-100 text-sm outline-none"
            />
          </div>
          <button
            onClick={handleEnable}
            className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors"
          >
            Enable private receiving
          </button>
        </div>
      )}
    </div>
  );
};
