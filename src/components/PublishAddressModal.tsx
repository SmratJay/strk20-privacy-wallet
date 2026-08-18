'use client';

import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ShieldCheck, QrCode, Info, ExternalLink, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { shortenAddress } from '@/utils/formatters';
import { useNetwork } from '@/context/NetworkContext';

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
  const { currentNetwork } = useNetwork();
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeView, setActiveView] = useState<'CARD' | 'QR'>('CARD');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  if (!isOpen) return null;

  const privacyReceiveAddress = `strk20:${accountAddress}`;
  const baseUrl = origin || 'https://orrange.xyz';
  const shareablePaymentLink = `${baseUrl}/?tab=SEND&to=${encodeURIComponent(privacyReceiveAddress)}&network=${currentNetwork.id}`;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md font-mono">
      <div className="relative w-full max-w-md bg-zinc-950 border border-orrange-500/50 corner-box shadow-2xl overflow-hidden space-y-4 p-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Publish Stealth Address</h3>
              <p className="text-[10px] text-zinc-500 uppercase">Publish once, receive privately ({currentNetwork.label})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View Switcher */}
        <div className="flex border-b border-zinc-900 pb-2 gap-2 text-xs">
          <button
            onClick={() => setActiveView('CARD')}
            className={`px-3 py-1 text-[10px] font-bold uppercase transition-all ${
              activeView === 'CARD'
                ? 'bg-orrange-500 text-black'
                : 'bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            Address Details
          </button>
          <button
            onClick={() => setActiveView('QR')}
            className={`px-3 py-1 text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 ${
              activeView === 'QR'
                ? 'bg-orrange-500 text-black'
                : 'bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3 h-3" />
            <span>QR Invoice</span>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {activeView === 'CARD' ? (
            <>
              <div className="p-3 bg-zinc-900/60 border border-zinc-800 space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase">Your Stealth Channel Identifier</label>
                <div className="flex items-center justify-between p-2 bg-zinc-950 border border-zinc-800 text-xs text-white">
                  <span className="font-mono truncate mr-2">{privacyReceiveAddress}</span>
                  <button
                    onClick={handleCopy}
                    className="text-orrange-400 hover:underline text-[10px] uppercase font-bold shrink-0"
                  >
                    {copied ? '[COPIED]' : '[COPY]'}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                <span className="text-orrange-400 font-bold uppercase text-[10px]">How Senders Pay You:</span>
                <p>1. Senders use your address to derive a single-use stealth public key.</p>
                <p>2. Funds land in the STRK20 Privacy Pool as encrypted notes only you can decrypt.</p>
              </div>

              <button
                onClick={handleCopyLink}
                className="w-full py-2.5 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-black text-xs uppercase tracking-wider transition-all"
              >
                {copiedLink ? '✓ Stealth Link Copied' : 'Copy Direct Payment Link'}
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-4 space-y-3">
              <div className="p-3 bg-white border border-zinc-700">
                <QRCodeSVG value={shareablePaymentLink} size={180} level="M" />
              </div>
              <p className="text-[10px] text-zinc-500">Scan to initiate private payment</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
