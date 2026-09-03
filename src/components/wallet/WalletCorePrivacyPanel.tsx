'use client';

import React, { useCallback, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Shield, Loader2 } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { parseAmountToBase } from '@/wallet';
import { getNetworkConfig } from '@/config/networks';

type Op = 'TRANSFER' | 'SHIELD' | 'WITHDRAW';

const OPS: { id: Op; label: string; Icon: typeof Shield }[] = [
  { id: 'TRANSFER', label: 'Private send', Icon: ArrowUpRight },
  { id: 'SHIELD', label: 'Shield', Icon: Shield },
  { id: 'WITHDRAW', label: 'Withdraw', Icon: ArrowDownLeft },
];

/**
 * Wallet Core STRK20 privacy panel: private send / shield / withdraw signed and managed entirely
 * by the Wallet Core local signer + the wallet-native viewing key. No Privy, no external wallet,
 * no Wallet API. The UI receives only a safe result (transaction hash + status) — never notes,
 * proofs, or viewing keys.
 */
export const WalletCorePrivacyPanel: React.FC<{ initialOp?: Op }> = ({ initialOp }) => {
  const runtime = useWalletRuntime();
  const state = runtime.getState();
  const networkConfig = getNetworkConfig(state.network);
  const strk = networkConfig.tokens.find((t) => t.symbol === 'STRK') ?? networkConfig.tokens[0];

  const [op, setOp] = useState<Op>(initialOp ?? 'TRANSFER');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const amountBase = parseAmountToBase(amount, strk.decimals);
      if (amountBase <= 0n) throw new Error('Amount must be greater than zero.');
      let result: { transactionHash: string; status: string };
      if (op === 'TRANSFER') {
        if (!recipient) throw new Error('Recipient is required for a private transfer.');
        result = await runtime.privateTransfer(strk.address, amountBase, recipient);
      } else if (op === 'SHIELD') {
        result = await runtime.shield(strk.address, amountBase);
      } else {
        result = await runtime.withdraw(strk.address, amountBase);
      }
      setNotice(`STRK20 ${op.toLowerCase()} submitted: ${result.transactionHash} (${result.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STRK20 operation failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime, op, strk, amount, recipient]);

  if (!state.privacy.available) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-1">STRK20 privacy — unavailable</h2>
        <p className="text-xs text-zinc-500">
          {state.privacy.reason ?? 'STRK20 privacy is not available for this wallet yet.'} The
          Wallet Core signer and viewing key are ready, but private operations need the proving /
          discovery services to be configured.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h2 className="text-sm font-semibold text-zinc-200 mb-1">STRK20 privacy (Wallet Core)</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Signed and managed by your Orrange wallet + wallet-native viewing key. No extension, no
        third-party wallet.
      </p>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3 mb-4">{error}</div>}
      {notice && <div className="rounded-md border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-sm p-3 mb-4 break-all">{notice}</div>}

      <div className="flex items-center gap-3 mb-4">
        {OPS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setOp(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm border ${
              op === id ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {op === 'TRANSFER' && (
        <>
          <label className="block text-sm text-zinc-400 mb-1">Recipient</label>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
          />
        </>
      )}

      <label className="block text-sm text-zinc-400 mb-1">Amount ({strk.symbol})</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.000"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-4"
      />

      <button
        onClick={handleRun}
        disabled={busy || !amount || (op === 'TRANSFER' && !recipient)}
        className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {op === 'SHIELD' ? 'Shield' : op === 'WITHDRAW' ? 'Withdraw' : 'Send privately'}
      </button>
    </section>
  );
};