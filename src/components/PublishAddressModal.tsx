'use client';

import React, { useState } from 'react';
import { X, Copy, Check, ShieldCheck, QrCode, Info, ExternalLink } from 'lucide-react';
import { shortenAddress } from '@/utils/formatters';
import { STRK20_POOL_ADDRESS } from '@/config/tokens';

interface PublishAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountAddress: string;
}

export const PublishAddressModal: React.FC<PublishAddressModalProps> = ({
  isOpen,
  onClose,
  accountAddress,
}) => {
  const [copied, setCopied] = useState(false);
  const [registered, setRegistered] = useState(true);

  if (!isOpen) return null;

  // The Privacy Address format: in STRK20, your registered viewing key + address form your privacy address
  const privacyReceiveAddress = `strk20:${accountAddress}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(privacyReceiveAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-surface-elevated border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Publish Privacy Address</h3>
              <p className="text-xs text-zinc-400 font-mono">Umbra UX: Publish once, receive privately</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-surface-border transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Explainer */}
          <div className="p-3 rounded-xl bg-zinc-900/60 border border-surface-border flex items-start gap-2.5 text-xs text-zinc-300">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p>
              Unlike Ethereum stealth addresses which require 2 keys and complex scanner events, STRK20 uses a single on-chain registered viewing key. Anyone sending to your privacy address deposits directly into encrypted pool notes.
            </p>
          </div>

          {/* Privacy Address Display */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-400">Your Privacy Address</label>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface border border-surface-border font-mono text-xs text-zinc-200 break-all">
              <span className="flex-1 select-all">{privacyReceiveAddress}</span>
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg bg-surface-border hover:bg-zinc-700 text-zinc-200 transition-colors shrink-0"
                title="Copy address"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Registration Status */}
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-300">Viewing Key Registered in Pool</span>
            </div>
            <a
              href={`https://voyager.online/contract/${STRK20_POOL_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 font-mono"
            >
              <span>On-Chain Record</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Structural Advantages */}
          <div className="pt-2">
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
              Why STRK20 Beats Umbra
            </p>
            <ul className="text-xs text-zinc-300 space-y-1.5 list-disc list-inside">
              <li><strong className="text-zinc-100">No stealth address lookup:</strong> Senders encrypt notes directly to your channel.</li>
              <li><strong className="text-zinc-100">Zero event scanning:</strong> Off-chain discovery handles decryption without public event trails.</li>
              <li><strong className="text-zinc-100">Shared Anonymity:</strong> Your transfers blend with all STRK20 pool volume.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
