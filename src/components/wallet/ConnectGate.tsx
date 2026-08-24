'use client';

import React from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';

/**
 * Shown when no wallet is connected. Communicates the core privacy promise without
 * technical jargon: receive privately, send privately, your money stays yours.
 */
export const ConnectGate: React.FC = () => {
  const { wallet } = useWallet();

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-8 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
        <Lock className="w-5 h-5" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-zinc-100">Private payments, made simple</h2>
        <p className="text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
          Connect a privacy wallet to receive and send STRK20 privately. Your sender, recipient,
          amount, and token stay hidden.
        </p>
      </div>
      <button
        onClick={wallet.openConnectModal}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors"
      >
        <ShieldCheck className="w-4 h-4" />
        Connect privacy wallet
      </button>
      <p className="text-[11px] text-zinc-600">
        Uses the Ready wallet — STRK20 privacy is handled in-wallet.
      </p>
    </div>
  );
};
