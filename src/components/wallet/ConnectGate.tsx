'use client';

/**
 * LEGACY / COMPATIBILITY — old "connect privacy wallet / Continue with Google" gate.
 * The primary `/wallet` entry is now the Wallet Core gate (Create / Import); this legacy gate
 * remains only for legacy pages that still render it.
 */

import React from 'react';
import { ShieldCheck, Lock, Loader2 } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';

/**
 * Shown when no wallet is connected. Communicates the core privacy promise without
 * technical jargon, and offers both sign-in paths side by side: a privacy wallet
 * (Ready) and an embedded Privy wallet (Continue with Google / email).
 */
export const ConnectGate: React.FC = () => {
  const { wallet } = useWallet();
  const privy = usePrivyWallet();

  const showPrivy = privy.isAvailable && !privy.authenticated;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 sm:p-8 text-center space-y-4">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
        <Lock className="w-5 h-5" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold text-zinc-100">Private payments, made simple</h2>
        <p className="text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
          Connect a wallet to receive and send STRK20 privately. Your sender, recipient, amount,
          and token stay hidden.
        </p>
      </div>
      <div className={`grid gap-2 ${showPrivy ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
        <button
          onClick={wallet.openConnectModal}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors"
        >
          <ShieldCheck className="w-4 h-4" />
          Connect privacy wallet
        </button>
        {showPrivy && (
          <button
            onClick={() => privy.login({ google: true })}
            disabled={privy.isConnecting}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {privy.isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.86-3c-1.08.72-2.45 1.16-4.08 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                />
              </svg>
            )}
            Continue with Google
          </button>
        )}
      </div>
      <p className="text-[11px] text-zinc-600">
        Ready wallet — STRK20 privacy handled in-wallet. Privy — embedded Starknet wallet, no
        extension needed.
      </p>
    </div>
  );
};