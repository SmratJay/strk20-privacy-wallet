'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, ArrowUpRight, ArrowDownLeft, Clock, Settings as SettingsIcon, Lock } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { ConnectWalletModal } from '@/components/ConnectWalletModal';
import { shortenAddress } from '@/utils/formatters';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Lock },
  { href: '/send', label: 'Send', icon: ArrowUpRight },
  { href: '/receive', label: 'Receive', icon: ArrowDownLeft },
  { href: '/activity', label: 'Activity', icon: Clock },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { wallet, currentNetwork, isSepolia } = useWallet();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-300">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-semibold text-zinc-100">STRK20</div>
              <div className="text-[10px] text-violet-300/80 font-medium">Private Wallet</div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                isSepolia
                  ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-900'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isSepolia ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              {isSepolia ? 'Sepolia' : 'Mainnet'}
            </span>

            {wallet.isConnected && wallet.address ? (
              <div className="flex items-center gap-2">
                <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
                  {shortenAddress(wallet.address, 6)}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
              </div>
            ) : (
              <button
                onClick={wallet.openConnectModal}
                className="text-[12px] font-semibold px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:block border-t border-zinc-800/50">
          <div className="max-w-2xl mx-auto px-4 flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                    active
                      ? 'border-violet-500 text-zinc-100'
                      : 'border-transparent text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {/* Main */}
      <main className="flex-1 w-full">
        <div className="max-w-2xl mx-auto px-4 py-6 pb-24 sm:pb-10">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md">
        <div className="flex items-stretch justify-around">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? 'text-violet-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Connect modal */}
      <ConnectWalletModal
        isOpen={wallet.isConnectModalOpen}
        onClose={wallet.closeConnectModal}
        supportedWallets={wallet.supportedWallets}
        isConnecting={wallet.isConnecting}
        connectingWalletId={wallet.connectingWalletId}
        connectionError={wallet.error}
        onSelectWallet={wallet.connectWallet}
        onRescan={wallet.rescan}
      />
    </div>
  );
};
