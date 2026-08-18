import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'orrange // Private Execution Layer for Starknet',
  description:
    'Web3 modern SaaS and Private Execution Layer on Starknet. Intent-based routing, shielded UTXO notes, private perpetuals, and zero-knowledge compliance.',
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
      <body className="bg-background text-zinc-100 min-h-screen flex flex-col antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
