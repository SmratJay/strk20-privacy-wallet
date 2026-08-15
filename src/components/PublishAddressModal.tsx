'use client';

import React, { useState } from 'react';
import { X, Copy, Check, ShieldCheck, QrCode, Info, ExternalLink, Share2, Sparkles } from 'lucide-react';
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeView, setActiveView] = useState<'CARD' | 'QR'>('CARD');

  if (!isOpen) return null;

  const privacyReceiveAddress = `strk20:${accountAddress}`;
  const shareablePaymentLink = `https://orrange.xyz/pay/${privacyReceiveAddress}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(privacyReceiveAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareablePaymentLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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

        {/* View Switcher */}
        <div className="flex border-b border-surface-border bg-surface px-5 pt-3 gap-3 text-xs font-semibold">
          <button
            onClick={() => setActiveView('CARD')}
            className={`pb-2.5 border-b-2 transition-colors ${
              activeView === 'CARD'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Address & Specs
          </button>
          <button
            onClick={() => setActiveView('QR')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeView === 'QR'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan QR Code</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {activeView === 'CARD' ? (
            <>
              {/* Explainer */}
              <div className="p-3 rounded-xl bg-zinc-900/60 border border-surface-border flex items-start gap-2.5 text-xs text-zinc-300">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <p>
                  Share this address anywhere. When anyone pays you, the STRK20 pool creates an encrypted UTXO note directly in your channel. Observers see zero link to your identity.
                </p>
              </div>

              {/* Privacy Address Display */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400">Your STRK20 Privacy Address</label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface border border-surface-border font-mono text-xs text-zinc-200 break-all">
                  <span className="flex-1 select-all text-emerald-400">{privacyReceiveAddress}</span>
                  <button
                    onClick={handleCopy}
                    className="p-2 rounded-lg bg-surface-border hover:bg-zinc-700 text-zinc-200 transition-colors shrink-0"
                    title="Copy address"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Shareable Link */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-400 flex items-center justify-between">
                  <span>Shareable Payment Link</span>
                  <span className="text-[10px] text-zinc-500 font-mono">orrange.xyz</span>
                </label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface border border-surface-border font-mono text-xs text-zinc-400 break-all">
                  <span className="flex-1 truncate">{shareablePaymentLink}</span>
                  <button
                    onClick={handleCopyLink}
                    className="p-2 rounded-lg bg-surface-border hover:bg-zinc-700 text-zinc-200 transition-colors shrink-0"
                    title="Copy payment link"
                  >
                    {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Registration Status */}
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-between">
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
                  <span>Pool Explorer</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Structural Advantages */}
              <div className="pt-1">
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Why STRK20 Beats Umbra
                </p>
                <ul className="text-xs text-zinc-300 space-y-1.5 list-disc list-inside">
                  <li><strong className="text-zinc-100">1 Key Registration:</strong> No 2-key stealth meta-address complexity.</li>
                  <li><strong className="text-zinc-100">Zero On-Chain Address:</strong> Payments sit in encrypted UTXO pool notes.</li>
                  <li><strong className="text-zinc-100">Gas-Free Relay:</strong> Native pool withdrawals decouple transaction senders.</li>
                </ul>
              </div>
            </>
          ) : (
            /* QR View */
            <div className="p-6 text-center space-y-4">
              <div className="inline-block p-4 rounded-2xl bg-white shadow-2xl border-4 border-emerald-500/30">
                {/* Visual SVG QR Representation */}
                <svg className="w-44 h-44" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="100" height="100" fill="white"/>
                  {/* Outer corner markers */}
                  <rect x="10" y="10" width="24" height="24" fill="black"/>
                  <rect x="14" y="14" width="16" height="16" fill="white"/>
                  <rect x="18" y="18" width="8" height="8" fill="black"/>

                  <rect x="66" y="10" width="24" height="24" fill="black"/>
                  <rect x="70" y="14" width="16" height="16" fill="white"/>
                  <rect x="74" y="18" width="8" height="8" fill="black"/>

                  <rect x="10" y="66" width="24" height="24" fill="black"/>
                  <rect x="14" y="70" width="16" height="16" fill="white"/>
                  <rect x="18" y="74" width="8" height="8" fill="black"/>

                  {/* Data patterns */}
                  <rect x="40" y="12" width="6" height="6" fill="black"/>
                  <rect x="52" y="18" width="6" height="6" fill="black"/>
                  <rect x="40" y="28" width="6" height="6" fill="black"/>
                  <rect x="48" y="38" width="8" height="8" fill="#10b981"/>
                  <rect x="14" y="44" width="8" height="8" fill="black"/>
                  <rect x="30" y="48" width="6" height="6" fill="black"/>
                  <rect x="62" y="44" width="6" height="6" fill="black"/>
                  <rect x="76" y="52" width="8" height="8" fill="black"/>
                  <rect x="44" y="60" width="6" height="6" fill="black"/>
                  <rect x="58" y="68" width="8" height="8" fill="black"/>
                  <rect x="72" y="74" width="6" height="6" fill="black"/>
                  <rect x="40" y="80" width="8" height="8" fill="black"/>
                  <rect x="84" y="84" width="6" height="6" fill="black"/>
                </svg>
              </div>

              <div>
                <p className="text-xs font-mono text-zinc-300 break-all">{shortenAddress(privacyReceiveAddress, 10)}</p>
                <p className="text-[11px] text-zinc-500 mt-1">Scan with any STRK20 or Starknet mobile camera</p>
              </div>

              <button
                onClick={handleCopy}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy Privacy Address'}</span>
              </button>
            </div>
          )}
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
