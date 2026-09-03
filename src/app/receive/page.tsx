'use client';

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy } from 'lucide-react';
import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { copyToClipboard } from '@/utils/formatters';

/**
 * Receive — shows the address of the currently selected WalletRuntime account. No legacy wallet.
 */
export default function ReceivePage() {
  const { state } = useWalletRuntime();
  const account = state.account;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
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
            <div className="product-eyebrow">ORRANGE / RECEIVE</div>
            <h1 className="product-page-title">Receive</h1>
            <p className="product-page-description">Share your Orrange wallet address.</p>
          </div>
        </div>

        {!account ? (
          <WalletCoreGate />
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
            <div className="flex items-center gap-4">
              <div className="bg-white p-2 rounded-lg shrink-0">
                <QRCodeSVG value={account.address} size={160} />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-sm text-zinc-300 break-all">{account.address}</div>
                <button
                  onClick={handleCopy}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#F08A3C]"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy address'}
                </button>
                <p className="text-[11px] text-zinc-500 mt-3">
                  Anyone can send public STRK/ERC-20 to this address. Private (STRK20) sending uses
                  your wallet-native viewing key and the STRK20 pool.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}