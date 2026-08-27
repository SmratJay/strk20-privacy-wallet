'use client';

import React from 'react';
import { Lock, ShieldAlert } from 'lucide-react';

interface NoteScannerTabProps {
  wallet: any;
  onShieldRedirect?: () => void;
}

/**
 * LEGACY local-note scanner — FAILS CLOSED.
 *
 * STRK20 private notes are owned by the user's privacy wallet (Wallet API lane) and the
 * STRK20 pool. The app must NOT derive/decrypt viewing keys, read note plaintext, or treat
 * localStorage as note/balance authority. Local UTXO scanning is therefore not supported.
 */
export const NoteScannerTab: React.FC<NoteScannerTabProps> = () => {
  return (
    <div className="max-w-2xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Lock className="w-4 h-4 text-orrange-400" />
            <span>Note Scanner — Unavailable</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Wallet-managed STRK20 privacy
          </p>
        </div>
      </div>

      <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <div>
          <span className="font-bold uppercase block">Local note scanning is not supported</span>
          <p className="mt-1 text-rose-200/80">
            STRK20 private notes are managed by your privacy-enabled wallet (Wallet API lane) and the
            STRK20 pool. The app never derives viewing keys, reads note plaintext, or stores financial
            state locally.
          </p>
          <p className="mt-1 text-rose-200/80">
            Use Shield / Private Send / Unshield to manage your private STRK20 balance, and read your
            private balance from your wallet.
          </p>
        </div>
      </div>
    </div>
  );
};