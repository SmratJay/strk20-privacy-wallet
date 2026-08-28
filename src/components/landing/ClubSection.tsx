'use client';

import React from 'react';
import { ArrowUpRight, CircleDot, EyeOff, Sparkles } from 'lucide-react';

interface ClubSectionProps {
  onOpenWaitlistModal: () => void;
}

const PASSES = [
  { label: 'ORRANGE / PASS', title: 'GENESIS', meta: 'EARLY ACCESS', className: 'from-[#ffb45c] via-[#d76a24] to-[#6f2a12]' },
  { label: 'ORRANGE / PASS', title: 'ZK GHOST', meta: 'CONCEPT TIER', className: 'from-[#f1d2b5] via-[#aa6542] to-[#3a1a12]' },
  { label: 'ORRANGE / PASS', title: 'NIGHT SHIFT', meta: 'COMMUNITY LAYER', className: 'from-[#4d2113] via-[#a23e19] to-[#f97316]' },
];

export const ClubSection: React.FC<ClubSectionProps> = ({ onOpenWaitlistModal }) => (
  <section id="club" className="relative overflow-hidden border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
    <div className="pointer-events-none absolute right-[-10rem] top-1/4 h-[32rem] w-[32rem] rounded-full bg-[#f97316]/10 blur-[130px]" />
    <div className="relative mx-auto max-w-6xl">
      <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-end lg:gap-24">
        <div>
          <div className="landing-kicker mb-6 flex items-center gap-3"><span className="h-px w-8 bg-[#ffb45c]/70" />04 / THE CIRCLE</div>
          <h2 className="landing-display text-[clamp(4.8rem,11vw,9rem)] text-[#f8f1ea]">KEEP<br /><span className="text-[#ffb45c]">IT PRIVATE.</span></h2>
        </div>
        <div className="max-w-xl lg:pb-2">
          <p className="font-space text-2xl font-semibold leading-[1.05] tracking-[-0.045em] text-[#f8f1ea] sm:text-4xl">A product layer for people who notice who is watching.</p>
          <p className="mt-6 max-w-lg text-sm leading-6 text-[#b8a59a] sm:text-base">Passes, rituals, and community experiments will grow around the wallet over time. For now, this is the first frame: a quiet invitation to help shape it.</p>
        </div>
      </div>

      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {PASSES.map((pass, index) => (
          <div key={pass.title} className={`group relative min-h-[20rem] overflow-hidden rounded-[1.6rem] border border-white/10 bg-gradient-to-br ${pass.className} p-5 text-[#170b06] shadow-2xl transition-transform duration-300 hover:-translate-y-2 ${index === 1 ? 'md:translate-y-10' : ''}`}>
            <div className="absolute -right-12 -top-14 h-44 w-44 rounded-full border-[18px] border-white/20 transition-transform duration-500 group-hover:scale-125" />
            <div className="absolute bottom-8 right-6 opacity-25"><EyeOff className="h-24 w-24" strokeWidth={1} /></div>
            <div className="relative flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.15em]"><span>{pass.label}</span><span>0{index + 1}</span></div>
            <div className="relative mt-28 sm:mt-32"><div className="font-bebas text-5xl leading-none tracking-[0.02em]">{pass.title}</div><div className="mt-3 flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"><CircleDot className="h-3 w-3" /> {pass.meta}</div></div>
            <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between border-t border-black/20 pt-3 font-mono text-[9px] font-bold uppercase tracking-wider"><span>ORRANGE.LABS</span><span>NOT A CLAIM</span></div>
          </div>
        ))}
      </div>

      <div className="mt-24 grid gap-8 border-t border-white/10 pt-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="flex max-w-2xl items-start gap-4"><span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ffb45c]/30 bg-[#f97316]/10 text-[#ffb45c]"><Sparkles className="h-4 w-4" /></span><div><div className="font-space text-lg font-semibold text-[#f8f1ea]">The culture layer is still being written.</div><p className="mt-2 text-sm leading-6 text-[#8e7b70]">Join early, see the real wallet first, and get a front-row seat as the rest takes shape.</p></div></div>
        <button type="button" onClick={onOpenWaitlistModal} className="landing-button inline-flex items-center justify-center gap-2 rounded-full bg-[#f8f1ea] px-5 py-3.5 text-sm font-bold text-[#1b0e08] hover:bg-[#ffb45c]">Get on the list <ArrowUpRight className="h-4 w-4" /></button>
      </div>
    </div>
  </section>
);
