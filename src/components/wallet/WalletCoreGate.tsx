'use client';

import React, { useCallback, useState } from 'react';
import { KeyRound, Lock, Loader2, Plus, ArrowRightLeft } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { isReadyAccountSupported, isBraavosAccountSupported, type WalletAccountType } from '@/wallet';
import { shortenAddress } from '@/utils/formatters';

/**
 * The primary Orrange wallet entry gate. Replaces the legacy ConnectWalletModal / ConnectGate as
 * the main flow for `/wallet`: Create a new Wallet Core wallet, or Import an existing
 * Ready/Braavos account (ownership verified on-chain, encrypted persistence, same address).
 */
export const WalletCoreGate: React.FC = () => {
  const { runtime, state } = useWalletRuntime();

  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [existingAddress, setExistingAddress] = useState('');
  const [importType, setImportType] = useState<WalletAccountType>('ready-v0.4.0');
  const [busy, setBusy] = useState(false);

  const readySupported = isReadyAccountSupported(state.network);
  const braavosSupported = isBraavosAccountSupported(state.network);
  const hasWallets = state.wallets.length > 0;

  const handleCreate = useCallback(async () => {
    setBusy(true);
    try {
      await runtime.create(password);
    } finally {
      setBusy(false);
    }
  }, [runtime, password]);

  const handleImport = useCallback(async () => {
    setBusy(true);
    try {
      await runtime.import({
        accountType: importType,
        secret,
        password,
        address: existingAddress.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [runtime, importType, secret, password, existingAddress]);

  const handleUnlock = useCallback(async () => {
    setBusy(true);
    try {
      await runtime.unlock(password);
    } finally {
      setBusy(false);
    }
  }, [runtime, password]);

  const importReady = importType === 'ready-v0.4.0';

  return (
    <div className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-900 bg-red-950/40 text-red-300 text-sm p-3">
          {state.error}
        </div>
      )}

      {/* Returning user: stored wallets → select + unlock */}
      {hasWallets && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">Your wallets</h2>
          <ul className="space-y-2">
            {state.wallets.map((entry) => {
              const selected = state.selectedWalletId === entry.walletId;
              return (
                <li
                  key={entry.walletId}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    selected ? 'border-orange-500/60 bg-orange-950/20' : 'border-zinc-800 bg-zinc-900/40'
                  }`}
                >
                  <button
                    onClick={() => runtime.selectWallet(entry.walletId)}
                    className="text-left flex-1"
                  >
                    <div className="text-sm">
                      {entry.accountType} <span className="text-zinc-500">· {entry.source}</span>
                    </div>
                    <div className="font-mono text-xs text-zinc-400">{shortenAddress(entry.address, 6)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="block text-sm text-zinc-400 mt-4 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Unlock password"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
          />
          <button
            onClick={handleUnlock}
            disabled={busy || !password || !state.selectedWalletId}
            className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Unlock
          </button>
        </section>
      )}

      {/* New wallet: Create | Import */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setMode('create')}
            className={`px-3 py-1 rounded-md text-sm border ${
              mode === 'create' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            Create wallet
          </button>
          <button
            onClick={() => setMode('import')}
            className={`px-3 py-1 rounded-md text-sm border ${
              mode === 'import' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            Import existing wallet
          </button>
        </div>

        {mode === 'create' ? (
          <>
            <label className="block text-sm text-zinc-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />
            <button
              onClick={handleCreate}
              disabled={busy || password.length < 8}
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create wallet
            </button>
            <p className="text-xs text-zinc-500 mt-3">
              Generates a local STARK key, derives your Ready account, and encrypts it with your
              password (AES-GCM + PBKDF2). Nothing leaves your device.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-zinc-400">Account type</span>
              <button
                onClick={() => setImportType('ready-v0.4.0')}
                disabled={!readySupported}
                className={`px-3 py-1 rounded-md text-sm border ${
                  importReady ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
                } ${!readySupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Ready
              </button>
              <button
                onClick={() => setImportType('braavos-v1.2.0')}
                disabled={!braavosSupported}
                className={`px-3 py-1 rounded-md text-sm border ${
                  !importReady ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
                } ${!braavosSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Braavos
              </button>
            </div>

            <label className="block text-sm text-zinc-400 mb-1">Private key / recovery secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="0x…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <label className="block text-sm text-zinc-400 mb-1">
              Existing account address
              {importReady
                ? ' (optional — verified against the derived address)'
                : ' (required — Braavos addresses are not derivable from a key)'}
            </label>
            <input
              value={existingAddress}
              onChange={(e) => setExistingAddress(e.target.value)}
              placeholder="0x…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <label className="block text-sm text-zinc-400 mb-1">New wallet password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <button
              onClick={handleImport}
              disabled={
                busy ||
                !secret ||
                password.length < 8 ||
                (!importReady && !existingAddress.trim())
              }
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
              Verify & import
            </button>
            <p className="text-xs text-zinc-500 mt-3">
              Ownership is verified on-chain (derivation for Ready; get_public_key / SRC-5 for
              Braavos). Your address is preserved — importing never creates a new account.
            </p>
          </>
        )}
      </section>

      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
        <KeyRound className="w-3 h-3" />
        Self-custodial: your keys are encrypted locally with your password. No Google sign-in, no
        extension required.
      </p>
    </div>
  );
};