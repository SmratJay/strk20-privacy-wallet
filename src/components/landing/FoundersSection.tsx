'use client';

import React, { useState } from 'react';
import { ArrowUpRight, KeyRound, LockKeyhole, Sparkles } from 'lucide-react';

interface FoundersSectionProps {
  onOpenWaitlistModal: () => void;
}

export const FoundersSection: React.FC<FoundersSectionProps> = ({ onOpenWaitlistModal }) => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 8,
      y: -((event.clientY - rect.top) / rect.height - 0.5) * 8,
    });
  };

  return (
    <section id="founders" className="relative overflow-hidden border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-[#8d3c1b]/20 blur-[120px]" />
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-24">
        <div>
          <div className="landing-kicker mb-6 flex items-center gap-3"><span className="h-px w-8 bg-[#ffb45c]/70" />02 / THE PASS</div>
          <h2 className="landing-display max-w-xl text-[clamp(4.8rem,11vw,9rem)] text-[#f8f1ea]">
            PRIVATE<br /><span className="text-[#ffb45c]">IS A CULTURE.</span>
          </h2>
          <p className="mt-8 max-w-md text-base leading-7 text-[#b8a59a] sm:text-lg">
            ORRANGE starts with a wallet that lets you choose what leaves the room. Early access is a pass into the build, not a promise of a finished protocol.
          </p>
          <button type="button" onClick={onOpenWaitlistModal} className="landing-button mt-8 inline-flex items-center gap-2 border-b border-[#ffb45c]/60 pb-2 font-space text-sm font-semibold text-[#f8f1ea] hover:border-[#f8f1ea] hover:text-[#ffb45c]">
            Join the early access registry <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-[#f97316]/10 blur-3xl" />
          <div
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}
            style={{ transform: `perspective(1200px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)` }}
            className="landing-glass relative overflow-hidden rounded-[2rem] p-3 transition-transform duration-200 ease-out sm:p-4"
          >
            <div className="relative min-h-[23rem] overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#d26a2d] p-6 text-[#160b06] shadow-2xl sm:min-h-[28rem] sm:p-8">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full border-[26px] border-[#ffb45c]/60 opacity-70" />
              <div className="absolute -bottom-16 -left-16 h-56 w-56 rounded-full border-[18px] border-[#8d3c1b]/30" />
              <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(135deg,transparent_0%,rgba(255,255,255,.65)_46%,transparent_51%)] [background-size:220%_220%] animate-shimmer" />
              <div className="relative flex items-start justify-between font-mono text-[9px] font-bold uppercase tracking-[0.16em]">
                <span>ORRANGE / PASS</span><span>EA-0001</span>
              </div>
              <div className="relative mt-24 sm:mt-36">
                <div className="font-bebas text-[4.5rem] leading-[0.8] tracking-[0.02em] sm:text-[6rem]">EARLY<br />ACCESS</div>
                <div className="mt-5 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em]"><Sparkles className="h-3.5 w-3.5" /> A work in progress, by design</div>
              </div>
              <div className="relative mt-8 flex items-end justify-between border-t border-black/20 pt-4 font-mono text-[9px] font-bold uppercase tracking-[0.12em]">
                <span>STARKNET / STRK20</span><span>ORRANGE.LABS</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4 sm:p-3">
              {[
                [LockKeyhole, 'Private notes'],
                [KeyRound, 'Wallet-owned'],
                [Sparkles, 'Early access'],
                [ArrowUpRight, 'Keep climbing'],
              ].map(([Icon, label]) => (
                <div key={label as string} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2 font-mono text-[9px] uppercase tracking-wider text-[#8e7b70]">
                  <Icon className="h-3 w-3 text-[#ffb45c]" /> <span>{label as string}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="landing-kicker mt-4 flex items-center justify-between px-2 text-[#75645a]"><span>Founder pass / visual prototype</span><span>Hover to inspect</span></div>
        </div>
      </div>
    </section>
  );
};
