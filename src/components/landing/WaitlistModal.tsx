'use client';

import React, { useState } from 'react';
import { X, Check, Copy, Sparkles, Trophy, ArrowRight, Share2 } from 'lucide-react';
import { copyToClipboard } from '@/utils/formatters';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEntry?: string;
}

export const WaitlistModal: React.FC<WaitlistModalProps> = ({
  isOpen,
  onClose,
  userEntry = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [spotsClimbed, setSpotsClimbed] = useState(0);

  if (!isOpen) return null;

  const baseRank = 49821;
  const currentRank = Math.max(12, baseRank - spotsClimbed);
  const referralCode = `ORR-${userEntry ? Math.abs(userEntry.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0) % 9000 + 1000) : '9482'}`;
  const referralLink = `https://orrange.cash/join?ref=${referralCode}`;

  const handleCopy = async () => {
    const ok = await copyToClipboard(referralLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClimbSimulate = () => {
    setSpotsClimbed((prev) => prev + 1250);
  };

  const tweetText = encodeURIComponent(
    `Just secured my spot on @orrange_cash — confidential STRK20 cash & private execution on @Starknet.\n\nClaim your seat before launch:\n${referralLink}`
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg glass-card-amber rounded-3xl p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.9)] border border-[#C45B2C]/50 text-center space-y-6">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-zinc-400 hover:text-white bg-black/50 hover:bg-black/80 border border-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Confetti & Success Header */}
        <div className="space-y-2 pt-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-[#8F3F1F] via-[#C45B2C] to-[#F08A3C] p-0.5 shadow-xl flex items-center justify-center">
            <div className="w-full h-full rounded-2xl bg-[#0F0A07] flex items-center justify-center text-[#F08A3C] text-2xl">
              ✦
            </div>
          </div>

          <h3 className="font-bebas text-4xl sm:text-5xl text-white tracking-wider">
            YOU&apos;RE ON THE WAITLIST!
          </h3>
          
          <p className="font-sans text-xs sm:text-sm text-zinc-300">
            {userEntry ? `Registered: ${userEntry}` : 'Early access spot reserved.'}
          </p>
        </div>

        {/* Spot Number Badge */}
        <div className="p-4 rounded-2xl bg-black/60 border border-[#C45B2C]/40 space-y-1">
          <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">
            YOUR CURRENT POSITION
          </div>
          <div className="font-bebas text-5xl text-[#F08A3C] tracking-wider leading-none">
            #{currentRank.toLocaleString()}
          </div>
          {spotsClimbed > 0 && (
            <div className="text-xs font-mono text-emerald-400 font-bold">
              🔥 You jumped +{spotsClimbed.toLocaleString()} spots!
            </div>
          )}
        </div>

        {/* Referral Link Container */}
        <div className="space-y-2 text-left">
          <div className="flex justify-between items-center text-xs font-syne font-bold text-zinc-300">
            <span>YOUR REFERRAL LINK</span>
            <span className="text-[#F08A3C] font-mono text-[11px]">+500 spots per friend</span>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-black/70 border border-zinc-800">
            <input
              type="text"
              readOnly
              value={referralLink}
              className="flex-1 bg-transparent px-3 py-1.5 font-mono text-xs text-zinc-300 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2 rounded-xl text-xs font-syne font-bold bg-[#C45B2C] hover:bg-[#D76A24] text-white flex items-center gap-1.5 transition-all"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Social Share & Ladder Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${tweetText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 rounded-2xl bg-black hover:bg-zinc-900 border border-zinc-700 text-white font-syne font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>Share on X / Twitter</span>
          </a>

          <button
            type="button"
            onClick={handleClimbSimulate}
            className="py-3 rounded-2xl bg-gradient-to-r from-[#8F3F1F] via-[#C45B2C] to-[#F08A3C] hover:brightness-110 text-white font-syne font-black text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-200" />
            <span>Simulate Referral Boost</span>
          </button>
        </div>

      </div>
    </div>
  );
};
