'use client';

import React, { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';

interface FloatingBottomDockProps {
  onJoinWaitlist: (input: string) => void;
  onOpenWaitlistModal: () => void;
}

export const FloatingBottomDock: React.FC<FloatingBottomDockProps> = ({ onJoinWaitlist, onOpenWaitlistModal }) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inputValue.trim()) return;
    onJoinWaitlist(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 px-3 sm:bottom-5 sm:px-6">
      <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-full border border-white/10 bg-[#100a07]/85 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl pointer-events-auto sm:gap-3 sm:p-2">
        <button type="button" onClick={onOpenWaitlistModal} className="hidden items-center gap-2 rounded-full px-3 py-2 text-left transition-colors hover:bg-white/[0.05] md:flex">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#ffb45c]/30 bg-[#f97316]/10"><LockKeyhole className="h-3 w-3 text-[#ffb45c]" /></span>
          <span><span className="block font-space text-xs font-semibold text-[#f8f1ea]">Early access</span><span className="block font-mono text-[8px] uppercase tracking-wider text-[#75645a]">View your pass</span></span>
        </button>

        <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-white/10 bg-white/[0.035] p-1">
          <label htmlFor="dock-waitlist-entry" className="sr-only">Phone number or Starknet wallet address</label>
          <input id="dock-waitlist-entry" type="text" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder="Phone or Starknet wallet" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-[#f8f1ea] placeholder:text-[#75645a] focus:outline-none sm:text-sm" />
          <button type="submit" className="landing-button inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#f8f1ea] px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#1b0e08] hover:bg-[#ffb45c] sm:px-4"><span className="sm:hidden">→</span><span className="hidden sm:inline">Join waitlist</span><ArrowRight className="hidden h-3.5 w-3.5 sm:block" /></button>
        </form>

        <button type="button" onClick={onOpenWaitlistModal} className="hidden items-center gap-2 rounded-full px-3 py-2 text-left transition-colors hover:bg-white/[0.05] lg:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
          <span><span className="block font-space text-xs font-semibold text-[#f8f1ea]">Registry open</span><span className="block font-mono text-[8px] uppercase tracking-wider text-[#75645a]">Launch preview</span></span>
        </button>
      </div>
    </div>
  );
};
