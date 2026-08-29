import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { NetworkProvider } from '@/context/NetworkContext';
import { WalletProvider } from '@/context/WalletContext';
import { PrivyAuthProvider } from '@/providers/PrivyAuthProvider';
import { PrivyWalletProvider } from '@/context/PrivyWalletContext';

export const metadata: Metadata = {
  title: 'ORRANGE — Starknet privacy wallet',
  description:
    'A consumer privacy wallet for shielded STRK20 payments on Starknet.',
  icons: {
    icon: '/orrange.png',
    apple: '/orrange.png',
  },
};

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
            <PrivyAuthProvider>
              <PrivyWalletProvider>
                <WalletProvider>{children}</WalletProvider>
              </PrivyWalletProvider>
            </PrivyAuthProvider>
          </ToastProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
