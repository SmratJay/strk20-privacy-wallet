'use client';

import React from 'react';
import { Wallet, AlertTriangle, Globe, ShieldAlert } from 'lucide-react';
import { WalletApiStatus } from '@/services/strk20WalletApiService';

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