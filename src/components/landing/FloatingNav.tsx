'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Sparkles, Terminal, Shield, Menu, X, ExternalLink } from 'lucide-react';

interface FloatingNavProps {
  onOpenWaitlist: () => void;
}

export const FloatingNav: React.FC<FloatingNavProps> = ({ onOpenWaitlist }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-4 z-40 px-4 max-w-5xl mx-auto w-full transition-all">
      <div className="glass-pill rounded-full px-4 sm:px-6 py-2.5 flex items-center justify-between shadow-2xl border border-[#C45B2C]/30 bg-[#18100B]/85 backdrop-blur-xl">
        
        {/* Left: Brand Logomark */}
        <Link href="/" className="flex items-center gap-2.5 group cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#8F3F1F] via-[#C45B2C] to-[#F08A3C] p-[1.5px] shadow-md group-hover:scale-105 transition-transform">
            <div className="w-full h-full rounded-full bg-[#0F0A07] flex items-center justify-center text-white font-black text-xs font-syne">
              <span className="text-[#F08A3C]">✦</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bebas text-xl sm:text-2xl tracking-widest text-[#FBF7F4] group-hover:text-[#F08A3C] transition-colors leading-none pt-0.5">
              ORRANGE
            </span>
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] mr-1 animate-pulse" />
              LIVE NOW
            </span>
          </div>
        </Link>

        {/* Center: Social Icons & Anchor Links (Desktop) */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-syne font-semibold text-zinc-300">
          <a 
            href="#founders" 
            className="hover:text-[#F08A3C] transition-colors flex items-center gap-1"
          >
            FOUNDERS
          </a>
          <a 
            href="#desk" 
            className="hover:text-[#F08A3C] transition-colors flex items-center gap-1"
          >
            PRIVACY DESK
          </a>
          <a 
            href="#club" 
            className="hover:text-[#F08A3C] transition-colors flex items-center gap-1"
          >
            THE CLUB
          </a>

          {/* Social Links matching reference screenshot (𝕏, IG/TG) */}
          <div className="h-4 w-px bg-zinc-800" />
          
          <a 
            href="https://x.com" 
            target="_blank" 
            rel="noopener noreferrer" 
            title="Follow on X"
            className="p-1.5 rounded-full hover:bg-zinc-800/80 hover:text-white transition-colors"
          >
            {/* Custom 𝕏 Icon */}
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          <a 
            href="https://telegram.org" 
            target="_blank" 
            rel="noopener noreferrer" 
            title="Telegram Community"
            className="p-1.5 rounded-full hover:bg-zinc-800/80 hover:text-white transition-colors"
          >
            {/* Telegram Icon */}
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </a>
        </nav>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Direct Launch App Button */}
          <Link
            href="/wallet"
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-syne font-bold text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 transition-all cursor-pointer"
          >
            <Shield className="w-3 h-3 text-[#F08A3C]" />
            <span>Launch App</span>
          </Link>

          {/* Join Waitlist Pill Button */}
          <button
            onClick={onOpenWaitlist}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-syne font-black tracking-wide text-black bg-gradient-to-r from-[#F08A3C] via-[#C45B2C] to-[#D76A24] hover:brightness-110 active:scale-95 transition-all shadow-md cursor-pointer border border-[#F08A3C]/50"
          >
            <span>Join waitlist</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-black" />
          </button>

          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-2 p-4 rounded-3xl bg-[#18100B]/95 border border-[#C45B2C]/30 backdrop-blur-xl shadow-2xl space-y-3 font-syne animate-in fade-in slide-in-from-top-2">
          <div className="flex flex-col space-y-2 text-sm text-zinc-200">
            <a 
              href="#founders" 
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-xl hover:bg-zinc-800/60 text-zinc-300"
            >
              Founders Pass
            </a>
            <a 
              href="#desk" 
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-xl hover:bg-zinc-800/60 text-zinc-300"
            >
              Privacy Desk
            </a>
            <a 
              href="#club" 
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-xl hover:bg-zinc-800/60 text-zinc-300"
            >
              The Club & Collectibles
            </a>
            <Link
              href="/wallet"
              className="px-3 py-2 rounded-xl text-[#F08A3C] font-bold flex items-center justify-between"
            >
              <span>Launch App</span>
              <Shield className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
};
