'use client';

import React from 'react';
import { ArrowUpRight, CircleDot, EyeOff, Sparkles } from 'lucide-react';
import { FlameHeartSticker, GoatSticker, PixelPointerSticker, TarotBookSticker } from './InteractiveStickers';

interface ClubSectionProps { onOpenWaitlistModal: () => void; }
const PASSES = [
  { title: 'GENESIS', meta: 'EARLY ACCESS', color: 'from-[#ffdb80] via-[#f47a54] to-[#8c2e51]' },
  { title: 'ZK GHOST', meta: 'CONCEPT TIER', color: 'from-[#ffd6c4] via-[#bf5b77] to-[#3a183a]' },
  { title: 'NIGHT SHIFT', meta: 'COMMUNITY LAYER', color: 'from-[#ff9c74] via-[#d74748] to-[#6c193e]' },
];

export const ClubSection: React.FC<ClubSectionProps> = ({ onOpenWaitlistModal }) => (
  <section id="club" className="landing-panel landing-candy-orange flex min-h-[calc(100svh-2rem)] items-center justify-center px-5 py-32 sm:px-8 sm:py-40">
    <div className="absolute left-[4%] top-[8%] hidden rotate-[-12deg] sm:block"><TarotBookSticker size={120} /></div>
    <div className="absolute right-[5%] top-[12%] hidden rotate-12 sm:block"><PixelPointerSticker size={72} /></div>
    <div className="absolute bottom-[8%] left-[5%] hidden rotate-[-10deg] md:block"><FlameHeartSticker size={128} /></div>
    <div className="absolute bottom-[11%] right-[8%] hidden rotate-6 md:block"><GoatSticker size={110} /></div>
    <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
      <div className="landing-sticker-label mb-8 border-white/45 bg-white/25 text-[#64272d]"><span className="h-2 w-2 rounded-full bg-[#ef315a]" /> ORRANGE / COMMUNITY LAYER</div>
      <h2 className="landing-scene-heading max-w-5xl text-[#5b1924]">WELCOME TO<br /><span className="text-[#fff4ed]">THE QUIET CLUB.</span></h2>
      <p className="landing-poster-copy mx-auto mt-9 max-w-2xl text-[#702d35]">Passes, rituals, and culture for people who know privacy is not boring — it is a choice.</p>
      <div className="mt-14 grid w-full max-w-5xl gap-4 md:grid-cols-3">
        {PASSES.map((pass, index) => <div key={pass.title} className={`group relative min-h-[18rem] overflow-hidden rounded-[1.7rem] border border-white/60 bg-gradient-to-br ${pass.color} p-5 text-left shadow-[0_24px_44px_rgba(105,26,35,.18)] transition-transform duration-300 hover:-translate-y-2 ${index === 1 ? 'md:translate-y-8' : ''}`}><div className="absolute -right-12 -top-10 h-36 w-36 rounded-full border-[16px] border-white/25 transition-transform duration-500 group-hover:scale-125" /><div className="absolute bottom-9 right-5 opacity-25"><EyeOff className="h-24 w-24" /></div><div className="relative flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-[#33131c]"><span>ORRANGE / PASS</span><span>0{index + 1}</span></div><div className="relative mt-24"><div className="font-bebas text-5xl leading-none text-[#2f1119]">{pass.title}</div><div className="mt-3 flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5c222d]"><CircleDot className="h-3 w-3" /> {pass.meta}</div></div><div className="absolute bottom-5 left-5 right-5 flex items-center justify-between border-t border-black/15 pt-3 font-mono text-[9px] font-bold uppercase tracking-wider text-[#5c222d]"><span>ORRANGE.LABS</span><span>CONCEPT</span></div></div>)}
      </div>
      <div className="mt-24 flex max-w-3xl flex-col items-center gap-6 sm:flex-row sm:justify-between sm:text-left"><div className="flex items-start gap-3"><Sparkles className="mt-1 h-5 w-5 shrink-0 text-[#7a2231]" /><div><div className="font-space text-lg font-bold text-[#4d1b26]">The culture layer is still being written.</div><p className="mt-1 text-sm leading-6 text-[#783943]">Join early and get a front-row seat as ORRANGE grows around the wallet.</p></div></div><button type="button" onClick={onOpenWaitlistModal} className="landing-button inline-flex shrink-0 items-center gap-2 rounded-full bg-[#21121e] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#f8f1ea] hover:text-[#21121e]">Get on the list <ArrowUpRight className="h-4 w-4" /></button></div>
      <div className="mt-8 flex w-full max-w-5xl justify-between px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#803b47]"><span>04 / CLUB</span><span>Concepts, not claims</span></div>
    </div>
  </section>
);
