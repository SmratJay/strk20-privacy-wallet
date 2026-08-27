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
import { Terminal, Shield, ArrowUpRight, ExternalLink } from 'lucide-react';

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
    <div className="min-h-screen bg-[#0F0A07] text-[#FBF7F4] font-sans selection:bg-[#C45B2C] selection:text-white relative overflow-x-hidden pb-24">
      
      {/* Top Infinite Marquee Ticker */}
      <MarqueeTicker />

      {/* Floating Pill Navigation Bar */}
      <FloatingNav onOpenWaitlist={handleOpenWaitlistModal} />

      {/* Section 1: Hero ("ORRANGE") */}
      <HeroSection 
        onJoinWaitlist={handleJoinWaitlist} 
        onOpenWaitlistModal={handleOpenWaitlistModal} 
      />

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
      <footer className="border-t border-[#351F14]/50 py-12 px-4 max-w-5xl mx-auto text-center space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#C45B2C] text-black font-syne font-black flex items-center justify-center text-xs">
              ✦
            </div>
            <span className="font-bebas text-2xl tracking-wider text-white">ORRANGE</span>
            <span className="text-[10px] font-mono text-zinc-500">// STARKNET PRIVACY</span>
          </div>

          <div className="flex items-center gap-6 text-xs font-syne text-zinc-400">
            <Link href="/wallet" className="hover:text-[#F08A3C] transition-colors flex items-center gap-1">
              <span>Launch Wallet App</span>
              <Shield className="w-3 h-3" />
            </Link>
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a 
              href="https://x.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              𝕏 / Twitter
            </a>
          </div>
        </div>

        <div className="pt-6 border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-zinc-600 gap-2">
          <div>
            &copy; {new Date().getFullYear()} ORRANGE Labs. Powered by Starknet &amp; Garaga ZK Verifiers.
          </div>
          <div>
            Non-custodial. Zero-knowledge. Built for culture.
          </div>
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
