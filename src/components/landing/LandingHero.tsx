'use client';

import React from 'react';
import { ArrowRight, ShieldCheck, Zap, Terminal, Lock, FileText, Sparkles } from 'lucide-react';
import { AsciiHeroVisual } from './AsciiHeroVisual';

interface LandingHeroProps {
  onLaunchTerminal: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({ onLaunchTerminal }) => {
  return (
    <div className="relative pt-8 pb-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: Big Bold Typography */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-orrange-500/40 bg-orrange-500/5 text-orrange-400 font-mono text-xs font-semibold tracking-wider uppercase">
            <span className="w-2 h-2 rounded-full bg-orrange-500 animate-pulse" />
            <span>STARKNET PRIVATE EXECUTION LAYER // V0.2</span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-white tracking-tighter leading-[0.95] uppercase font-sans">
            BUILD <br />
            WHAT &apos;S <br />
            <span className="text-orrange-500 terminal-glow">PRIVATE</span>
          </h1>

          <p className="text-sm sm:text-base font-mono text-zinc-400 max-w-xl leading-relaxed">
            Verified, confidential execution and intent routing across Starknet. 
            Shielded assets, private perpetuals, and zero-knowledge compliance powering 
            the next generation of financial sovereignty.
          </p>

          {/* CTA Action Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <button
              onClick={onLaunchTerminal}
              className="px-6 py-3.5 rounded-none border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-mono text-xs font-black tracking-widest uppercase transition-all shadow-xl shadow-orrange-950/50 hover:scale-[1.02] flex items-center gap-2.5 corner-box cursor-pointer"
            >
              <span>Get Started with orrange</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <a
              href="#architecture"
              className="px-5 py-3.5 rounded-none border border-zinc-800 hover:border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:text-white font-mono text-xs font-bold tracking-wider uppercase transition-colors flex items-center gap-2"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-500" />
              <span>Architecture Specs</span>
            </a>
          </div>

          {/* Quick Metrics Ticker */}
          <div className="grid grid-cols-3 gap-3 pt-6 border-t border-zinc-900/80 font-mono text-xs text-zinc-400">
            <div>
              <div className="text-white font-bold text-base">STRK20</div>
              <div className="text-[10px] text-zinc-500 uppercase">Native UTXO Pool</div>
            </div>
            <div>
              <div className="text-orrange-400 font-bold text-base">0-Gas</div>
              <div className="text-[10px] text-zinc-500 uppercase">1-Click Session Keys</div>
            </div>
            <div>
              <div className="text-emerald-400 font-bold text-base">100% ZK</div>
              <div className="text-[10px] text-zinc-500 uppercase">Verified Invariants</div>
            </div>
          </div>
        </div>

        {/* Right Column: Dynamic ASCII Hero Matrix Graphic */}
        <div className="lg:col-span-5 flex justify-center">
          <div className="w-full max-w-lg p-2 bg-zinc-950/90 border border-zinc-800/80 corner-box shadow-2xl">
            <AsciiHeroVisual />
          </div>
        </div>
      </div>
    </div>
  );
};
