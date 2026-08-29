'use client';

import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, LockKeyhole } from 'lucide-react';

interface HeroSectionProps {
  onJoinWaitlist: (input: string) => void;
  onOpenWaitlistModal: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onJoinWaitlist, onOpenWaitlistModal }) => {
  const [inputValue, setInputValue] = useState('');
  const [inputMode, setInputMode] = useState<'phone' | 'twitter'>('phone');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inputValue.trim()) onJoinWaitlist(inputValue.trim());
  };

  return (
    <section id="hero" className="landing-panel landing-candy-light flex min-h-[calc(100svh-5rem)] items-center justify-center px-5 pb-24 pt-36 sm:px-8 sm:pb-28 sm:pt-40">
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center text-center">
        <div className="landing-sticker-label mb-8"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#34d399]" /> ORRANGE WAITLIST / LIVE PREVIEW</div>
        <h1 className="landing-scene-heading max-w-full text-[#1d111d] drop-shadow-[0_10px_0_rgba(255,255,255,.23)]">Everything private, in one terminal.</h1>
        <p className="mt-7 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#673947] sm:text-xs">A PRIVATE WALLET FOR A NEW GENERATION</p>
        <p className="landing-poster-copy mt-9 max-w-2xl text-[#452533]">Shielded STRK20 payments on Starknet — make money private before it becomes public.</p>

        <form onSubmit={handleSubmit} className="landing-dock-glow mt-12 flex w-full max-w-2xl flex-col gap-2 rounded-[1.7rem] border border-white/70 bg-[#fff8f5]/70 p-2 backdrop-blur-xl sm:flex-row sm:items-center sm:rounded-full">
          <label htmlFor="hero-waitlist-entry" className="sr-only">Phone number or Twitter handle</label>
          <button type="button" onClick={() => setInputMode(inputMode === 'phone' ? 'twitter' : 'phone')} aria-label={`Switch to ${inputMode === 'phone' ? 'Twitter handle' : 'phone number'} input`} className="hidden items-center gap-2 rounded-full border border-[#5d2e37]/15 bg-white/55 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#6c4451] sm:flex"><span className="text-[#f15b33]">{inputMode === 'phone' ? '01' : '@'}</span>{inputMode === 'phone' ? 'phone' : 'twitter'}</button>
          <input id="hero-waitlist-entry" type={inputMode === 'phone' ? 'tel' : 'text'} value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={inputMode === 'phone' ? 'Phone number' : 'Twitter handle'} className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-medium text-[#2b1621] placeholder:text-[#b88e98] focus:outline-none sm:py-2.5" />
          <button type="submit" className="landing-button inline-flex items-center justify-center gap-2 rounded-full bg-[#17101b] px-7 py-3.5 text-sm font-bold text-white shadow-[0_8px_16px_rgba(34,11,26,.18)] hover:bg-[#f15b33]">Join waitlist <ArrowRight className="h-4 w-4" /></button>
        </form>
        <p className="mt-4 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#805361]">Drop your number or Twitter handle to join the early access registry.</p>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={onOpenWaitlistModal} className="landing-glass flex items-center gap-3 rounded-full border-white/60 bg-white/45 px-5 py-2.5 text-left text-[#3e2430] transition-transform hover:-translate-y-1"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#21121e] text-white"><LockKeyhole className="h-3.5 w-3.5" /></span><span><span className="block font-space text-xs font-bold">STRK20 privacy</span><span className="block font-mono text-[8px] uppercase tracking-wider text-[#895664]">Wallet-owned keys</span></span></button>
          <button type="button" onClick={onOpenWaitlistModal} className="landing-glass flex items-center gap-3 rounded-full border-white/60 bg-white/45 px-5 py-2.5 text-left text-[#3e2430] transition-transform hover:-translate-y-1"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#34d399]" /><span><span className="block font-space text-xs font-bold">Registry open</span><span className="block font-mono text-[8px] uppercase tracking-wider text-[#895664]">Early access preview</span></span></button>
        </div>
        <a href="#reason" className="mt-16 inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.17em] text-[#734352] transition-colors hover:text-[#f15b33]">Scroll to explore <ArrowUpRight className="h-3.5 w-3.5" /></a>
      </div>
    </section>
  );
};
