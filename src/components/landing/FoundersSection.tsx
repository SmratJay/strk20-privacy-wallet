'use client';

import React, { useState } from 'react';
import { Lock, Sparkles, Trophy, Users, ArrowUpRight, CheckCircle2 } from 'lucide-react';

interface FoundersSectionProps {
  onOpenWaitlistModal: () => void;
}

export const FoundersSection: React.FC<FoundersSectionProps> = ({
  onOpenWaitlistModal,
}) => {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 15, y: -y * 15 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <section id="founders" className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 py-16 sm:py-24 overflow-hidden border-t border-[#351F14]/40">
      
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] rounded-full bg-gradient-to-tr from-[#8F3F1F]/25 via-[#C45B2C]/15 to-transparent blur-[140px] -z-10" />
      </div>

      <div className="max-w-4xl mx-auto flex flex-col items-center text-center space-y-6">
        
        {/* Live Status Pill */}
        <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full text-xs font-mono font-bold bg-[#18100B] border border-[#C45B2C]/40 text-[#F08A3C] shadow-sm">
          <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
          <span>ORRANGE WAITLIST · LIVE NOW</span>
        </div>

        {/* Headline: Just showing up? Missed the founders? Climb in. */}
        <h2 className="font-syne font-extrabold text-3xl sm:text-5xl md:text-6xl text-[#FBF7F4] leading-[1.1] max-w-2xl tracking-tight">
          Just showing up? Missed the founders?{' '}
          <span className="bg-gradient-to-r from-[#F08A3C] via-[#D76A24] to-[#ec4899] bg-clip-text text-transparent">
            Climb in.
          </span>
        </h2>

        {/* Descriptive Copy */}
        <p className="font-sans text-sm sm:text-base text-zinc-400 max-w-xl leading-relaxed">
          Every founding seat&apos;s taken — but nothing&apos;s locked till we launch. Refer friends, climb the ladder, and the top climbers still slide into founder spots. Keep moving.
        </p>

        {/* Dual Showcase Cards (Screenshot 2) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl pt-6">
          
          {/* Card 1: 3D Holographic Founder Card */}
          <div 
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
              transform: `perspective(1000px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
              transition: 'transform 0.15s ease-out'
            }}
            className="glass-card-amber rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-between min-h-[320px] shadow-2xl border border-[#C45B2C]/30 relative overflow-hidden group"
          >
            {/* Holographic Founder Card Artwork */}
            <div className="w-48 sm:w-52 h-44 rounded-2xl holographic-purple-foil p-4 flex flex-col justify-between shadow-2xl relative border border-white/20 transform group-hover:scale-105 transition-transform duration-300">
              <div className="flex justify-between items-start">
                <span className="font-bebas text-2xl tracking-wider text-white drop-shadow">
                  FOUNDER
                </span>
                <span className="text-xs font-mono font-bold text-white/80 bg-black/40 px-2 py-0.5 rounded-full border border-white/20">
                  #0420
                </span>
              </div>

              {/* ZK Circuit Trace Overlay */}
              <div className="text-left font-mono text-[9px] text-white/70 space-y-0.5">
                <div>STARKNET // STRK20</div>
                <div className="text-amber-200">CONFIDENTIAL PASS</div>
              </div>
            </div>

            {/* Status Pill */}
            <div className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-black/70 border border-zinc-700/60 text-xs font-syne font-bold text-zinc-300">
              <Lock className="w-3 h-3 text-[#F08A3C]" />
              <span>Founding round closed</span>
            </div>
          </div>

          {/* Card 2: Live Circular Radial Counter Gauge */}
          <div className="glass-card-amber rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-between min-h-[320px] shadow-2xl border border-[#C45B2C]/30 relative">
            
            {/* Top Tag: LIVE */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 border border-emerald-500/40 text-[11px] font-mono font-bold text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE</span>
            </div>

            {/* Circular Gauge Ring */}
            <div className="relative w-44 h-44 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                {/* Background Track */}
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="transparent"
                  stroke="#221610"
                  strokeWidth="8"
                />
                {/* Active Progress Gradient Ring (100% full) */}
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="transparent"
                  stroke="url(#progressGradient)"
                  strokeWidth="8"
                  strokeDasharray="301.6"
                  strokeDashoffset="0"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ec4899" />
                    <stop offset="50%" stopColor="#F08A3C" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Inside Gauge Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-bebas text-4xl sm:text-5xl text-[#FBF7F4] leading-none">
                  50,000
                </span>
                <span className="font-mono text-[9px] font-bold text-zinc-400 uppercase tracking-wider mt-0.5">
                  OF 50,000 SEATS
                </span>
                <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">
                  CLAIMED
                </span>
              </div>
            </div>

            {/* Gauge Bottom Stats */}
            <div className="text-xs font-mono font-bold text-zinc-400">
              <span className="text-[#F08A3C]">0 left</span> · <span className="text-emerald-400">100%</span>
            </div>
          </div>

        </div>

        {/* Action Button: Claim my seat */}
        <div className="pt-4 flex flex-col items-center space-y-2">
          <button
            onClick={onOpenWaitlistModal}
            className="px-8 py-3.5 rounded-full text-sm font-syne font-black text-white bg-gradient-to-r from-[#0F0A07] to-[#18100B] hover:to-[#221610] border-2 border-[#C45B2C] hover:border-[#F08A3C] shadow-2xl active:scale-95 transition-all flex items-center gap-2 cursor-pointer group"
          >
            <div className="w-5 h-5 rounded-full bg-[#C45B2C] text-white flex items-center justify-center text-[10px] font-mono font-bold">
              ✦
            </div>
            <span>Claim my seat</span>
          </button>

          <p className="font-sans text-xs text-zinc-500">
            First <strong className="text-zinc-300">1,000</strong> on the waitlist get app access at launch.
          </p>
        </div>

      </div>
    </section>
  );
};
