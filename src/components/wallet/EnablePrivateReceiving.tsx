'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import {
  strk20WalletApiService,
  PrivateReceivingStep,
  PrivateReceivingEnableStatus,
  waitForStrk20Confirmation,
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

function privyErrorToMessage(err: any): string {
  const msg = String(err?.message || '');
  const lower = msg.toLowerCase();
  if (/not finalized|finaliz|10-block|10 block|finality/i.test(lower)) {
    return 'Your account is still finalizing. Wait a few blocks (~10 blocks), then retry.';
  }
  if (/not deployed|not found|contract not found|is not deployed/i.test(lower)) {
    return 'Your Starknet account is not deployed yet. Fund it with a small amount of Sepolia ETH/STRK via the faucet, then retry.';
  }
  if (/allow|approve|spend/i.test(lower)) {
    return 'Could not approve STRK spending for the privacy pool.';
  }
  if (/insufficient.*balance|not enough.*funds|insufficient funds|out of fee|fee.*insufficient/i.test(lower)) {
    return 'You need a small amount of STRK in your Starknet account for network fees. Fund it via the Sepolia faucet, then retry.';
  }
  if (/prover|proof|proving|502|504|timeout|unavailable|offline/i.test(lower)) {
    return 'The STRK20 privacy service is temporarily unavailable. Your funds are unaffected — try again in a moment.';
  }
  if (/discover|indexer|no such host|fetch failed/i.test(lower)) {
    return "We couldn't reach the STRK20 discovery service. Check the operator configuration and retry.";
  }
  return msg || 'Could not enable private receiving. Check the operator configuration and retry.';
}

/**
 * First-run onboarding: enables private receiving.
 *
 * READY lane (Wallet API): registration is transparent — the wallet registers the viewing key +
 * channel and shields the first note in one real transaction, so a small funded balance is needed.
 *
 * PRIVY lane (STRK20 SDK): calls `register()` which submits a real SetViewingKey registration to
 * the pool (via the operator proving/discovery stack), then reconciles on-chain. Requires the
 * derived Ready account to be funded/deployed and the operator services configured.
 */
export const EnablePrivateReceiving: React.FC<{ onEnabled?: () => void }> = ({ onEnabled }) => {
  const { wallet, currentNetwork, refreshAfterMutation, setPrivateReceivingState } = useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null && privy.viewingKey !== null;

  const faucetUrl = currentNetwork.faucetUrl;
  const [state, setState] = useState<State>({ step: 'IDLE' });
  const [tokenSymbol, setTokenSymbol] = useState(currentNetwork.tokens[0]?.symbol ?? '');
  const [amount, setAmount] = useState('0.01');

  const selectedToken =
    currentNetwork.tokens.find((t) => t.symbol === tokenSymbol) || currentNetwork.tokens[0];

  const checkReadiness = useCallback(async () => {
    if (privyConnected && privy.privateReceivingEnabled) {
      setPrivateReceivingState('READY');
      setState({ step: 'READY' });
      return;
    }
    if (!wallet.isConnected || privyConnected) return;
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
  }, [wallet, privyConnected, privy.privateReceivingEnabled, setPrivateReceivingState]);

  useEffect(() => {
    if (wallet.isConnected || privyConnected) {
      void checkReadiness();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.isConnected, privyConnected]);

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
    if (privyConnected) {
      setState({ step: 'CHECKING' });
      try {
        setState({ step: 'WALLET_APPROVAL' });
        const receipt = await privy.register();
        setState({ step: 'SUBMITTED', txHash: receipt.transactionHash });
        setState({ step: 'CONFIRMING', txHash: receipt.transactionHash });
        const reconcile = await waitForStrk20Confirmation(receipt.transactionHash);
        if (reconcile === 'CONFIRMED') {
          setPrivateReceivingState('READY');
          setState({ step: 'READY' });
          await refreshAfterMutation();
          onEnabled?.();
        } else if (reconcile === 'REVERTED') {
          setState({ step: 'ERROR', message: 'The registration transaction reverted on-chain.' });
        } else {
          setState({ step: 'SUBMITTED', txHash: receipt.transactionHash });
        }
      } catch (err: any) {
        setState({ step: 'ERROR', message: privyErrorToMessage(err) });
      }
      return;
    }

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
  }, [privyConnected, privy, selectedToken, amount, handleStep, setPrivateReceivingState, refreshAfterMutation, onEnabled, wallet]);

  const busy =
    state.step === 'CHECKING' ||
    state.step === 'WALLET_APPROVAL' ||
    state.step === 'SUBMITTED' ||
    state.step === 'CONFIRMING';

  const isPrivy = privyConnected;

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">Enable private payments</div>
          <div className="text-[12px] text-zinc-400">
            {isPrivy
              ? 'Registers your private viewing key so only you can detect payments sent to you.'
              : 'This lets your wallet privately detect payments sent to you. Setup also shields your first note, so a small funded balance is needed.'}
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
          {state.step === 'WALLET_APPROVAL' &&
            (isPrivy
              ? privy.deploying
                ? privy.deployStatus === 'FINALIZING'
                  ? 'Waiting for account finality (~10 blocks)…'
                  : 'Deploying your account on-chain…'
                : privy.approvalStatus === 'approving'
                  ? 'Approval required — approving STRK for private payments…'
                  : privy.approvalStatus === 'confirmed'
                    ? 'Approval confirmed — generating privacy proof…'
                    : 'Preparing registration…'
              : 'Approve the privacy setup in your wallet…')}
          {(state.step === 'SUBMITTED' || state.step === 'CONFIRMING') && 'Waiting for confirmation…'}
        </div>
      )}

      {state.step === 'ERROR' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{state.message}</span>
          </div>
          {faucetUrl && (
            <a
              href={faucetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-violet-300 hover:text-violet-200"
            >
              Fund your account on the Sepolia faucet, then retry.
            </a>
          )}
        </div>
      )}

      {state.step === 'IDLE' && (
        <div className="space-y-3">
          {!isPrivy && (
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
          )}
          <button
            onClick={handleEnable}
            className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors"
          >
            Enable private receiving
          </button>
          {isPrivy && (
            <p className="text-[11px] text-zinc-500">
              Requires a funded Starknet account and the STRK20 operator proving/discovery services.
            </p>
          )}
          {isPrivy && privy.deployStatus === 'NOT_DEPLOYED' && (
            <p className="text-[11px] text-amber-300/90">
              Your account will be deployed on-chain when you enable private receiving.
            </p>
          )}
        </div>
      )}
    </div>
  );
};