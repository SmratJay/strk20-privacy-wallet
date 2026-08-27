'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, Rocket, ShieldCheck } from 'lucide-react';
import { usePrivyWallet } from '@/context/PrivyWalletContext';

type ActionState = 'idle' | 'pending' | 'error';

/**
 * Settings → Actions.
 *
 * Two independent on-chain statuses, reconstructed from chain/pool state (never localStorage,
 * never an optimistic boolean):
 *   - Account: whether the derived Ready Starknet account is deployed (getClassHashAt).
 *   - Privacy Transactions: whether the STRK20 viewing key is registered in the pool
 *     (discovery preflight / discoverRequirement).
 *
 * A successful enabling transaction is reconciled against on-chain state; a later discovery
 * refresh failure does NOT turn a successful transaction into a failure.
 */
export const SettingsActions: React.FC = () => {
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null;

  const [accountAction, setAccountAction] = useState<ActionState>('idle');
  const [privacyAction, setPrivacyAction] = useState<ActionState>('idle');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  // Reconstruct authoritative statuses on mount / connection change / account change.
  const connectedKey = privyConnected ? privy.address : null;
  useEffect(() => {
    if (!privyConnected) return;
    void privy.refreshAccountDeploymentStatus();
    void privy.refreshPrivacyRegistrationStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKey]);

  const accountStatus = privy.accountStatus;
  const privacyStatus = privy.privacyStatus;

  const handleEnableAccount = useCallback(async () => {
    if (!privyConnected || accountStatus === 'enabled') return;
    setAccountAction('pending');
    setAccountError(null);
    try {
      const ok = await privy.enableAccount();
      if (ok) {
        await privy.refreshAccountDeploymentStatus();
        setAccountAction('idle');
      } else {
        // Reconcile: the deploy helper may have failed on a non-fatal step (e.g. finality).
        await privy.refreshAccountDeploymentStatus();
        if (privy.accountStatus === 'enabled') {
          setAccountAction('idle');
          return;
        }
        setAccountError('Account could not be enabled. Fund the account and retry.');
        setAccountAction('error');
      }
    } catch {
      setAccountError('Account could not be enabled. Fund the account and retry.');
      setAccountAction('error');
    }
  }, [privy, privyConnected, accountStatus]);

  const handleEnablePrivacy = useCallback(async () => {
    if (!privyConnected || privacyStatus === 'enabled') return;
    setPrivacyAction('pending');
    setPrivacyError(null);
    try {
      const ok = await privy.enablePrivacy();
      if (ok) {
        await privy.refreshPrivacyRegistrationStatus();
        setPrivacyAction('idle');
      } else {
        await privy.refreshPrivacyRegistrationStatus();
        if (privy.privacyStatus === 'enabled') {
          setPrivacyAction('idle');
          return;
        }
        setPrivacyError('Privacy registration did not complete. Ensure the account is enabled and funded, then retry.');
        setPrivacyAction('error');
      }
    } catch {
      setPrivacyError('Privacy registration did not complete. Ensure the account is enabled and funded, then retry.');
      setPrivacyAction('error');
    }
  }, [privy, privyConnected, privacyStatus]);

  const accountBusy = accountAction === 'pending' || accountStatus === 'pending';
  const privacyBusy = privacyAction === 'pending' || privacyStatus === 'pending';
  const privacyBlocked = accountStatus !== 'enabled';

  return (
    <div className="divide-y divide-zinc-800/60">
      {/* ── Account ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">Account</div>
              <div className="text-[12px] text-zinc-400">
                Initialize your Starknet account for on-chain transactions.
              </div>
            </div>
          </div>
          {accountStatus === 'enabled' ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-300 shrink-0">
              <CheckCircle2 className="w-4 h-4" /> Enabled
            </span>
          ) : (
            <button
              onClick={handleEnableAccount}
              disabled={!privyConnected || accountBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-semibold transition-colors shrink-0"
            >
              {accountBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {accountBusy ? 'Enabling…' : 'Enable Account'}
            </button>
          )}
        </div>
        {accountStatus === 'error' || accountError ? (
          <div className="flex items-start gap-2 text-[12px] text-rose-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{accountError || 'Account status could not be determined.'}</span>
          </div>
        ) : null}
      </div>

      {/* ── Privacy Transactions ───────────────────────────────────────── */}
      <div className="px-5 py-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center text-violet-300 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">Privacy Transactions</div>
              <div className="text-[12px] text-zinc-400">
                Enable STRK20 private transactions for this account.
              </div>
            </div>
          </div>
          {privacyStatus === 'enabled' ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-300 shrink-0">
              <CheckCircle2 className="w-4 h-4" /> Privacy Enabled
            </span>
          ) : (
            <button
              onClick={handleEnablePrivacy}
              disabled={!privyConnected || privacyBusy || privacyBlocked}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-semibold transition-colors shrink-0"
            >
              {privacyBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {privacyBusy ? 'Enabling…' : 'Enable Privacy Transactions'}
            </button>
          )}
        </div>
        {privacyBlocked && privacyStatus !== 'enabled' && privyConnected ? (
          <p className="text-[11px] text-amber-300/90">Enable your Account first, then enable Privacy Transactions.</p>
        ) : null}
        {privacyStatus === 'error' || privacyError ? (
          <div className="flex items-start gap-2 text-[12px] text-rose-300">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{privacyError || 'Privacy status could not be determined.'}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};