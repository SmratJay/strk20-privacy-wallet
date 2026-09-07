'use client';

import React, { useCallback, useRef, useState } from 'react';
import { KeyRound, Lock, Loader2, Plus, ArrowRightLeft } from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { isReadyAccountSupported, isBraavosAccountSupported, type WalletAccountType } from '@/wallet';
import { shortenAddress } from '@/utils/formatters';
import { WalletError } from './TransactionFeedback';

/**
 * The primary Orrange wallet entry gate. Replaces the legacy connect modal / gate as
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const flight = useRef(false);

  const readySupported = isReadyAccountSupported(state.network);
  const braavosSupported = isBraavosAccountSupported(state.network);
  const hasWallets = state.wallets.length > 0;

  const handleCreate = useCallback(async () => {
    if (flight.current || password !== confirmPassword || password.length < 8) return;
    flight.current = true;
    setBusy(true);
    try {
      await runtime.create(password);
    } catch {
      // WalletRuntime exposes the actionable error above; avoid an unhandled event rejection.
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }, [runtime, password, confirmPassword]);

  const handleImport = useCallback(async () => {
    if (flight.current || password !== confirmPassword || password.length < 8) return;
    flight.current = true;
    setBusy(true);
    try {
      await runtime.import({
        accountType: importType,
        secret,
        password,
        address: existingAddress.trim() || undefined,
      });
    } catch {
      // WalletRuntime owns the error state.
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }, [runtime, importType, secret, password, existingAddress, confirmPassword]);

  const handleUnlock = useCallback(async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      await runtime.unlock(password);
    } catch {
      // WalletRuntime owns the error state.
    } finally {
      setBusy(false);
      flight.current = false;
    }
  }, [runtime, password]);

  const importReady = importType === 'ready-v0.4.0';

  return (
    <fieldset disabled={busy} className="wallet-onboarding space-y-4 min-w-0" aria-busy={busy}>
      <WalletError error={state.error} />

      {/* Returning user: stored wallets → select + unlock */}
      {hasWallets && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-lg font-semibold text-zinc-200 mb-1">Welcome back</h2>
          <p className="text-sm text-zinc-500 mb-4">Unlock a wallet on {state.network === 'mainnet' ? 'Mainnet' : 'Sepolia testnet'} to continue.</p>
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
                      {entry.accountType.startsWith('ready') ? 'Ready' : 'Braavos'} wallet <span className="text-zinc-500">{selected ? '· Selected' : ''}</span>
                    </div>
                    <div className="font-mono text-xs text-zinc-400">{shortenAddress(entry.address, 6)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          <label htmlFor="wallet-unlock-password" className="block text-sm text-zinc-400 mt-4 mb-1">Password</label>
          <input
            type="password"
            id="wallet-unlock-password"
            autoComplete="current-password"
            onKeyDown={event => { if (event.key === 'Enter' && password) void handleUnlock(); }}
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
            {busy ? 'Unlocking your wallet…' : 'Unlock wallet'}
          </button>
        </section>
      )}

      {/* New wallet: Create | Import */}
      <details open={!hasWallets} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <summary className="text-sm font-medium mb-4">{hasWallets ? 'Add another wallet' : 'Get started with Orrange'}</summary>
        <h2 className="text-lg font-semibold mb-1">Create your private wallet</h2>
        <p className="text-xs text-zinc-400 mb-4">Self-custodial Starknet wallet · {state.network === 'mainnet' ? 'Mainnet' : 'Sepolia test network'}. Keep your recovery backup safe; Orrange cannot recover a lost password or key.</p>
        <div className="wallet-tabs mb-4">
          <button
            onClick={() => setMode('create')}
            aria-pressed={mode === 'create'}
            className={`px-3 py-1 rounded-md text-sm border ${
              mode === 'create' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            Create wallet
          </button>
          <button
            onClick={() => setMode('import')}
            aria-pressed={mode === 'import'}
            className={`px-3 py-1 rounded-md text-sm border ${
              mode === 'import' ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
            }`}
          >
            Import existing wallet
          </button>
        </div>

        {mode === 'create' ? (
          <>
            <label htmlFor="wallet-create-password" className="block text-sm text-zinc-400 mb-1">Password</label>
            <input
              id="wallet-create-password"
              autoComplete="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />
            <label className="block text-sm text-zinc-400 mb-3">Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 mt-1" /></label>
            {confirmPassword && password !== confirmPassword && <p className="text-xs mb-3" role="status">Passwords don’t match yet.</p>}
            <button
              onClick={handleCreate}
              disabled={busy || password.length < 8 || password !== confirmPassword}
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {busy ? 'Creating your wallet…' : 'Create wallet'}
            </button>
            <p className="text-xs text-zinc-500 mt-3">
              Your keys are encrypted on this device. Remember your password and keep a recovery backup before funding your wallet.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="text-sm text-zinc-400">Account type</span>
              <button
                onClick={() => setImportType('ready-v0.4.0')}
                aria-pressed={importReady}
                disabled={!readySupported}
                className={`px-3 py-1 rounded-md text-sm border ${
                  importReady ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
                } ${!readySupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Ready
              </button>
              <button
                onClick={() => setImportType('braavos-v1.2.0')}
                aria-pressed={!importReady}
                disabled={!braavosSupported}
                className={`px-3 py-1 rounded-md text-sm border ${
                  !importReady ? 'border-orange-500 text-orange-400' : 'border-zinc-800 text-zinc-400'
                } ${!braavosSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Braavos
              </button>
            </div>
            {!braavosSupported && <p className="text-xs text-zinc-500 mb-3">Braavos import is not supported on this network yet. Use a supported Ready account.</p>}

            <label htmlFor="wallet-import-secret" className="block text-sm text-zinc-400 mb-1">Private key</label>
            <input
              type="password"
              id="wallet-import-secret"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="0x…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <label htmlFor="wallet-import-address" className="block text-sm text-zinc-400 mb-1">
              Existing account address
              {importReady
                ? ' (optional — verified against the derived address)'
                : ' (required — Braavos addresses are not derivable from a key)'}
            </label>
            <input
              id="wallet-import-address"
              value={existingAddress}
              onChange={(e) => setExistingAddress(e.target.value)}
              placeholder="0x…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <label htmlFor="wallet-import-password" className="block text-sm text-zinc-400 mb-1">New wallet password</label>
            <input
              type="password"
              id="wallet-import-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm mb-3"
            />

            <label className="block text-sm text-zinc-400 mb-3">Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 mt-1" /></label>
            {confirmPassword && password !== confirmPassword && <p className="text-xs mb-3" role="status">Passwords don’t match yet.</p>}
            <p className="text-xs text-zinc-500 mb-3">Use an exported Starknet private key, not a seed phrase. Never share it with anyone.</p>
            <button
              onClick={handleImport}
              disabled={
                busy ||
                !secret ||
                password.length < 8 ||
                password !== confirmPassword ||
                (!importReady && !existingAddress.trim())
              }
              className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
              {busy ? 'Verifying your wallet…' : 'Import wallet'}
            </button>
            <p className="text-xs text-zinc-500 mt-3">
              We verify that your key controls this account. Your existing address is preserved.
            </p>
          </>
        )}
      </details>

      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
        <KeyRound className="w-3 h-3" />
        Only you control your wallet. Orrange cannot reset a lost password or recover your keys.
      </p>
    </fieldset>
  );
};
