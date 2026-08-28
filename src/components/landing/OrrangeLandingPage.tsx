'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { MarqueeTicker } from './MarqueeTicker';
import { FloatingNav } from './FloatingNav';
import { HeroSection } from './HeroSection';
import { FoundersSection } from './FoundersSection';
import { PrivacyDeskSection } from './PrivacyDeskSection';
import { ClubSection } from './ClubSection';
import { FloatingBottomDock } from './FloatingBottomDock';
import { WaitlistModal } from './WaitlistModal';
import { ArrowUpRight, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';

/**
 * Web Audio API synthesizer for tactile micro-interactions (no external mp3 files needed)
 */
const playHapticTone = (freq = 440, type: OscillatorType = 'sine', duration = 0.08) => {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Graceful fallback if audio is disabled
  }
};

export const OrrangeLandingPage: React.FC = () => {
  const [isWaitlistModalOpen, setIsWaitlistModalOpen] = useState(false);
  const [userEntry, setUserEntry] = useState('');

  const handleJoinWaitlist = (input: string) => {
    playHapticTone(587.33, 'triangle', 0.15); // D5 chime
    setUserEntry(input);
    setIsWaitlistModalOpen(true);
  };

  const handleOpenWaitlistModal = () => {
    playHapticTone(493.88, 'sine', 0.1); // B4 chime
    setIsWaitlistModalOpen(true);
  };

  return (
    <div className="landing-shell min-h-screen overflow-x-hidden pb-24 font-sans text-[#F8F1EA] selection:bg-[#C45B2C] selection:text-white">
      
      {/* Top Infinite Marquee Ticker */}
      <MarqueeTicker />

      {/* Floating Pill Navigation Bar */}
      <FloatingNav onOpenWaitlist={handleOpenWaitlistModal} />

      {/* Section 1: Hero ("ORRANGE") */}
      <HeroSection 
        onJoinWaitlist={handleJoinWaitlist} 
        onOpenWaitlistModal={handleOpenWaitlistModal} 
      />

      {/* Editorial bridge: the reason for the product, without a generic feature grid. */}
      <section className="relative overflow-hidden border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8d3c1b]/15 blur-[130px]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:gap-24">
          <div>
            <div className="landing-kicker mb-6 flex items-center gap-3"><span className="h-px w-8 bg-[#ffb45c]/70" />01 / THE REASON</div>
            <h2 className="landing-display max-w-xl text-[clamp(4.8rem,10vw,8.6rem)] text-[#f8f1ea]">PUBLIC<br /><span className="text-[#ffb45c]">IS LOUD.</span></h2>
          </div>
          <div className="max-w-xl lg:pb-2">
            <p className="font-space text-2xl font-semibold leading-[1.05] tracking-[-0.045em] text-[#f8f1ea] sm:text-4xl">Your balance should not be the first thing the internet learns about you.</p>
            <p className="mt-7 text-base leading-7 text-[#b8a59a]">Onchain transparency is powerful. It is also a lot to give away. ORRANGE puts a clearer privacy boundary around STRK20 payments while the connected wallet keeps custody of the sensitive material.</p>
          </div>
        </div>
        <div className="relative mx-auto mt-16 grid max-w-6xl gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-3">
          {[
            { Icon: EyeOff, label: 'Less exposed', detail: 'Payment details stay inside the privacy pool.' },
            { Icon: LockKeyhole, label: 'More control', detail: 'Keys, notes, and proofs belong to your wallet.' },
            { Icon: ShieldCheck, label: 'Still verifiable', detail: 'Privacy does not mean abandoning clear boundaries.' },
          ].map(({ Icon, label, detail }) => (
            <div key={label} className="bg-[#120c08]/80 p-5 sm:p-6">
              <Icon className="h-5 w-5 text-[#ffb45c]" />
              <div className="mt-8 font-space text-base font-semibold text-[#f8f1ea]">{label}</div>
              <p className="mt-2 text-sm leading-6 text-[#8e7b70]">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: Founders & Ladder ("Climb in.") */}
      <FoundersSection 
        onOpenWaitlistModal={handleOpenWaitlistModal} 
      />

      {/* Section 3: Privacy Desk ("YOUR ENTIRE PRIVACY DESK.") */}
      <PrivacyDeskSection />

      {/* Section 4: The Club ("WELCOME TO THE CLUB.") */}
      <ClubSection 
        onOpenWaitlistModal={handleOpenWaitlistModal} 
      />

      {/* Global Landing Footer */}
      <footer className="mx-auto max-w-6xl space-y-8 border-t border-white/[0.08] px-5 py-14 text-center sm:px-8 lg:px-10">
        <div className="flex flex-col items-start justify-between gap-8 text-left sm:flex-row sm:items-end">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#ffb45c]/50 bg-[#f97316]/20"><span className="h-3 w-3 rotate-45 border border-[#ffb45c]" /></div>
            <span className="font-bebas text-3xl tracking-[0.08em] text-[#f8f1ea]">ORRANGE</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#75645a]">// Starknet privacy</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[#8e7b70]">
            <Link href="/wallet" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#ffb45c]">
              Launch wallet <ArrowUpRight className="h-3 w-3" />
            </Link>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[#f8f1ea]">GitHub</a>
            <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[#f8f1ea]">X / Twitter</a>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 border-t border-white/[0.07] pt-5 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[#5f5048] sm:flex-row">
          <div>&copy; {new Date().getFullYear()} ORRANGE Labs</div>
          <div>Non-custodial interface / Wallet-owned privacy</div>
        </div>
      </footer>

      {/* Pinned Bottom Floating Dock (Matching screenshots) */}
      <FloatingBottomDock 
        onJoinWaitlist={handleJoinWaitlist} 
        onOpenWaitlistModal={handleOpenWaitlistModal} 
      />

      {/* Waitlist Modal */}
      <WaitlistModal 
        isOpen={isWaitlistModalOpen} 
        onClose={() => setIsWaitlistModalOpen(false)} 
        userEntry={userEntry} 
      />

    </div>
  );
};
