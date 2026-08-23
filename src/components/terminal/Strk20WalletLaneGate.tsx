'use client';

import React, { useCallback, useState } from 'react';
import { Wallet, AlertTriangle, Globe, ShieldAlert, ShieldCheck, RefreshCw, ArrowRight, Loader2 } from 'lucide-react';
import {
  WalletApiStatus,
  strk20WalletApiService,
  PrivateReceivingEnableStatus,
  PrivateReceivingStep,
} from '@/services/strk20WalletApiService';
import { useNetwork } from '@/context/NetworkContext';
import { parseTokenAmount } from '@/utils/formatters';

/**
 * Gate banner for the generic STRK20 Wallet API lane (LANE A).
 * Renders honest state before a Shield / Private Send / Unshield form is usable:
 *   CONNECT_WALLET / WRONG_NETWORK / PRIVACY_WALLET_REQUIRED / READY.
 */
export const Strk20WalletLaneGate: React.FC<{
  status: WalletApiStatus | null;
  checking?: boolean;
  onConnect?: () => void;
}> = ({
  status,
  checking,
  onConnect,
}) => {
  if (checking || !status) {
    return (
      <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400">
        Checking private STRK20 wallet capability…
      </div>
    );
  }

  switch (status.state) {
    case 'CONNECT_WALLET':
      return (
        <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-300 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Wallet className="w-4 h-4 shrink-0 text-orrange-400 mt-0.5" />
            <div>
              <span className="font-bold text-white uppercase">Connect a Starknet wallet</span>
              <p className="text-zinc-400 mt-0.5 text-[11px]">
                Connect a Starknet wallet to use private STRK20 shield / send / unshield.
              </p>
            </div>
          </div>
          {onConnect && (
            <button
              onClick={onConnect}
              className="px-3 py-1.5 bg-orrange-500 hover:bg-orrange-400 text-black font-mono font-bold text-xs uppercase tracking-wider shrink-0 transition-all cursor-pointer"
            >
              Connect
            </button>
          )}
        </div>
      );
    case 'WRONG_NETWORK':
      return (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
          <Globe className="w-4 h-4 shrink-0" />
          <div>
            <span className="font-bold uppercase">Switch to Starknet Sepolia</span>
            <p className="text-amber-200/80 mt-0.5">
              Private STRK20 currently works on Starknet Sepolia. Switch your wallet network
              and try again.
            </p>
          </div>
        </div>
      );
    case 'PRIVACY_WALLET_REQUIRED':
      return (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <span className="font-bold uppercase text-rose-300">Privacy wallet required</span>
              <p className="text-rose-200/80 mt-0.5 text-[11px]">
                A privacy-enabled Starknet wallet (Wallet API ≥ 0.10, e.g. Ready) is required for
                STRK20.
              </p>
            </div>
          </div>
          {onConnect && (
            <button
              onClick={onConnect}
              className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/50 text-rose-200 font-mono font-bold text-xs uppercase tracking-wider shrink-0 transition-all cursor-pointer"
            >
              Switch
            </button>
          )}
        </div>
      );
    case 'READY':
      return (
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 hidden" />
          <span className="font-bold uppercase">Private STRK20 ready</span>
          <span className="text-emerald-300/70">
            · wallet {status.walletName ? `(${status.walletName})` : ''} handles proofs & privacy
          </span>
        </div>
      );
    default:
      return null;
  }
};

export const isWalletLaneReady = (status: WalletApiStatus | null): boolean =>
  status?.state === 'READY';

/**
 * Compact private-balance access note for the wallet lane tabs. Renders only when the
 * wallet has not granted private-balance access this session; never auto-requests.
 */
export const PrivateBalanceAccessNote: React.FC<{
  permission: 'UNKNOWN' | 'GRANTED' | 'DENIED';
  onRequest: () => void;
}> = ({ permission, onRequest }) => {
  if (permission === 'GRANTED') return null;
  return (
    <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center justify-between gap-2">
      <span>Private balance access not granted.</span>
      {permission === 'UNKNOWN' && (
        <button
          onClick={onRequest}
          className="px-3 py-1.5 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-bold text-[10px] uppercase transition-colors cursor-pointer"
        >
          Share private balances
        </button>
      )}
    </div>
  );
};

