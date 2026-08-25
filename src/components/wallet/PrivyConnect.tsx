"use client";

import React, { useState } from "react";
import { ShieldCheck, Loader2, LogOut, Copy, Check } from "lucide-react";
import { usePrivyWallet } from "@/context/PrivyWalletContext";
import { useWallet } from "@/context/WalletContext";
import { shortenAddress, copyToClipboard } from "@/utils/formatters";

export const PrivyConnect: React.FC = () => {
  const privy = usePrivyWallet();
  const { wallet } = useWallet();
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (!privy.address) return;
    const ok = await copyToClipboard(privy.address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!privy.isAvailable) return null;

  if (!privy.ready) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6 text-center text-sm text-zinc-400">
        Loading sign-in…
      </div>
    );
  }

  if (privy.authenticated) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">Signed in with Privy</div>
            <button
              onClick={handleCopyAddress}
              title="Click to copy full wallet address"
              className="text-[12px] text-zinc-400 font-mono hover:text-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer group"
            >
              {privy.address ? (
                copied ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Copied
                  </span>
                ) : (
                  <>
                    {shortenAddress(privy.address, 6)}
                    <Copy className="w-3 h-3 text-zinc-500 group-hover:text-zinc-300" />
                  </>
                )
              ) : (
                "Preparing wallet…"
              )}
            </button>
          </div>
        </div>
        {privy.error && <div className="text-[12px] text-rose-300">{privy.error}</div>}
        {privy.account && privy.viewingKey !== null && (
          <div className="text-[12px] text-emerald-300">Starknet wallet ready. Private sending enabled.</div>
        )}
        <button
          onClick={privy.logout}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 hover:text-zinc-200"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    );
  }

  // Not authenticated. When no Ready wallet is connected, ConnectGate already offers the
  // Google button, so only render the sign-in form here when a Ready wallet IS connected
  // (i.e. the user wants to add Privy as an additional sign-in).
  if (!wallet.isConnected) return null;

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">Also use Privy</div>
          <div className="text-[12px] text-zinc-400">
            Sign in with an embedded Starknet wallet — no extension needed.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => privy.login({ google: true })}
          disabled={privy.isConnecting}
          className="w-full py-2.5 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {privy.isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
          Continue with Google
        </button>

        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          <span className="flex-1 h-px bg-zinc-800" />
          or with email
          <span className="flex-1 h-px bg-zinc-800" />
        </div>

        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-violet-500 text-zinc-100 text-sm outline-none"
        />
        <button
          onClick={() => privy.login({ email: email.trim() || undefined })}
          disabled={privy.isConnecting}
          className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {privy.isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
          {privy.isConnecting ? "Signing in…" : "Sign in with email"}
        </button>
      </div>

      {privy.error && <div className="text-[12px] text-rose-300">{privy.error}</div>}
    </div>
  );
};