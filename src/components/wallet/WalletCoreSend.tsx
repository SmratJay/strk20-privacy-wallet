'use client';

import React, { useCallback, useState } from 'react';
import { ArrowUpRight, Loader2, Shield } from 'lucide-react';
import { CallData } from 'starknet';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { getNetworkConfig } from '@/config/networks';

/**
 * The primary Orrange SEND surface. Uses the Wallet Core runtime's local signer for ordinary
 * public STRK transactions — no Privy, no external extension, no Wallet API. Amount parsing is
 * the exact integer-only `parseAmountToBase` from Wallet Core.
 */
export const WalletCoreSend: React.FC = () => {
  const runtime = useWalletRuntime();
  const state = runtime.getState();
  const account = state.account!;

  const networkConfig = getNetworkConfig(state.network);
  const strk = networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const amountBase = parseAmountToBase(amount, strk.decimals);
      if (amountBase <= 0n) throw new Error('Amount must be greater than zero.');
      const call = {
        contractAddress: strk.address,
        entrypoint: 'transfer',
        calldata: CallData.compile({ recipient, amount: amountBase }),
      };
      const { transactionHash } = await runtime.send(call);
      setNotice(`Transaction submitted (locally signed): ${transactionHash}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, amount, strk, recipient]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-1">Send STRK</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Signed locally by your Orrange wallet ({account.accountType}) — no third party involved.
      </p>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}
      {notice && <div className="rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-sm p-3 mb-4 break-all">{notice}</div>}

      <label className="block text-sm text-zinc-400 mb-1">Recipient</label>
      <input
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="0x…"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
      />
      <label className="block text-sm text-zinc-400 mb-1">Amount ({strk.symbol})</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4"
      />
      <button
        onClick={handleSend}
        disabled={busy || !recipient || !amount}
        className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
        Send STRK
      </button>
    </section>
  );
};

/** Legacy STRK20 privacy-lane note for the Wallet Core runtime (viewing keys are a later stage). */
export const LegacyStrk20CompatNote: React.FC<{ available: boolean; modeLabel: string }> = ({ available, modeLabel }) => {
  if (available) return null;
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-violet-300 mt-0.5" />
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">STRK20 private {modeLabel} — legacy lane</h2>
          <p className="text-xs text-zinc-500 mt-1">
            STRK20 private {modeLabel} still requires the legacy Ready privacy-wallet lane (viewing
            keys / proofs are owned by that runtime). It is not yet wired into the Wallet Core
            runtime — the Wallet Core signer is ready for STRK20, but private capabilities arrive
            in a later stage. Public sends work now via your Orrange wallet.
          </p>
        </div>
      </div>
    </div>
  );
};