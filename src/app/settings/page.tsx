'use client';

import React, { useState } from 'react';
import { Wallet, EyeOff, Info, Copy, Check, ChevronRight, Loader2, Shield, ShieldCheck, ShieldAlert, Lock, LogOut } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { copyToClipboard, shortenAddress } from '@/utils/formatters';
import type { WalletDeploymentStatus } from '@/wallet';
import { walletOperationPending } from '@/utils/walletUx';

const DEPLOY_LABEL: Record<WalletDeploymentStatus, string> = {
  deployed: 'Deployed',
  not_deployed: 'Deployment pending',
  pending: 'Deploying…',
  finalizing: 'Confirming…',
  error: 'Deployment failed',
  unknown: 'Unknown',
};

function PrivacyStatusIcon({ state }: { state: ReturnType<typeof useWalletRuntime>['state'] }) {
  if (!state.privacy.available) return <ShieldAlert className="w-4 h-4 text-zinc-500" />;
  if (state.privacy.status === 'error') return <ShieldAlert className="w-4 h-4 text-red-300" />;
  if (state.privacy.registered === true) return <ShieldCheck className="w-4 h-4 text-emerald-300" />;
  return <Shield className="w-4 h-4 text-violet-300" />;
}

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-zinc-800/70 text-sm font-semibold text-zinc-200">
      <span className="text-violet-300">{icon}</span>
      {title}
    </div>
    <div className="divide-y divide-zinc-800/60">{children}</div>
  </div>
);

/**
 * Settings — derives EVERYTHING from WalletRuntime / Wallet Core. There is no Privy account,
 * no Google account, no embedded-wallet state, and no legacy enablement flag. "Enabled" here
 * means the Wallet Core account is deployed and STRK20 privacy is registered/available.
 */
