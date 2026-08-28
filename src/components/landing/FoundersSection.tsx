'use client';

import React, { useState } from 'react';
import { ArrowUpRight, KeyRound, LockKeyhole, Sparkles } from 'lucide-react';

interface FoundersSectionProps { onOpenWaitlistModal: () => void; }

export const FoundersSection: React.FC<FoundersSectionProps> = ({ onOpenWaitlistModal }) => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({ x: ((event.clientX - rect.left) / rect.width - 0.5) * 8, y: -((event.clientY - rect.top) / rect.height - 0.5) * 8 });
  };

  return (
    <section id="founders" className="landing-panel landing-candy-light flex min-h-[calc(100svh-2rem)] items-center justify-center px-5 py-32 sm:px-8 sm:py-40">
      <div className="pointer-events-none absolute -left-16 top-12 h-56 w-56 rounded-full bg-[#f15b33]/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-72 w-72 rounded-full bg-[#d56de7]/25 blur-3xl" />
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <div className="landing-sticker-label mb-8"><span className="h-2 w-2 rounded-full bg-emerald-500" /> ORRANGE WAITLIST / LIVE PREVIEW</div>
        <h2 className="landing-scene-heading max-w-5xl text-[#251326]">MISSED THE<br /><span className="bg-gradient-to-r from-[#7a33d8] via-[#ee43be] to-[#f15b33] bg-clip-text text-transparent">FOUNDERS?</span></h2>
        <p className="landing-poster-copy mx-auto mt-9 max-w-2xl text-[#654352]">Climb in. The founding pass is an early-access concept for people who want to help shape a privacy product before the rest of the room arrives.</p>

        <div className="mt-14 grid w-full max-w-4xl gap-5 md:grid-cols-2 md:items-center">
          <div onMouseMove={handleMouseMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })} style={{ transform: `perspective(1000px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)` }} className="landing-pass relative min-h-[21rem] overflow-hidden rounded-[2rem] border border-white/80 bg-[#19121e] p-5 text-left shadow-[0_25px_50px_rgba(68,27,62,.2)] transition-transform duration-200 sm:min-h-[25rem] sm:p-7">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,172,122,.7),transparent_27%),radial-gradient(circle_at_80%_75%,rgba(222,44,159,.65),transparent_34%),linear-gradient(135deg,#f77d5b,#7d2ec0_54%,#201326)]" />
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(120deg,transparent_0%,rgba(255,255,255,.9)_45%,transparent_51%)] [background-size:220%_220%] animate-shimmer" />
            <div className="relative flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-white/85"><span>ORRANGE / PASS</span><span>EA-0001</span></div>
            <div className="relative mt-24 sm:mt-28"><div className="font-bebas text-6xl leading-[0.78] tracking-[0.02em] text-white">FOUNDING<br />ROUND.</div><div className="mt-6 flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-white/75"><Sparkles className="h-3.5 w-3.5" /> Preview artifact / not a token</div></div>
            <div className="relative mt-8 flex items-end justify-between border-t border-white/25 pt-4 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white/70"><span>STRK20 / STARKNET</span><LockKeyhole className="h-4 w-4" /></div>
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/35 p-6 text-left shadow-[0_25px_50px_rgba(68,27,62,.1)] backdrop-blur-sm sm:p-8">
            <div className="flex items-center justify-between border-b border-[#5d2e37]/15 pb-4 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-[#734352]"><span>EARLY ACCESS</span><span>OPEN</span></div>
            <div className="mt-8 font-space text-3xl font-semibold leading-[0.95] tracking-[-0.06em] text-[#251326]">A place for the curious, before it gets crowded.</div>
            <div className="mt-8 space-y-4">
              {[[KeyRound, 'Keys stay with your wallet'], [LockKeyhole, 'STRK20 private payments'], [Sparkles, 'Future surfaces marked clearly']].map(([Icon, copy]) => <div key={copy as string} className="flex items-center gap-3 border-b border-[#5d2e37]/10 pb-3 text-sm font-semibold text-[#5d3340]"><Icon className="h-4 w-4 text-[#e94d43]" />{copy as string}</div>)}
            </div>
            <button type="button" onClick={onOpenWaitlistModal} className="landing-button mt-9 inline-flex items-center gap-2 rounded-full bg-[#21121e] px-5 py-3.5 text-sm font-bold text-white hover:bg-[#f15b33]">Claim early access <ArrowUpRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="mt-6 flex w-full max-w-4xl justify-between px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-[#895664]"><span>02 / PASS</span><span>Hover the artifact</span></div>
      </div>
    </section>
  );
};