type ReceivingCardState =
  | { step: 'IDLE' }
  | { step: 'CHECKING' }
  | { step: 'WALLET_APPROVAL' }
  | { step: 'SUBMITTED'; txHash?: string }
  | { step: 'CONFIRMING'; txHash?: string }
  | { step: 'CONFIRMED'; txHash?: string }
  | { step: 'READY' }
  | { step: 'ERROR'; status: PrivateReceivingEnableStatus; message: string; txHash?: string };

const STEP_LABELS: Record<string, string> = {
  CHECKING: 'Checking privacy setup…',
  WALLET_APPROVAL: 'Approve the STRK20 privacy setup in Ready.',
  SUBMITTED: 'Privacy setup submitted — waiting for confirmation…',
  CONFIRMING: 'Waiting for confirmation…',
  CONFIRMED: 'Private receiving enabled ✓',
};

const ERROR_COPY: Partial<Record<PrivateReceivingEnableStatus, string>> = {
  UNSUPPORTED:
    "STRK20 privacy isn't supported by this wallet yet. Use Ready X to enable private transfers.",
  WRONG_NETWORK: 'Private STRK20 works on Starknet Sepolia. Switch your wallet network and try again.',
  USER_REJECTED: 'You declined the STRK20 privacy setup in Ready. No transaction was sent.',
  ACCOUNT_FINALIZING:
    'Your account is still finalizing. Wait a few blocks (~10 blocks), then try again.',
};

/**
 * "Enable Private Receiving" onboarding card for the STRK20 Wallet API lane (LANE A).
 *
 * This is a REAL protocol action, not a heuristic:
 *  - Readiness comes from protocol state (wallet_strk20Balances → NOT_REGISTERED),
 *    never from a locally stored flag and never on render.
 *  - For an unregistered user it submits a real `wallet_strk20InvokeTransaction`
 *    deposit. The Ready wallet transparently registers the address (SetViewingKey +
 *    self-channel via its autoRegister/autoSetup prover) and creates the first private
 *    note in the SAME transaction — this is the documented registration path for the
 *    Wallet API, which exposes no standalone register RPC.
 *  - The wallet owns approval + proof generation + submission. The UI explicitly tells
 *    the user to approve in Ready and never claims the dapp performed the operation.
 *  - CONFIRMED is only shown after on-chain confirmation and a re-probe of readiness.
 */
