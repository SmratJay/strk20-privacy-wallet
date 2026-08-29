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
import { ScrollReveal } from './ScrollReveal';
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
  const [openFaq, setOpenFaq] = useState(0);

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
      <FloatingNav />

      {/* Section 1: Hero ("ORRANGE") */}
      <ScrollReveal>
        <HeroSection
          onJoinWaitlist={handleJoinWaitlist}
          onOpenWaitlistModal={handleOpenWaitlistModal}
        />
      </ScrollReveal>

      {/* Scene 2: the reason */}
      <ScrollReveal>
        <section id="reason" className="landing-panel landing-candy-orange flex min-h-[calc(100svh-2rem)] items-center justify-center px-5 py-32 sm:px-8 sm:py-40">
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-72 w-72 rounded-full bg-[#ffdd8c]/45 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 top-14 h-64 w-64 rounded-full bg-[#ef315a]/25 blur-3xl" />
        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <div className="landing-sticker-label mb-9 border-white/40 bg-white/25 text-[#5d2231]"><span className="h-2 w-2 rounded-full bg-[#ef315a]" /> THE REASON / READ THE ROOM</div>
          <h2 className="landing-scene-heading text-[#5a1320]">PUBLIC<br /><span className="text-[#fff3e9]">IS LOUD.</span></h2>
          <p className="landing-poster-copy mx-auto mt-10 max-w-3xl text-[#64252e]">Your balance should not be the first thing the internet learns about you. ORRANGE gives STRK20 payments a quieter boundary, with the connected wallet keeping the sensitive material in its own hands.</p>
          <div className="mx-auto mt-14 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
            {[
              { Icon: EyeOff, title: 'Less exposed', copy: 'Payment details stay inside the privacy pool.' },
              { Icon: LockKeyhole, title: 'More control', copy: 'Keys, notes, and proofs belong to your wallet.' },
              { Icon: ShieldCheck, title: 'Still verifiable', copy: 'Privacy does not mean losing the boundary.' },
            ].map(({ Icon, title, copy }) => <div key={title} className="rounded-2xl border border-white/35 bg-white/20 p-4 backdrop-blur-sm"><Icon className="h-5 w-5 text-[#7a2231]" /><div className="mt-5 font-space text-sm font-bold text-[#4c1e2a]">{title}</div><p className="mt-1 text-xs leading-5 text-[#783943]">{copy}</p></div>)}
          </div>
        </div>
        </section>
      </ScrollReveal>

      {/* Section 2: Founders & Ladder ("Climb in.") */}
      <ScrollReveal delay={1}>
        <FoundersSection
          onOpenWaitlistModal={handleOpenWaitlistModal}
        />
      </ScrollReveal>

      {/* Section 3: Privacy Desk ("YOUR ENTIRE PRIVACY DESK.") */}
      <ScrollReveal delay={1}><PrivacyDeskSection /></ScrollReveal>

      {/* Section 4: The Club ("WELCOME TO THE CLUB.") */}
      <ScrollReveal delay={2}>
        <ClubSection
          onOpenWaitlistModal={handleOpenWaitlistModal}
        />
      </ScrollReveal>

      {/* Scene 5: FAQ / product truth */}
      <ScrollReveal delay={1}>
        <section id="faq" className="landing-panel landing-candy-night min-h-[46rem] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-24">
          <div className="lg:pt-4"><div className="landing-kicker mb-6 text-[#ffb45c]">05 / PRODUCT TRUTH</div><h2 className="landing-scene-heading landing-faq-heading text-[#f8f1ea]">QUESTIONS,<br /><span className="text-[#ffb45c]">ANSWERED.</span></h2><p className="mt-8 max-w-sm text-base leading-7 text-[#b8a59a]">Privacy is easier to trust when the boundaries are clear. Here is what ORRANGE does — and what it does not pretend to do.</p></div>
          <div className="border-t border-white/10">
            {FAQ_ITEMS.map((item, index) => { const isOpen = openFaq === index; return <div key={item.question} className={`border-b border-white/10 ${isOpen ? 'border-l-2 border-l-[#ffb45c]' : 'border-l-2 border-l-transparent'}`}><button type="button" onClick={() => setOpenFaq(isOpen ? -1 : index)} aria-expanded={isOpen} className="flex w-full items-center gap-4 px-4 py-5 text-left sm:px-6"><span className="font-mono text-[10px] text-[#ffb45c]">0{index + 1}</span><span className="flex-1 font-space text-base font-semibold text-[#f8f1ea] sm:text-lg">{item.question}</span><span className="font-space text-xl font-light text-[#ffb45c]">{isOpen ? '−' : '+'}</span></button>{isOpen && <div className="px-12 pb-6 text-sm leading-6 text-[#a99589] sm:px-16">{item.answer}</div>}</div>; })}
          </div>
        </div>
        </section>
      </ScrollReveal>

      {/* Global Landing Footer */}
      <ScrollReveal delay={2}>
        <footer className="landing-panel landing-candy-night mx-3 max-w-none space-y-8 border-white/[0.08] px-5 py-10 text-center sm:mx-4 sm:px-8 sm:py-12 lg:px-12">
        <div className="-mx-5 overflow-hidden border-b border-white/[0.08] pb-8 sm:-mx-8 lg:-mx-12">
          <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap font-bebas text-6xl tracking-[0.02em] text-white/[0.09] sm:text-8xl">{Array.from({ length: 4 }, (_, index) => <span key={index}>JOIN THE QUIET SIDE <span className="text-[#ffb45c]">✦</span></span>)}</div>
        </div>
          <div className="flex flex-col items-start justify-between gap-8 text-left sm:flex-row sm:items-end">
          <div className="flex items-center gap-2">
            <img src="/orrange.png" alt="" aria-hidden="true" className="h-8 w-8 rounded-xl object-cover shadow-[0_4px_12px_rgba(39,12,29,.25)]" />
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
        <div className="landing-display select-none text-[clamp(5rem,17vw,15rem)] leading-[0.62] text-white/[0.035]">ORRANGE</div>
        </footer>
      </ScrollReveal>

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

const FAQ_ITEMS = [
  { question: 'What is ORRANGE?', answer: 'ORRANGE is the consumer-facing surface for STRK20 privacy on Starknet: a wallet experience for making funds private, sending shielded payments, and receiving privately.' },
  { question: 'Where do the keys and notes live?', answer: 'In the connected privacy wallet. The dapp requests Wallet API actions and does not store viewing keys, encrypted notes, proofs, or other cryptographic secrets.' },
  { question: 'Is this live or a concept?', answer: 'The STRK20 wallet flows are implemented for supported privacy wallets on Starknet Sepolia. Some future surfaces shown on this page are explicitly labelled preview or coming next.' },
  { question: 'Does private mean untraceable?', answer: 'No. STRK20 hides payment details inside the privacy pool, but broader network activity such as timing is not claimed to disappear.' },
  { question: 'How do I get early access?', answer: 'Use any Join waitlist control to open the current registry flow. Launching the wallet itself still requires a supported privacy wallet.' },
];
