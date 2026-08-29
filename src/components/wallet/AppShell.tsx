'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Menu,
  Moon,
  Repeat,
  Rocket,
  Settings,
  ShieldCheck,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { ConnectWalletModal } from '@/components/ConnectWalletModal';
import { useToast } from '@/components/Toast';
import { shortenAddress, copyToClipboard } from '@/utils/formatters';

const PRIMARY_NAV = [
  { href: '/wallet', label: 'Wallet', icon: ShieldCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const ACTION_NAV = [
  { href: '/send', label: 'Send', icon: ArrowUpRight },
  { href: '/receive', label: 'Receive', icon: ArrowDownLeft },
  { href: '/swap', label: 'Swap', icon: Repeat },
  { href: '/launch', label: 'Launch', icon: Rocket },
  { href: '/extended', label: 'Trade', icon: TrendingUp },
];

type AppTheme = 'light' | 'dark';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { wallet, currentNetwork, isSepolia } = useWallet();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<AppTheme>('light');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('orrange-product-theme');
    if (stored === 'dark' || stored === 'light') setTheme(stored);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      window.localStorage.setItem('orrange-product-theme', next);
      return next;
    });
  };

  const handleCopyAddress = async () => {
    if (!wallet.address) return;
    const ok = await copyToClipboard(wallet.address);
    if (ok) {
      setCopied(true);
      showToast({
        type: 'success',
        title: 'Address copied',
        description: `${shortenAddress(wallet.address, 6)} copied to clipboard.`,
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast({ type: 'error', title: 'Could not copy address', description: 'Try again from your wallet.' });
    }
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="product-app min-h-screen" data-theme={theme}>
      <header className="product-header">
        <div className="product-header-inner">
          <Link href="/" className="product-brand" aria-label="Return to ORRANGE home">
            <span className="product-brand-mark">
              <img src="/orrange.png" alt="" aria-hidden="true" />
            </span>
            <span>
              <span className="product-brand-name">ORRANGE</span>
              <span className="product-brand-subtitle">private wallet</span>
            </span>
          </Link>

          <nav className="product-primary-nav" aria-label="Primary navigation">
            {PRIMARY_NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`product-nav-link ${isActive(href) ? 'is-active' : ''}`}>
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
            <details className="product-actions-menu">
              <summary className="product-nav-link">
                <span>Actions</span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="product-actions-popover">
                {ACTION_NAV.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} className={`product-menu-link ${isActive(href) ? 'is-active' : ''}`}>
                    <Icon aria-hidden="true" />
                    {label}
                  </Link>
                ))}
              </div>
            </details>
          </nav>

          <div className="product-header-tools">
            <button type="button" className="product-mobile-menu-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-controls="product-mobile-menu" aria-label={mobileMenuOpen ? 'Close app menu' : 'Open app menu'}>
              {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
            <span className="product-network-status" title={`Connected to ${currentNetwork.name}`}>
              <span className={isSepolia ? 'is-sepolia' : 'is-mainnet'} />
              {isSepolia ? 'Sepolia' : 'Mainnet'}
            </span>
            <button type="button" className="product-icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-pressed={theme === 'dark'}>
              {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
            {wallet.isConnected && wallet.address ? (
              <button type="button" onClick={handleCopyAddress} className="product-account-button" title="Copy wallet address">
                <span className="product-account-avatar">{wallet.walletIcon || '◌'}</span>
                <span className="product-account-copy">
                  <strong>{wallet.walletName || 'Wallet'}</strong>
                  <span>{copied ? <><Check aria-hidden="true" /> Copied</> : shortenAddress(wallet.address, 5)}</span>
                </span>
              </button>
            ) : (
              <button type="button" onClick={wallet.openConnectModal} className="product-primary-button product-connect-button">Connect</button>
            )}
          </div>
        </div>
      </header>

      {mobileMenuOpen && <nav id="product-mobile-menu" className="product-mobile-menu" aria-label="All wallet tools">
        {[...PRIMARY_NAV, ...ACTION_NAV].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className={`product-mobile-menu-link ${isActive(href) ? 'is-active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>}

      <main className="product-main">
        <div className="product-content">{children}</div>
      </main>

      <nav className="product-mobile-nav" aria-label="Mobile navigation">
        {[
          PRIMARY_NAV[0],
          ACTION_NAV[0],
          ACTION_NAV[1],
          PRIMARY_NAV[1],
        ].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`product-mobile-nav-link ${isActive(href) ? 'is-active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

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
