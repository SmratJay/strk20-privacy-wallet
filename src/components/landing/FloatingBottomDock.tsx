'use client';

import React, { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';

interface FloatingBottomDockProps { onJoinWaitlist: (input: string) => void; onOpenWaitlistModal: () => void; }

export const FloatingBottomDock: React.FC<FloatingBottomDockProps> = ({ onJoinWaitlist, onOpenWaitlistModal }) => {
  const [inputValue, setInputValue] = useState('');
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!inputValue.trim()) return; onJoinWaitlist(inputValue.trim()); setInputValue(''); };

  return <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 px-3 sm:bottom-5 sm:px-6"><div className="mx-auto flex max-w-6xl items-center gap-2 pointer-events-auto sm:gap-3">
    <button type="button" onClick={onOpenWaitlistModal} className="landing-stat landing-stat-purple hidden items-center gap-2 rounded-full px-3 py-2 text-left md:flex"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20"><LockKeyhole className="h-3.5 w-3.5" /></span><span><span className="block font-space text-xs font-bold">Early access</span><span className="block font-mono text-[8px] uppercase tracking-wider opacity-75">View your pass</span></span></button>
    <form onSubmit={handleSubmit} className="landing-dock-glow flex min-w-0 flex-1 items-center gap-1 rounded-full border-2 border-white/70 bg-white/60 p-1.5 backdrop-blur-xl sm:gap-2 sm:p-2"><label htmlFor="dock-waitlist-entry" className="sr-only">Phone number or Starknet wallet</label><input id="dock-waitlist-entry" type="text" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder="Phone number or Starknet wallet" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs font-medium text-[#2b1621] placeholder:text-[#9d7781] focus:outline-none sm:px-4 sm:text-sm" /><button type="submit" className="landing-button inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#17101b] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white hover:bg-[#f15b33] sm:px-6 sm:py-3 sm:text-xs">Join waitlist <ArrowRight className="h-3.5 w-3.5" /></button></form>
    <button type="button" onClick={onOpenWaitlistModal} className="landing-stat landing-stat-green hidden items-center gap-2 rounded-full px-3 py-2 text-left lg:flex"><span className="h-2 w-2 rounded-full bg-[#8dffb5] shadow-[0_0_10px_#8dffb5]" /><span><span className="block font-space text-xs font-bold">Registry open</span><span className="block font-mono text-[8px] uppercase tracking-wider opacity-75">Early access preview</span></span></button>
  </div></div>;
};
