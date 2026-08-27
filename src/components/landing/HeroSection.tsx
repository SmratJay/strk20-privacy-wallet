'use client';

import React, { useState } from 'react';
import { Sparkles, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { 
  EyeballSticker, 
  MintedCoinSticker, 
  FlameHeartSticker, 
  PixelShadesSticker,
  NoCapSticker 
} from './InteractiveStickers';

interface HeroSectionProps {
  onJoinWaitlist: (input: string) => void;
  onOpenWaitlistModal: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onJoinWaitlist,
  onOpenWaitlistModal,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [inputMode, setInputMode] = useState<'phone' | 'wallet'>('phone');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onJoinWaitlist(inputValue);
    setIsSubmitted(true);
  };

  return (
    <section id="hero" className="relative min-h-[92vh] flex flex-col items-center justify-center px-4 py-12 sm:py-20 overflow-hidden">
      
      {/* Background Soft Mesh Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[650px] rounded-full bg-gradient-to-tr from-[#8F3F1F]/30 via-[#C45B2C]/20 to-[#F08A3C]/10 blur-[130px] -z-10" />
      </div>

      {/* Floating 3D & Culture Stickers matching Screenshot 1 */}
      
      {/* Top Left: Minted Metallic Coin */}
      <div className="absolute top-12 sm:top-16 left-3 sm:left-12 lg:left-24 z-20 animate-float-slow hidden xs:block">
        <MintedCoinSticker size={82} />
      </div>

      {/* Top Right: Mouse-tracking 3D Eyeball */}
      <div className="absolute top-10 sm:top-14 right-4 sm:right-14 lg:right-28 z-20 animate-float-medium">
        <EyeballSticker size={76} />
      </div>

      {/* Bottom Left: Hot Chrome Flame Heart */}
      <div className="absolute bottom-24 sm:bottom-28 left-4 sm:left-14 lg:left-28 z-20 animate-float-medium hidden xs:block">
        <FlameHeartSticker size={78} />
      </div>

      {/* Bottom Right: Pixel Meme Shades */}
      <div className="absolute bottom-24 sm:bottom-28 right-4 sm:right-14 lg:right-28 z-20 animate-float-slow hidden sm:block">
        <PixelShadesSticker size={105} />
      </div>

      {/* Main Content Container */}
      <div className="relative z-10 max-w-4xl mx-auto flex flex-col items-center text-center space-y-6">
        
        {/* Massive Condensed Headline: ORRANGE */}
        <h1 className="font-bebas text-7xl xs:text-8xl sm:text-9xl md:text-[11rem] lg:text-[13rem] leading-[0.88] tracking-tight text-[#FBF7F4] select-none drop-shadow-[0_20px_40px_rgba(0,0,0,0.8)]">
          ORRANGE
        </h1>

        {/* Spaced Uppercase Subtitle */}
        <div className="space-y-1 max-w-2xl">
          <p className="font-syne font-extrabold text-xs xs:text-sm sm:text-base tracking-[0.25em] text-[#F08A3C] uppercase drop-shadow">
            A PRIVACY PROTOCOL FOR A NEW GENERATION
          </p>
          <p className="font-sans text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto font-normal">
            Confidential STRK20 execution, zero-knowledge payments, and shielded trading on Starknet.
          </p>
        </div>

        {/* Central Waitlist Pill Capsule Bar */}
        <div className="w-full max-w-xl pt-4">
          <form 
            onSubmit={handleSubmit}
            className="glass-pill rounded-full p-2 sm:p-2.5 flex items-center gap-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border border-[#C45B2C]/40 bg-[#18100B]/85"
          >
            {/* Input switch toggle (Phone vs Wallet) */}
            <div className="hidden xs:flex items-center pl-2 pr-1 text-[11px] font-syne font-bold text-zinc-400">
              <button
                type="button"
                onClick={() => setInputMode(inputMode === 'phone' ? 'wallet' : 'phone')}
                className="hover:text-white transition-colors flex items-center gap-1 uppercase tracking-wider"
              >
                {inputMode === 'phone' ? '📱' : '⚡'}
              </button>
            </div>

            <input
              type={inputMode === 'phone' ? 'tel' : 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={inputMode === 'phone' ? 'Enter phone number...' : 'Enter Starknet address (0x...)'}
              className="flex-1 bg-transparent px-3 py-2 text-sm sm:text-base text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
            />

            <button
              type="submit"
              className="px-5 sm:px-7 py-3 rounded-full text-xs sm:text-sm font-syne font-extrabold text-white bg-gradient-to-r from-[#8F3F1F] via-[#C45B2C] to-[#D76A24] hover:brightness-110 active:scale-95 transition-all shadow-lg border border-[#F08A3C]/40 cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <span>Join waitlist</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Subtext below input */}
          <p className="font-syne font-bold text-[11px] tracking-wider text-zinc-500 uppercase mt-3.5">
            DROP YOUR NUMBER OR WALLET TO JOIN THE <span className="text-[#F08A3C]">ORRANGE</span> WAITLIST FOR EARLY ACCESS.
          </p>
        </div>

        {/* Dual Floating Status Pills (Matching bottom of Screenshot 1 & 2) */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-6">
          
          {/* Left Pill: 1,000 Founder Seats Claimed */}
          <div 
            onClick={onOpenWaitlistModal}
            className="glass-pill rounded-2xl px-4 py-2 flex items-center gap-3 border border-[#C45B2C]/30 bg-gradient-to-r from-[#18100B] to-[#221610] cursor-pointer hover:border-[#F08A3C]/50 transition-all group"
          >
            <div className="w-6 h-8 rounded-md holographic-purple-foil flex items-center justify-center shadow-md p-0.5">
              <span className="text-[8px] font-mono text-white font-black">✦</span>
            </div>
            <div className="text-left leading-tight">
              <div className="text-xs sm:text-sm font-syne font-extrabold text-[#FBF7F4] group-hover:text-[#F08A3C] transition-colors">
                1,000
              </div>
              <div className="text-[9px] font-mono font-bold text-zinc-400 tracking-wider uppercase">
                FOUNDER SEATS CLAIMED
              </div>
            </div>
          </div>

          {/* Right Pill: 50,000 Joined of 50,000 Seats */}
          <div 
            onClick={onOpenWaitlistModal}
            className="glass-pill rounded-2xl px-4 py-2 flex items-center gap-3 border border-[#10b981]/30 bg-gradient-to-r from-[#18100B] to-[#0f1f18] cursor-pointer hover:border-[#10b981]/60 transition-all group"
          >
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#10b981]" />
            </span>
            <div className="text-left leading-tight">
              <div className="text-xs sm:text-sm font-syne font-extrabold text-[#FBF7F4] flex items-center gap-1.5">
                <span>50,000</span>
                <span className="text-[10px] font-normal text-emerald-400">joined</span>
              </div>
              <div className="text-[9px] font-mono font-bold text-zinc-400 tracking-wider uppercase">
                OF 50,000 SEATS
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
