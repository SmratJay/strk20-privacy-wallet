"use client";

import React, { useState } from "react";
import { ShieldCheck, Loader2, LogOut } from "lucide-react";
import { usePrivyWallet } from "@/context/PrivyWalletContext";
import { shortenAddress } from "@/utils/formatters";

export const PrivyConnect: React.FC = () => {
  const privy = usePrivyWallet();
  const [email, setEmail] = useState("");

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
            <div className="text-[12px] text-zinc-400 font-mono">
              {privy.address ? shortenAddress(privy.address, 6) : "Preparing wallet…"}
            </div>
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

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-100">Continue with Privy</div>
          <div className="text-[12px] text-zinc-400">
            Social or email sign-in with an embedded Starknet wallet. No extension needed.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-violet-500 text-zinc-100 text-sm outline-none"
        />
        <button
          onClick={() => privy.login(email.trim() || undefined)}
          disabled={privy.isConnecting}
          className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {privy.isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
          {privy.isConnecting ? "Signing in…" : "Sign in"}
        </button>
      </div>

      {privy.error && <div className="text-[12px] text-rose-300">{privy.error}</div>}
    </div>
  );
};
