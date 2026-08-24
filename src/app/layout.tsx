import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { NetworkProvider } from '@/context/NetworkContext';
import { WalletProvider } from '@/context/WalletContext';

export const metadata: Metadata = {
  title: 'STRK20 Private Wallet',
  description:
    'Receive privately, spend freely. A consumer privacy wallet for STRK20 on Starknet.',
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
            <WalletProvider>{children}</WalletProvider>
          </ToastProvider>
        </NetworkProvider>
      </body>
    </html>
  );
}
