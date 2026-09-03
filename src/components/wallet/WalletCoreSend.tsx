'use client';

import React, { useCallback, useState } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { buildPublicTransferCall } from '@/wallet/publicTransfer';
import { getNetworkConfig } from '@/config/networks';

/**
 * The primary Orrange SEND surface. Uses the Wallet Core runtime's local signer for ordinary
 * public STRK transactions — no Privy, no external extension, no Wallet API.
 *
 * ENCODING: ERC20 `transfer(recipient, amount: u256)` requires `[recipient, amountLow,
 * amountHigh]`. The amount is encoded with starknet.js's canonical `uint256.bnToUint256` via
 * `buildPublicTransferCall` (NOT a single felt — a lone bigint would fail deserialization of
 * u256 param #2 on-chain). Amount parsing stays the exact integer-only `parseAmountToBase`.
 */
export const WalletCoreSend: React.FC = () => {
  const { runtime, state } = useWalletRuntime();
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
      const call = buildPublicTransferCall(strk.address, recipient, amountBase);
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