export default function SettingsPage() {
  const { runtime, state } = useWalletRuntime();
  const account = state.account;
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const pending = walletOperationPending(state) || state.recentTransactions.some(tx => tx.status === 'pending');

  const handleCopyAddress = async () => {
    if (!account) return;
    if (await copyToClipboard(account.address)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / SETTINGS</div>
            <h1 className="product-page-title">Settings</h1>
            <p className="product-page-description">Your account, security and privacy preferences.</p>
          </div>
        </div>

        {!account ? (
          <WalletCoreGate />
        ) : (
          <>
            <Section title="Wallet" icon={<Wallet className="w-4 h-4" />}>
              <div className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm">◌</div>
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Orrange</div>
                    <div className="text-[12px] text-zinc-500 font-mono">{shortenAddress(account.address, 8)}</div>
                  </div>
                </div>
                <button aria-label={copied ? 'Address copied' : 'Copy wallet address'} onClick={handleCopyAddress} className="wallet-secondary-button text-zinc-500 hover:text-zinc-300 transition-colors">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-3 text-sm">
                <Row label="Wallet ID" value={shortenAddress(account.walletId, 8)} />
                <Row label="Account type" value={account.accountType} />
                <Row label="Network" value={state.network} />
                <Row label="Deployment" value={DEPLOY_LABEL[state.deploymentStatus]} />
              </div>
              <div className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="flex items-center gap-2 text-zinc-400">
                  <Lock className="w-4 h-4" /> Session
                </span>
                <span className="text-zinc-200">{state.isUnlocked ? 'Unlocked' : 'Locked'}</span>
              </div>
              <button
                onClick={() => runtime.lock()}
                className="w-full flex items-center gap-2 px-5 py-3.5 text-sm text-rose-300 hover:bg-rose-500/5 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Lock wallet
              </button>
            </Section>

            <Section title="Privacy" icon={<EyeOff className="w-4 h-4" />}>
              <div className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-zinc-400">Status</span>
                <span className="flex items-center gap-2 text-zinc-200">
                  <PrivacyStatusIcon state={state} />
                  {!state.privacy.available
                    ? 'Unavailable'
                    : state.privacy.registered === true
                      ? 'Registered'
                      : state.privacy.registered === false
                        ? 'Available — not registered'
                        : state.privacy.status === 'error'
                          ? 'Error'
                          : 'Checking…'}
                </span>
              </div>
              {!state.privacy.available ? (
                <div className="px-5 py-3 text-[12px] text-zinc-500">
                  Privacy services aren’t configured for this network. Your public wallet remains available.
                  <details className="mt-2"><summary>Service details</summary><p className="break-words mt-2">{state.privacy.reason}</p></details>
                </div>
              ) : state.privacy.status === 'error' ? (
                <div className="px-5 py-3 text-[12px]">We couldn’t check your private balance. Try refreshing from Wallet.<details className="mt-2"><summary>Service details</summary><p className="break-words mt-2">{state.privacy.reason}</p></details></div>
              ) : state.privacy.registered === true ? (
                <div className="px-5 py-3 text-[12px] text-zinc-500">
                  Your private balance is ready. Shield, send privately or unshield from Wallet.
                </div>
              ) : (
                <div className="px-5 py-3 text-[12px] text-zinc-500">
                  Your first shield automatically sets up private receiving.
                </div>
              )}
              <div className="px-5 py-4">
                <PrivacyInfo />
              </div>
            </Section>

            <Section title="Account actions" icon={<Shield className="w-4 h-4" />}>
              <label className="block p-5 text-sm">Switch wallet<select aria-label="Switch wallet" value={state.selectedWalletId ?? ''} disabled={pending} onChange={event => runtime.selectWallet(event.target.value)} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 mt-2 p-3">{state.wallets.map(w => <option key={w.walletId} value={w.walletId}>{w.accountType.startsWith('ready') ? 'Ready' : 'Braavos'} · {shortenAddress(w.address, 6)}</option>)}</select><span className="text-xs text-zinc-500 block mt-2">Switching locks the current wallet and clears session activity.</span></label>
              {pending && <p className="p-5 text-xs">A transaction is still in progress. Save its reference and check Activity before changing wallets or locking.</p>}
              <button
                onClick={() => setDeleteConfirm(true)}
                disabled={pending}
                className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-red-300 hover:bg-red-500/5 transition-colors"
              >
                <span>Remove wallet from this device</span>
                <ChevronRight className="w-4 h-4 text-zinc-500" />
              </button>
              {deleteConfirm && <div className="p-5 space-y-3" role="group" aria-label="Confirm wallet removal">
                <p className="text-sm font-semibold">This removes your encrypted wallet from this device.</p><p className="text-sm text-zinc-500">Without a recovery backup, you may permanently lose access to funds. This does not delete your on-chain account. Never remove a wallet while a transaction is pending.</p>
                <label className="block text-sm">Type REMOVE to confirm<input autoComplete="off" value={deleteText} onChange={event => setDeleteText(event.target.value)} className="w-full border border-zinc-800 bg-zinc-950 p-3 rounded-xl mt-2" /></label>
                <div className="flex flex-wrap gap-3"><button className="wallet-secondary-button" onClick={() => { setDeleteConfirm(false); setDeleteText(''); }}>Cancel</button><button className="wallet-secondary-button text-red-300 disabled:opacity-50" disabled={deleteText !== 'REMOVE' || pending} onClick={() => runtime.deleteWallet(account.walletId)}>Remove wallet</button></div>
              </div>}
            </Section>

            <Section title="About" icon={<Info className="w-4 h-4" />}>
              <div className="px-5 py-3.5 space-y-1 text-sm">
                <p className="text-zinc-300">ORRANGE</p>
                <p className="text-[12px] text-zinc-500">
                  A self-custodial Starknet wallet with native STRK20 privacy. Keys are encrypted
                  locally; the wallet is the only account identity.
                </p>
              </div>
            </Section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-zinc-500">{label}</span>
      <span className="text-zinc-200 font-mono break-all">{value}</span>
    </div>
  );
}

// Loader2 referenced for future async states; kept imported to avoid unused-icon churn.
void Loader2;
