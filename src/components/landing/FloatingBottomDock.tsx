'use client';

import React, { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

interface FloatingBottomDockProps {
  onJoinWaitlist: (input: string) => void;
  onOpenWaitlistModal: () => void;
}

export const FloatingBottomDock: React.FC<FloatingBottomDockProps> = ({
  onJoinWaitlist,
  onOpenWaitlistModal,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onJoinWaitlist(inputValue);
    setInputValue('');
  };

  return (
    <div className="fixed bottom-3 inset-x-0 z-50 px-3 sm:px-6 pointer-events-none">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-2 sm:gap-3 pointer-events-auto">
        
        {/* Left Pill: 1,000 Founder Seats Claimed */}
        <div 
          onClick={onOpenWaitlistModal}
          className="hidden md:flex glass-pill rounded-2xl px-3.5 py-2 items-center gap-2.5 border border-[#C45B2C]/30 bg-[#18100B]/90 backdrop-blur-xl cursor-pointer hover:border-[#F08A3C]/60 hover:scale-102 transition-all shadow-2xl shrink-0 group"
        >
          <div className="w-5 h-7 rounded holographic-purple-foil flex items-center justify-center shadow p-0.5">
            <span className="text-[7px] font-mono text-white font-black">✦</span>
          </div>
          <div className="text-left leading-none">
            <div className="text-xs font-syne font-extrabold text-[#FBF7F4] group-hover:text-[#F08A3C] transition-colors">
              1,000
            </div>
            <div className="text-[8px] font-mono font-bold text-zinc-400 tracking-wider uppercase mt-0.5">
              FOUNDER SEATS CLAIMED
            </div>
          </div>
        </div>

        {/* Center: Interactive Waitlist Capsule Bar */}
        <form 
          onSubmit={handleSubmit}
          className="flex-1 glass-pill rounded-full p-1.5 sm:p-2 flex items-center gap-2 shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-[#C45B2C]/40 bg-[#18100B]/95 backdrop-blur-xl max-w-lg mx-auto"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Phone number or Starknet wallet..."
            className="flex-1 bg-transparent px-3 py-1.5 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none font-sans"
          />

          <button
            type="submit"
            className="px-4 sm:px-5 py-2 rounded-full text-xs font-syne font-black text-white bg-gradient-to-r from-[#8F3F1F] via-[#C45B2C] to-[#D76A24] hover:brightness-110 active:scale-95 transition-all shadow-md border border-[#F08A3C]/40 cursor-pointer flex items-center gap-1 shrink-0"
          >
            <span>Join waitlist</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Right Pill: 50,000 Joined of 50,000 Seats */}
        <div 
          onClick={onOpenWaitlistModal}
          className="hidden md:flex glass-pill rounded-2xl px-3.5 py-2 items-center gap-2.5 border border-[#10b981]/30 bg-[#18100B]/90 backdrop-blur-xl cursor-pointer hover:border-[#10b981]/60 hover:scale-102 transition-all shadow-2xl shrink-0 group"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10b981]" />
          </span>
          <div className="text-left leading-none">
            <div className="text-xs font-syne font-extrabold text-[#FBF7F4] flex items-center gap-1">
              <span>50,000</span>
              <span className="text-[9px] font-normal text-emerald-400">joined</span>
            </div>
            <div className="text-[8px] font-mono font-bold text-zinc-400 tracking-wider uppercase mt-0.5">
              OF 50,000 SEATS
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
