import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { NetworkProvider } from '@/context/NetworkContext';
import { WalletRuntimeProvider } from '@/context/WalletRuntimeContext';

export const metadata: Metadata = {
  title: 'ORRANGE — Starknet privacy wallet',
  description:
    'A consumer privacy wallet for shielded STRK20 payments on Starknet.',
  icons: {
    icon: '/orrange.png',
    apple: '/orrange.png',
  },
};

/**
 * Provider tree. Orrange is a SINGLE-wallet-runtime product:
 *
 *   App
 *     ↓
 *   NetworkProvider        (network config context, not a wallet)
 *     ↓
 *   ToastProvider          (UI toasts)
 *     ↓
 *   WalletRuntimeProvider  (the ONE wallet runtime — Wallet Core backed, no Privy)
 *     ↓
 *   Orrange UI
 *
 * There is no Privy provider, no legacy WalletContext, and no hidden alternative wallet.
 * The WalletRuntime is the only wallet identity the UI can read.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-zinc-100 min-h-screen flex flex-col antialiased">
        <NetworkProvider>
          <ToastProvider>
            <WalletRuntimeProvider>{children}</WalletRuntimeProvider>
          </ToastProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}