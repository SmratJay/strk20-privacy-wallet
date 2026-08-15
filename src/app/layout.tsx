import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'STRK20 Privacy Wallet | Starknet Confidential Payments',
  description:
    'Umbra-grade privacy wallet for Starknet. Shield tokens, send encrypted notes, and execute confidential DeFi on STRK20.',
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
        {children}
      </body>
    </html>
  );
}
