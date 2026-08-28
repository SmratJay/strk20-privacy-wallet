'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { EyeballSticker, MintedCoinSticker } from './InteractiveStickers';

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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inputValue.trim()) return;
    onJoinWaitlist(inputValue.trim());
  };

  return (
    <section id="hero" className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:px-10 lg:pb-32 lg:pt-28">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-24 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-orange-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-40 top-40 h-96 w-96 rounded-full bg-[#9a3e18]/20 blur-[120px]" />

      <div className="pointer-events-none absolute left-[4%] top-20 z-10 hidden animate-float-slow sm:block lg:left-[8%]">
        <MintedCoinSticker size={76} />
      </div>
      <div className="pointer-events-none absolute right-[5%] top-28 z-10 hidden animate-float-medium sm:block lg:right-[9%]">
        <EyeballSticker size={70} />
      </div>

      <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)] lg:gap-20">
        <div className="max-w-2xl">
          <div className="landing-kicker mb-6 flex items-center gap-3">
            <span className="h-px w-8 bg-[#ffb45c]/70" />
            <span>STRK20 / STARKNET SEPOLIA</span>
          </div>

          <h1 className="landing-display text-[clamp(7rem,22vw,15rem)] text-[#f8f1ea] drop-shadow-[0_24px_55px_rgba(0,0,0,0.52)]">
            ORRANGE
          </h1>

          <div className="mt-8 max-w-xl border-l border-[#ffb45c]/40 pl-5 sm:pl-7">
            <p className="font-space text-2xl font-semibold leading-[1.04] tracking-[-0.04em] text-[#f8f1ea] sm:text-4xl">
              Move money without leaving the whole trail exposed.
            </p>
            <p className="mt-5 max-w-md text-sm leading-6 text-[#b8a59a] sm:text-base">
              A consumer privacy wallet for shielded STRK20 payments. Your wallet keeps the keys, notes, and proofs in its own hands.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="landing-glass mt-9 flex max-w-xl flex-col gap-2 rounded-[1.4rem] p-2 sm:flex-row sm:items-center sm:rounded-full">
            <label htmlFor="hero-waitlist-entry" className="sr-only">Phone number or Starknet wallet address</label>
            <button
              type="button"
              onClick={() => setInputMode(inputMode === 'phone' ? 'wallet' : 'phone')}
              aria-label={`Switch waitlist input to ${inputMode === 'phone' ? 'wallet address' : 'phone number'}`}
              aria-pressed={inputMode === 'wallet'}
              className="hidden h-10 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-[#b8a59a] transition-colors hover:border-[#ffb45c]/40 hover:text-[#f8f1ea] sm:flex"
            >
              <span className="text-[#ffb45c]">{inputMode === 'phone' ? '01' : '0x'}</span>
              {inputMode === 'phone' ? 'phone' : 'wallet'}
            </button>
            <input
              id="hero-waitlist-entry"
              type={inputMode === 'phone' ? 'tel' : 'text'}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={inputMode === 'phone' ? 'Your phone number' : 'Your Starknet address'}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-[#f8f1ea] placeholder:text-[#78685f] focus:outline-none sm:py-2"
            />
            <button
              type="submit"
              className="landing-button inline-flex items-center justify-center gap-2 rounded-full bg-[#f8f1ea] px-5 py-3 text-xs font-bold uppercase tracking-[0.08em] text-[#1b0e08] shadow-[0_10px_28px_rgba(248,241,234,0.12)] hover:bg-[#ffb45c] sm:py-3.5"
            >
              Join waitlist <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.13em] text-[#78685f]">
            <span>Early access registry</span>
            <span className="h-1 w-1 rounded-full bg-[#ffb45c]" />
            <button type="button" onClick={onOpenWaitlistModal} className="text-[#ffb45c] transition-colors hover:text-[#f8f1ea]">Already joined? View pass →</button>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[31rem] lg:mt-14">
          <div className="pointer-events-none absolute -inset-10 rounded-[3rem] bg-[#b84c1b]/15 blur-3xl" />
          <div className="landing-window relative rounded-[1.8rem] p-3 sm:p-4">
            <div className="flex items-center justify-between px-2 pb-3 text-[10px] font-mono uppercase tracking-[0.14em] text-[#8e7b70]">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />ORRANGE / DESK</span>
              <span>PREVIEW 01</span>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-[#0c0806] p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-space text-lg font-semibold text-[#f8f1ea]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f97316]/15 text-[#ffb45c]"><ShieldCheck className="h-4 w-4" /></span>
                    Private balance
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[#75645a]">STRK20 / WALLET OWNED</div>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">Connected</span>
              </div>
              <div className="mt-8 flex items-end justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#75645a]">Shielded STRK</div>
                  <div className="mt-1 font-space text-4xl font-semibold tracking-[-0.06em] text-[#f8f1ea]">— <span className="text-base text-[#8e7b70]">STRK</span></div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-[#ffb45c]/20 bg-[#f97316]/10 px-3 py-1.5 font-mono text-[10px] text-[#ffb45c]"><LockKeyhole className="h-3 w-3" /> PRIVATE</div>
              </div>

              <div className="mt-7 h-28 overflow-hidden rounded-xl border border-white/[0.07] bg-[linear-gradient(180deg,rgba(249,115,22,0.12),transparent)]">
                <svg viewBox="0 0 520 160" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                  <defs><linearGradient id="heroChart" x1="0" x2="1"><stop offset="0" stopColor="#8d3c1b" /><stop offset="0.55" stopColor="#f97316" /><stop offset="1" stopColor="#ffb45c" /></linearGradient></defs>
                  <path d="M0 132 C28 130, 35 112, 60 118 S92 98, 120 112 S152 82, 181 94 S220 108, 246 75 S282 82, 305 57 S345 72, 369 48 S408 61, 432 31 S468 51, 520 18" fill="none" stroke="url(#heroChart)" strokeWidth="3" />
                  <path d="M0 132 C28 130, 35 112, 60 118 S92 98, 120 112 S152 82, 181 94 S220 108, 246 75 S282 82, 305 57 S345 72, 369 48 S408 61, 432 31 S468 51, 520 18 V160 H0 Z" fill="url(#heroChart)" opacity="0.12" />
                  <line x1="0" y1="132" x2="520" y2="132" stroke="rgba(255,255,255,.09)" strokeDasharray="4 8" />
                </svg>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ['SENDER', 'HIDDEN'],
                  ['AMOUNT', 'HIDDEN'],
                  ['POOL', 'STRK20'],
                ].map(([label, value]) => (
                  <div key={label} className="border-t border-white/10 pt-2">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#75645a]">{label}</div>
                    <div className="mt-1 font-mono text-[10px] font-bold text-[#d9c9bd]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between px-2 pt-3 font-mono text-[9px] uppercase tracking-[0.13em] text-[#75645a]">
              <span>Read-only product preview</span>
              <Link href="/wallet" className="inline-flex items-center gap-1 text-[#ffb45c] hover:text-[#f8f1ea]">Open wallet <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
          </div>
          <div className="landing-glass absolute -bottom-7 -left-5 hidden rounded-2xl px-4 py-3 sm:block">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#75645a]">Privacy by design</div>
            <div className="mt-1 flex items-center gap-2 font-space text-sm font-semibold text-[#f8f1ea]"><span className="h-1.5 w-1.5 rounded-full bg-[#ffb45c]" /> Wallet holds the secrets</div>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto mt-20 flex max-w-6xl items-center justify-between border-y border-white/[0.08] py-4 font-mono text-[9px] uppercase tracking-[0.16em] text-[#75645a] sm:mt-28">
        <span>01 / PRIVATE PAYMENTS</span>
        <span className="hidden sm:inline">A quieter way to move onchain</span>
        <span className="text-[#ffb45c]">Scroll to explore ↓</span>
      </div>
    </section>
  );
};
