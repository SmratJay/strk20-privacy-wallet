'use client';

import React, { useCallback, useState } from 'react';
import { Wallet, AlertTriangle, Globe, ShieldAlert, ShieldCheck, RefreshCw, ArrowRight } from 'lucide-react';
import {
  WalletApiStatus,
  strk20WalletApiService,
  PrivateReceivingStatus,
} from '@/services/strk20WalletApiService';

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

type ReceivingViewState =
  | 'IDLE'
  | 'CHECKING'
  | { status: PrivateReceivingStatus; message?: string };

/**
 * "Enable Private Receiving" onboarding card for the STRK20 Wallet API lane.
 *
 * Registration is wallet-owned (the wallet sets a viewing key on-chain). The Wallet API
 * exposes no standalone "register recipient" RPC, so this card is honest by construction:
 *   - A non-STRK20 wallet shows the graceful degradation message (never faked in).
 *   - Registration completes on the user's first Shield (a deposit); the card explains
 *     this instead of pretending to create a channel locally.
 *
 * It only ever probes the wallet on explicit user action — never on render — so the
 * wallet's private-balance consent is not spam-triggered.
 */
export const PrivateReceivingCard: React.FC<{
  wallet: any;
  onGoToShield?: () => void;
}> = ({ wallet, onGoToShield }) => {
  const [view, setView] = useState<ReceivingViewState>('IDLE');

  const handleEnable = useCallback(async () => {
    setView('CHECKING');
    try {
      const result = await strk20WalletApiService.enablePrivateReceiving(wallet);
      if (result.status === 'ALREADY_ENABLED') {
        setView({ status: 'ENABLED', message: result.message });
      } else if (result.status === 'UNSUPPORTED') {
        setView({ status: 'UNSUPPORTED', message: result.message });
      } else if (result.status === 'NEEDS_FIRST_SHIELD') {
        setView({ status: 'NOT_ENABLED', message: result.message });
      } else {
        setView({ status: 'UNKNOWN', message: result.message });
      }
    } catch {
      setView({
        status: 'UNKNOWN',
        message: 'Could not reach the wallet. Check the connection and try again.',
      });
    }
  }, [wallet]);

  const status: PrivateReceivingStatus = view === 'IDLE' || view === 'CHECKING' ? 'UNKNOWN' : view.status;

  return (
    <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
          <ShieldCheck className="w-4 h-4 text-orrange-400" />
          <span>Private STRK20 · Receiving</span>
        </div>
        {view !== 'IDLE' && view !== 'CHECKING' && (
          <button
            onClick={handleEnable}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orrange-400 uppercase font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Re-check</span>
          </button>
        )}
      </div>

      {status === 'ENABLED' && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="font-bold uppercase">Private receiving enabled</span>
          <span className="text-emerald-300/70">— others can send you STRK20 privately.</span>
        </div>
      )}

      {status === 'NOT_ENABLED' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full border border-zinc-500 shrink-0" />
            <span>Private receiving not enabled</span>
          </div>
          {view !== 'IDLE' && view !== 'CHECKING' && typeof view === 'object' && view.message && (
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
              <p className="leading-relaxed">{view.message}</p>
              {onGoToShield && (
                <button
                  onClick={onGoToShield}
                  className="mt-2 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[10px] font-bold uppercase flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Go to Shield</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <button
            onClick={handleEnable}
            disabled={view === 'CHECKING'}
            className="px-3 py-1.5 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-bold text-[10px] uppercase transition-colors cursor-pointer"
          >
            {view === 'CHECKING' ? 'Checking private receiving…' : 'Enable private receiving'}
          </button>
        </div>
      )}

      {status === 'UNSUPPORTED' && (
        <div className="flex items-start gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
          <p className="leading-relaxed">
            STRK20 privacy isn't supported by this wallet yet. Use Ready X to enable private
            transfers.
          </p>
        </div>
      )}

      {status === 'UNKNOWN' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full border border-zinc-500 shrink-0" />
            <span>{view === 'CHECKING' ? 'Checking private receiving…' : 'Private receiving status unknown'}</span>
          </div>
          {view !== 'IDLE' && view !== 'CHECKING' && typeof view === 'object' && view.message && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">{view.message}</p>
          )}
          <button
            onClick={handleEnable}
            disabled={view === 'CHECKING'}
            className="px-3 py-1.5 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black font-bold text-[10px] uppercase transition-colors cursor-pointer"
          >
            {view === 'CHECKING' ? (
              <>
                <RefreshCw className="w-3 h-3 inline animate-spin mr-1" />
                Checking…
              </>
            ) : (
              'Enable private receiving'
            )}
          </button>
        </div>
      )}
    </div>
  );
};