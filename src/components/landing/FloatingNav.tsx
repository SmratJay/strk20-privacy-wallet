'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export const FloatingNav: React.FC = () => {
  return (
    <header className="landing-scene-nav px-1">
      <div className="landing-nav-glass flex items-center justify-between rounded-full px-3 py-2 sm:px-4">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5 rounded-full px-1 py-1.5" aria-label="ORRANGE home">
          <img src="/orrange.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 rounded-xl object-cover shadow-[0_4px_12px_rgba(39,12,29,.25)] transition-transform duration-300 group-hover:rotate-6" />
          <span className="truncate font-bebas text-[1.6rem] tracking-[0.12em] leading-none text-[#2b1621]">ORRANGE</span>
        </Link>
        <nav className="hidden items-center gap-7 text-[#3f2430] md:flex" aria-label="Landing page">
          <span className="h-5 w-px bg-[#6d3440]/20" />
          <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="ORRANGE on X" className="text-lg leading-none transition-transform hover:scale-110">𝕏</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/wallet" className="landing-button inline-flex items-center gap-1.5 rounded-full bg-[#21121e] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#fff4ee] hover:bg-[#f15b33]">Launch app <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      </div>
    </header>
  );
};
