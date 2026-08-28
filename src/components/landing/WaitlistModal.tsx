'use client';

import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyToClipboard } from '@/utils/formatters';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEntry?: string;
}

export const WaitlistModal: React.FC<WaitlistModalProps> = ({ isOpen, onClose, userEntry = '' }) => {
  const [copied, setCopied] = useState(false);
  const [spotsClimbed, setSpotsClimbed] = useState(0);

  if (!isOpen) return null;

  const baseRank = 49821;
  const currentRank = Math.max(12, baseRank - spotsClimbed);
  const referralCode = `ORR-${userEntry ? Math.abs(userEntry.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0) % 9000 + 1000) : '9482'}`;
  const referralLink = `https://orrange.cash/join?ref=${referralCode}`;
  const tweetText = encodeURIComponent(`Just secured my spot on @orrange_cash — private STRK20 payments on @Starknet.\n\nClaim your seat before launch:\n${referralLink}`);

  const handleCopy = async () => {
    const ok = await copyToClipboard(referralLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#080503]/85 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="waitlist-title">
      <div className="landing-window relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[1.8rem] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.72)] sm:p-5">
        <button type="button" onClick={onClose} aria-label="Close waitlist confirmation" className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/[0.05] p-2 text-[#8e7b70] transition-colors hover:text-[#f8f1ea]"><X className="h-4 w-4" /></button>

        <div className="rounded-[1.35rem] border border-white/10 bg-[#0c0806] p-5 sm:p-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ffb45c]/35 bg-[#f97316]/15 text-[#ffb45c]"><Check className="h-5 w-5" /></div>
          <div className="landing-kicker mt-7">ORRANGE / REGISTRY CONFIRMED</div>
          <h2 id="waitlist-title" className="mt-3 font-bebas text-5xl leading-none tracking-[0.01em] text-[#f8f1ea]">You&apos;re in.</h2>
          <p className="mt-3 break-words text-sm leading-6 text-[#8e7b70]">{userEntry ? `Registered as ${userEntry}` : 'Your early access spot is reserved.'}</p>

          <div className="mt-7 border-y border-white/10 py-5 text-center">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#75645a]">Queue position preview</div>
            <div className="mt-2 font-bebas text-6xl leading-none text-[#ffb45c]">#{currentRank.toLocaleString()}</div>
            {spotsClimbed > 0 && <div className="mt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">Referral preview: +{spotsClimbed.toLocaleString()} spots</div>}
          </div>

          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between gap-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[#8e7b70]"><span>Invite link</span><span className="text-[#ffb45c]">+500 / friend</span></div>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5"><input type="text" readOnly value={referralLink} aria-label="Your referral link" className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[10px] text-[#c8b8ad] focus:outline-none" /><button type="button" onClick={handleCopy} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#f8f1ea] px-3 py-2 text-[10px] font-bold text-[#1b0e08] hover:bg-[#ffb45c]">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}</button></div>
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <a href={`https://twitter.com/intent/tweet?text=${tweetText}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#c8b8ad] transition-colors hover:border-[#ffb45c]/40 hover:text-[#f8f1ea]">Share on X</a>
            <button type="button" onClick={() => setSpotsClimbed((prev) => prev + 1250)} className="inline-flex items-center justify-center rounded-full bg-[#f97316] px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#1b0e08] transition-colors hover:bg-[#ffb45c]">Preview referral boost</button>
          </div>
        </div>
      </div>
    </div>
  );
};
