'use client';

import React, { useState } from 'react';
import { Wallet, EyeOff, Globe, Info, Copy, Check, LogOut, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { PrivacyInfo } from '@/components/wallet/PrivacyInfo';
import { EnablePrivateReceiving } from '@/components/wallet/EnablePrivateReceiving';
import { SettingsActions } from '@/components/wallet/SettingsActions';
import { useWallet } from '@/context/WalletContext';
import { usePrivyWallet } from '@/context/PrivyWalletContext';
import { copyToClipboard, shortenAddress } from '@/utils/formatters';

export default function SettingsPage() {
  const { wallet, networkId, setNetworkId, privateReceivingState } = useWallet();
  const privy = usePrivyWallet();
  const privyConnected = privy.authenticated && privy.account !== null;
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (!wallet.address) return;
    if (await copyToClipboard(wallet.address)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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

  return (
    <AppShell>
      <div className="product-page">
        <div className="product-page-intro">
          <div>
            <div className="product-eyebrow">ORRANGE / SETTINGS</div>
            <h1 className="product-page-title">Settings</h1>
            <p className="product-page-description">Account, privacy, network, and wallet controls.</p>
          </div>
        </div>

        <Section title="Actions" icon={<SlidersHorizontal className="w-4 h-4" />}>
          {privyConnected ? (
            <SettingsActions />
          ) : (
            <div className="px-5 py-4 text-sm text-zinc-400">
              Connect your wallet to manage account deployment and STRK20 privacy transactions.
            </div>
          )}
        </Section>

        <Section title="Wallet" icon={<Wallet className="w-4 h-4" />}>
          {wallet.isConnected && wallet.address ? (
            <>
              <div className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm">
                    {wallet.walletIcon || '🛡️'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{wallet.walletName}</div>
                    <div className="text-[12px] text-zinc-500 font-mono">
                      {shortenAddress(wallet.address, 8)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleCopyAddress}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={wallet.disconnectWallet}
                className="w-full flex items-center gap-2 px-5 py-3.5 text-sm text-rose-300 hover:bg-rose-500/5 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={wallet.openConnectModal}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm text-zinc-100 hover:bg-zinc-900/60 transition-colors"
            >
              <span>Connect a privacy wallet</span>
              <ChevronRight className="w-4 h-4 text-zinc-500" />
            </button>
          )}
        </Section>

        <Section title="Privacy" icon={<EyeOff className="w-4 h-4" />}>
          {!privyConnected && wallet.isConnected && privateReceivingState === 'NEEDS_REGISTRATION' ? (
            <div className="p-4">
              <EnablePrivateReceiving />
            </div>
          ) : (
            <div className="p-4">
              <PrivacyInfo />
            </div>
          )}
        </Section>

        <Section title="Network" icon={<Globe className="w-4 h-4" />}>
          {(['mainnet', 'sepolia'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setNetworkId(id)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-sm hover:bg-zinc-900/60 transition-colors"
            >
              <span className="text-zinc-100 capitalize">{id}</span>
              <span
                className={`w-4 h-4 rounded-full border-2 ${
                  networkId === id ? 'border-violet-500 bg-violet-500' : 'border-zinc-600'
                }`}
              />
            </button>
          ))}
        </Section>

        <Section title="About" icon={<Info className="w-4 h-4" />}>
          <div className="px-5 py-3.5 space-y-1 text-sm">
            <p className="text-zinc-300">STRK20 Private Wallet</p>
            <p className="text-[12px] text-zinc-500">
              Receive privately, spend freely. Built on the STRK20 privacy pool on Starknet.
            </p>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
