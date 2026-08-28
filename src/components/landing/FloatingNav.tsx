'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, Shield, X } from 'lucide-react';

interface FloatingNavProps {
  onOpenWaitlist: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({ onOpenWaitlist }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const links = [
    { href: '#founders', label: 'The pass' },
    { href: '#desk', label: 'Privacy desk' },
    { href: '#club', label: 'The circle' },
  ];

  return (
    <header className="sticky top-4 z-40 mx-auto w-[calc(100%-2rem)] max-w-6xl sm:w-[calc(100%-4rem)]">
      <div className="landing-glass relative flex items-center justify-between rounded-full px-3 py-2 sm:px-4">
        <Link href="/" className="group flex items-center gap-2.5 rounded-full px-1.5 py-1" aria-label="ORRANGE home">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[#ffb45c]/50 bg-[#f97316]/20 shadow-[0_0_22px_rgba(249,115,22,0.18)]">
            <span className="h-3 w-3 rotate-45 border border-[#ffb45c] bg-[#f97316]/50 transition-transform duration-300 group-hover:rotate-90" />
          </span>
          <span className="font-bebas text-[1.55rem] tracking-[0.12em] leading-none text-[#f8f1ea] transition-colors group-hover:text-[#ffb45c]">ORRANGE</span>
          <span className="hidden items-center gap-1.5 border-l border-white/10 pl-3 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8e7b70] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Sepolia preview
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a99589] md:flex" aria-label="Landing page">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="relative py-2 transition-colors hover:text-[#f8f1ea] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-[#ffb45c] after:transition-transform hover:after:scale-x-100">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/wallet" className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#c8b8ad] transition-colors hover:border-[#ffb45c]/30 hover:text-[#f8f1ea] sm:inline-flex">
            <Shield className="h-3.5 w-3.5 text-[#ffb45c]" /> Launch app
          </Link>
          <button type="button" onClick={onOpenWaitlist} className="landing-button inline-flex items-center gap-1.5 rounded-full bg-[#f8f1ea] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#1b0e08] hover:bg-[#ffb45c]">
            Join <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-[#c8b8ad] transition-colors hover:text-[#f8f1ea] md:hidden">
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="landing-glass mt-2 rounded-3xl p-3 md:hidden">
          <nav className="grid gap-1" aria-label="Mobile landing page">
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className="rounded-2xl px-4 py-3 text-sm text-[#c8b8ad] transition-colors hover:bg-white/[0.05] hover:text-[#f8f1ea]">
                {link.label}
              </a>
            ))}
            <Link href="/wallet" className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-[#ffb45c] hover:bg-white/[0.05]">
              Launch app <Shield className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
};