export const PrivateReceivingCard: React.FC<{
  wallet: any;
  onOnboarded?: (txHash: string, tokenSymbol: string, amount: string) => void;
}> = ({ wallet, onOnboarded }) => {
  const { currentNetwork } = useNetwork();
  const [state, setState] = useState<ReceivingCardState>({ step: 'IDLE' });
  const [tokenSymbol, setTokenSymbol] = useState(currentNetwork.tokens[0]?.symbol ?? '');
  const [amount, setAmount] = useState('0.01');

  const selectedToken =
    currentNetwork.tokens.find((t) => t.symbol === tokenSymbol) || currentNetwork.tokens[0];

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
        case 'CONFIRMED': {
          const txHash = detail?.transactionHash || (prev as any).txHash;
          return { step: 'CONFIRMED', txHash };
        }
        default:
          return prev;
      }
    });
  }, []);

  const handleEnable = useCallback(async () => {
    if (!selectedToken) return;
    const amountBase = parseTokenAmount(amount, selectedToken.decimals);
    if (amountBase <= 0n) {
      setState({ step: 'ERROR', status: 'FAILED', message: 'Enter a shield amount greater than zero.' });
      return;
    }
    setState({ step: 'CHECKING' });
    try {
      const result = await strk20WalletApiService.enablePrivateReceiving(
        wallet,
        { token: selectedToken.address, amountBase },
        handleStep,
      );
      if (result.status === 'READY') {
        setState({ step: 'READY' });
      } else if (result.status === 'CONFIRMED') {
        onOnboarded?.(result.transactionHash || '', selectedToken.symbol, amount);
        setState({ step: 'CONFIRMED', txHash: result.transactionHash });
      } else if (result.status === 'SUBMITTED') {
        setState({ step: 'SUBMITTED', txHash: result.transactionHash });
      } else {
        setState({
          step: 'ERROR',
          status: result.status,
          message: result.message || ERROR_COPY[result.status] || 'Could not enable private receiving.',
          txHash: result.transactionHash,
        });
      }
    } catch (err: any) {
      setState({
        step: 'ERROR',
        status: 'FAILED',
        message: err?.message || 'Could not reach the wallet. Check the connection and try again.',
      });
    }
  }, [wallet, selectedToken, amount, handleStep, onOnboarded]);

  const inProgress =
    state.step === 'CHECKING' ||
    state.step === 'WALLET_APPROVAL' ||
    state.step === 'SUBMITTED' ||
    state.step === 'CONFIRMING';

  return (
    <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
          <ShieldCheck className="w-4 h-4 text-orrange-400" />
          <span>Private STRK20 · Receiving</span>
        </div>
        {!inProgress && state.step !== 'IDLE' && (
          <button
            onClick={() => setState({ step: 'IDLE' })}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orrange-400 uppercase font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {state.step === 'IDLE' && (
        <div className="space-y-3">
          <div className="text-[11px] text-zinc-400 leading-relaxed">
            Your Ready Wallet can receive private STRK20 tokens. One-time privacy setup is done
            through your wallet — it also shields your first note so you can start using private
            transfers immediately.
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedToken?.symbol ?? ''}
              onChange={(e) => setTokenSymbol(e.target.value)}
              disabled={inProgress}
              className="px-2.5 py-2 bg-zinc-950 border border-zinc-700 text-white font-bold text-xs outline-none cursor-pointer"
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
                placeholder="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={inProgress}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-orrange-500 text-white font-bold text-xs outline-none"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-500 font-bold uppercase">
                to shield
              </span>
            </div>
          </div>
          <button
            onClick={handleEnable}
            className="w-full px-3 py-2.5 bg-orrange-500 hover:bg-orrange-400 text-black font-bold text-[10px] uppercase transition-colors cursor-pointer"
          >
            Enable Private Receiving
          </button>
        </div>
      )}

      {inProgress && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-300">
            <Loader2 className="w-3.5 h-3.5 text-orrange-400 animate-spin shrink-0" />
            <span>{STEP_LABELS[state.step]}</span>
          </div>
          {state.step === 'WALLET_APPROVAL' && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Approve the STRK20 privacy setup in Ready — it handles registration, channel setup,
              proof generation, and submission in your wallet.
            </p>
          )}
          {state.step === 'SUBMITTED' || state.step === 'CONFIRMING' ? (
            state.txHash ? (
              <p className="text-[10px] text-zinc-500 break-all">
                Tx:{' '}
                <a
                  href={`https://sepolia.voyager.online/tx/${state.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-orrange-400"
                >
                  {state.txHash.slice(0, 24)}…
                </a>
              </p>
            ) : null
          ) : null}
          {state.step === 'CONFIRMING' && (
            <button
              onClick={() => setState({ step: 'IDLE' })}
              className="text-[10px] text-zinc-400 hover:text-orrange-400 uppercase font-bold cursor-pointer"
            >
              Track in Ready instead
            </button>
          )}
        </div>
      )}

      {(state.step === 'READY' || state.step === 'CONFIRMED') && (
        <div className="flex items-start gap-2 text-[11px] text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase">Private receiving enabled</span>
            <span className="text-emerald-300/70"> — others can send you STRK20 privately.</span>
            {state.step === 'CONFIRMED' && state.txHash && (
              <a
                href={`https://sepolia.voyager.online/tx/${state.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-[10px] text-orrange-400 underline mt-1 break-all"
              >
                setup tx: {state.txHash.slice(0, 24)}…
              </a>
            )}
          </div>
        </div>
      )}

      {state.step === 'ERROR' && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="min-w-0">
              <p className="font-bold uppercase text-rose-300">{state.status.replace(/_/g, ' ')}</p>
              <p className="leading-relaxed mt-0.5">{state.message}</p>
              {state.txHash && (
                <a
                  href={`https://sepolia.voyager.online/tx/${state.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[10px] text-orrange-400 underline mt-1 break-all"
                >
                  tx: {state.txHash.slice(0, 24)}…
                </a>
              )}
            </div>
          </div>
          <button
            onClick={() => setState({ step: 'IDLE' })}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orrange-400 uppercase font-bold transition-colors cursor-pointer"
          >
            <ArrowRight className="w-3 h-3" />
            <span>Try again</span>
          </button>
        </div>
      )}
    </div>
  );
};