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
  Flame,
  Globe,
  Menu,
  Moon,
  Repeat,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { useToast } from '@/components/Toast';
import { shortenAddress, copyToClipboard } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';
import { walletOperationPending } from '@/utils/walletUx';

const PRIMARY_NAV = [
  { href: '/wallet', label: 'Wallet', icon: ShieldCheck },
  { href: '/swap', label: 'Swap', icon: Repeat },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const ACTION_NAV = [
  { href: '/send', label: 'Send', icon: ArrowUpRight },
  { href: '/receive', label: 'Receive', icon: ArrowDownLeft },
  { href: '/send?mode=deposit', label: 'Private', icon: ShieldCheck },
  { href: '/cross-chain', label: 'Cross-chain', icon: Globe },
  { href: '/explore', label: 'Explore', icon: Flame },
  { href: '/launch', label: 'Launch', icon: Rocket },
  { href: '/extended', label: 'Trade', icon: TrendingUp },
  { href: '/treasury', label: 'Treasury', icon: Sparkles },
];

type AppTheme = 'light' | 'dark';

/**
 * Application shell. The ONLY wallet identity shown anywhere is the Wallet Core runtime session
 * (`useWalletRuntime`). There is no Privy identity, no legacy WalletContext account, and no
 * legacy connect modal. A locked/empty runtime shows a plain "Create wallet" link into /wallet.
 */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { runtime, state: runtimeState } = useWalletRuntime();
  const { networkId, setNetworkId } = useNetwork();
  const runtimeAccount = runtimeState.account;
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<AppTheme>('light');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const transactionPending = walletOperationPending(runtimeState) || runtimeState.recentTransactions.some(tx => tx.status === 'pending');

  useEffect(() => {
    if (!runtimeAccount) return;
    const refresh = () => {
      void runtime.refreshPublicBalances().catch(() => undefined);
      void runtime.refreshPrivateBalances().catch(() => undefined);
      void runtime.refreshDeployment().catch(() => undefined);
      void runtime.refreshPrivacyRegistration().catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [runtime, runtimeAccount?.walletId, runtimeState.network]);

  useEffect(() => {
    setMobileMenuOpen(false);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenuOpen(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [pathname]);

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
    if (!runtimeAccount) return;
    const ok = await copyToClipboard(runtimeAccount.address);
    if (ok) {
      setCopied(true);
      showToast({
        type: 'success',
        title: 'Address copied',
        description: `${shortenAddress(runtimeAccount.address, 6)} copied to clipboard.`,
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
            <label className="wallet-network-select" title={transactionPending ? 'Check the pending transaction in Activity before switching networks.' : 'Changing networks locks your wallet for safety.'}>
              <span className="sr-only">Wallet network</span>
              <select aria-label="Wallet network" value={networkId} disabled={transactionPending} onChange={event => {
                const next = event.target.value as 'mainnet' | 'sepolia';
                runtime.setNetwork(next); setNetworkId(next);
                showToast({ type: 'info', title: next === 'mainnet' ? 'Switched to Mainnet' : 'Switched to Sepolia testnet', description: 'Unlock a wallet on this network to continue.' });
              }}><option value="mainnet">Mainnet</option><option value="sepolia">Sepolia testnet</option></select>
            </label>
            <button type="button" className="product-mobile-menu-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-controls="product-mobile-menu" aria-label={mobileMenuOpen ? 'Close app menu' : 'Open app menu'}>
              {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
            <button type="button" className="product-icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-pressed={theme === 'dark'}>
              {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
            {runtimeAccount ? (
              <Link href="/settings" className="product-account-button" title="Orrange wallet account">
                <span className="product-account-avatar">◌</span>
                <span className="product-account-copy">
                  <strong>Orrange</strong>
                  <span>{copied ? <><Check aria-hidden="true" /> Copied</> : shortenAddress(runtimeAccount.address, 5)}</span>
                </span>
              </Link>
            ) : (
              <Link href="/wallet" className="product-primary-button product-connect-button">{runtimeState.wallets.length ? 'Unlock wallet' : 'Create wallet'}</Link>
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
        <div className="product-content">
          {pathname !== '/wallet' && <Link href="/wallet" className="wallet-back-link">← Back to wallet</Link>}
          {transactionPending && <Link href="/activity" className="wallet-pending-banner">A transaction is in progress. View activity →</Link>}
          <div key={`${runtimeState.network}:${runtimeAccount?.walletId ?? 'locked'}`}>{networkId !== runtimeState.network ? <p role="status">Switching network…</p> : children}</div>
        </div>
      </main>

      <nav className="product-mobile-nav" aria-label="Mobile navigation">
        {[
          PRIMARY_NAV[0],
          ACTION_NAV[0],
          ACTION_NAV[1],
          PRIMARY_NAV[2],
        ].map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`product-mobile-nav-link ${isActive(href) ? 'is-active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};
