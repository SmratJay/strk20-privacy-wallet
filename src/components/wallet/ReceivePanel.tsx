'use client';

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Share2 } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { copyToClipboard, shortenAddress } from '@/utils/formatters';

/**
 * The privacy receive surface. For the STRK20 Wallet API lane, the receive identifier IS
 * the connected wallet's Starknet address — the privacy wallet owns viewing keys, channels,
 * and note discovery. Anyone paying to this address sends privately through the pool.
 */
export const ReceivePanel: React.FC<{ large?: boolean }> = ({ large }) => {
  const { wallet } = useWallet();
  const [copied, setCopied] = useState(false);

  const address = wallet.address || '';

  const handleCopy = async () => {
    if (!address) return;
    const ok = await copyToClipboard(address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (!address) return;
    const text = `Pay me privately on Starknet: ${address}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Private payment', text });
        return;
      } catch {
        // User cancelled — fall through to copy.
      }
    }
    await handleCopy();
  };

  if (!address) return null;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6 text-center space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-100">Receive privately</h2>
        <p className="text-[12px] text-zinc-500">
          Anyone can send you a private payment to this address.
        </p>
      </div>

      <div className="mx-auto w-fit p-3 rounded-2xl bg-white">
        <QRCodeSVG value={address} size={large ? 200 : 148} level="M" />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-mono text-zinc-300 break-all rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-2">
          {shortenAddress(address, 10)}
        </div>
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 text-[13px] font-medium hover:bg-zinc-800 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-200 text-[13px] font-medium hover:bg-zinc-800 transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
};
