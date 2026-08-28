'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, ShieldCheck, X } from 'lucide-react';

interface FloatingNavProps {
  onOpenWaitlist: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({ onOpenWaitlist }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const links = [
    { href: '#founders', label: 'Pass' },
    { href: '#desk', label: 'Desk' },
    { href: '#club', label: 'Circle' },
  ];

  return (
    <header className="landing-scene-nav px-1">
      <div className="landing-nav-glass flex items-center justify-between rounded-full px-3 py-2 sm:px-4">
        <Link href="/" className="group flex min-w-0 items-center gap-2.5 rounded-full px-1 py-1.5" aria-label="ORRANGE home">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#25142a] shadow-[0_4px_12px_rgba(39,12,29,.25)] transition-transform duration-300 group-hover:rotate-6">
            <span className="h-3.5 w-3.5 rotate-45 border-2 border-[#ffab75] bg-[#f97316]" />
          </span>
          <span className="truncate font-bebas text-[1.6rem] tracking-[0.12em] leading-none text-[#2b1621]">ORRANGE</span>
        </Link>

        <nav className="hidden items-center gap-7 text-[#3f2430] md:flex" aria-label="Landing page">
          {links.map((link) => <a key={link.href} href={link.href} className="text-[10px] font-bold uppercase tracking-[0.15em] transition-colors hover:text-[#f15b33]">{link.label}</a>)}
          <span className="h-5 w-px bg-[#6d3440]/20" />
          <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="ORRANGE on X" className="text-lg leading-none transition-transform hover:scale-110">𝕏</a>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="ORRANGE on Instagram" className="transition-transform hover:scale-110"><svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" className="fill-current stroke-none" /></svg></a>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/wallet" className="hidden items-center gap-1.5 rounded-full border border-[#5d2e37]/15 bg-white/25 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#3f2430] transition-colors hover:bg-white/50 sm:inline-flex"><ShieldCheck className="h-3.5 w-3.5" /> App</Link>
          <button type="button" onClick={onOpenWaitlist} className="landing-button inline-flex items-center gap-1.5 rounded-full bg-[#21121e] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#fff4ee] hover:bg-[#f15b33]">Join waitlist <ArrowUpRight className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} className="rounded-full border border-[#5d2e37]/20 bg-white/25 p-2 text-[#3f2430] md:hidden">{mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</button>
        </div>
      </div>
      {mobileMenuOpen && <div className="landing-nav-glass mt-2 rounded-3xl p-2 md:hidden"><nav className="grid gap-1">{links.map((link) => <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="rounded-2xl px-4 py-3 text-sm font-semibold text-[#3f2430] hover:bg-white/35">{link.label}</a>)}<Link href="/wallet" className="rounded-2xl px-4 py-3 text-sm font-semibold text-[#f15b33] hover:bg-white/35">Launch wallet</Link></nav></div>}
    </header>
  );
};
