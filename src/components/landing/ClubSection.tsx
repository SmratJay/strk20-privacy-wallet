'use client';

import React from 'react';
import { Sparkles, Trophy, Flame, Shield, Users, ArrowUpRight, Award } from 'lucide-react';
import { 
  TarotBookSticker, 
  PixelPointerSticker, 
  FlameHeartSticker,
  GoatSticker 
} from './InteractiveStickers';

interface ClubSectionProps {
  onOpenWaitlistModal: () => void;
}

export const ClubSection: React.FC<ClubSectionProps> = ({ onOpenWaitlistModal }) => {
  const collectibles = [
    {
      name: 'GENESIS FOUNDER',
      serial: '#0001 - #1000',
      badge: '✦ 0-GAS LIFETIME',
      color: 'from-amber-600 via-orange-500 to-yellow-400',
      desc: 'Exclusive access to experimental Starknet privacy primitives & fee waivers.',
    },
    {
      name: 'ZK GHOST',
      serial: 'CONFIDENTIAL TIER',
      badge: '⚡ 100% UNTRACEABLE',
      color: 'from-purple-600 via-pink-500 to-indigo-400',
      desc: 'Granted to power users executing 50+ shielded note transactions.',
    },
    {
      name: 'STRK WHALE CLUB',
      serial: 'VOLUME OVER $100K',
      badge: '💎 VIP SETTLEMENT',
      color: 'from-cyan-600 via-blue-500 to-teal-400',
      desc: 'Priority orderbook intent routing & private institutional dark pool access.',
    },
    {
      name: '100-DAY PRIVACY STREAK',
      serial: 'ON-CHAIN CULTURE',
      badge: '🔥 CULTURE LEADER',
      color: 'from-red-600 via-orange-600 to-amber-500',
      desc: 'Streak rewards multiplier & exclusive private physical merch drops.',
    },
  ];

  const topClimbers = [
    { rank: '#01', handle: '@stark_chad', referrals: '142 friends', points: '71,000 pts', status: 'In Founder Spot' },
    { rank: '#02', handle: '@zk_queen', referrals: '98 friends', points: '49,000 pts', status: 'In Founder Spot' },
    { rank: '#03', handle: '@cairo_alchemist', referrals: '84 friends', points: '42,000 pts', status: 'In Founder Spot' },
    { rank: '#04', handle: '@defi_phantom', referrals: '63 friends', points: '31,500 pts', status: 'Climbing +14' },
  ];

  return (
    <section 
      id="club" 
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-20 sm:py-28 overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #D76A24 0%, #C45B2C 30%, #8F3F1F 65%, #0F0A07 95%)'
      }}
    >
      {/* Texture */}
      <div className="absolute inset-0 pixel-grid-bg opacity-30 pointer-events-none" />

      {/* Floating Stickers matching Screenshot 4 */}
      <div className="absolute top-12 left-4 sm:left-12 lg:left-24 z-20 animate-float-slow hidden sm:block">
        <TarotBookSticker size={90} />
      </div>

      <div className="absolute top-24 right-4 sm:right-14 lg:right-32 z-20 animate-float-medium hidden xs:block">
        <PixelPointerSticker size={58} />
      </div>

      <div className="absolute bottom-20 left-6 sm:left-16 z-20 animate-float-medium hidden md:block">
        <FlameHeartSticker size={76} />
      </div>

      <div className="absolute bottom-24 right-6 sm:right-20 z-20 animate-float-slow hidden md:block">
        <GoatSticker size={85} />
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-5xl mx-auto flex flex-col items-center text-center space-y-8 w-full">
        
        {/* Headline */}
        <h2 className="font-bebas text-6xl xs:text-7xl sm:text-8xl md:text-9xl text-[#FBF7F4] leading-[0.88] tracking-tight uppercase select-none drop-shadow-[0_15px_30px_rgba(0,0,0,0.8)]">
          WELCOME TO <br />
          <span className="text-white drop-shadow-[0_4px_20px_rgba(255,255,255,0.5)]">
            THE CLUB.
          </span>
        </h2>

        {/* Pitch */}
        <p className="font-sans text-sm sm:text-base md:text-lg text-zinc-100 max-w-xl leading-relaxed font-medium">
          Badges, collectibles, streaks and a community that actually gets it. Money, but make it culture.
        </p>

        {/* 4 Collectible Badge Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full pt-4">
          {collectibles.map((item, idx) => (
            <div
              key={idx}
              className="glass-card-amber rounded-3xl p-5 flex flex-col justify-between text-left shadow-2xl border border-white/20 hover:border-[#F08A3C] transition-all hover:-translate-y-1 group"
            >
              <div>
                <div className={`w-full h-24 rounded-2xl bg-gradient-to-tr ${item.color} p-3 flex flex-col justify-between shadow-md relative overflow-hidden group-hover:scale-102 transition-transform`}>
                  <div className="flex justify-between items-center text-[10px] font-mono text-white font-black drop-shadow">
                    <span>ORRANGE // PASS</span>
                    <span>✦</span>
                  </div>
                  <div className="font-bebas text-lg text-white tracking-wider leading-none drop-shadow">
                    {item.name}
                  </div>
                </div>

                <div className="mt-4 space-y-1.5">
                  <div className="text-[10px] font-mono font-bold text-[#F08A3C] uppercase tracking-wider">
                    {item.badge}
                  </div>
                  <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-between items-center text-[10px] font-mono text-zinc-500">
                <span>{item.serial}</span>
                <span className="text-white group-hover:text-[#F08A3C] transition-colors">CLAIM ↗</span>
              </div>
            </div>
          ))}
        </div>

        {/* Live Climber Leaderboard Preview */}
        <div className="w-full max-w-2xl glass-card-amber rounded-3xl p-6 shadow-2xl border border-white/20 text-left mt-6">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span className="font-syne font-bold text-sm text-white">Top Ladder Climbers</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">Refer to overtake founder seats</span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            {topClimbers.map((climber, idx) => (
              <div 
                key={idx} 
                className="flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-zinc-800/80 hover:border-[#F08A3C]/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[#F08A3C] w-6">{climber.rank}</span>
                  <span className="text-white font-medium">{climber.handle}</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="text-zinc-400 text-[11px]">{climber.referrals}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                    {climber.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 text-center">
            <button
              onClick={onOpenWaitlistModal}
              className="px-6 py-2.5 rounded-full text-xs font-syne font-extrabold text-black bg-white hover:bg-zinc-200 transition-all shadow-lg active:scale-95 cursor-pointer"
            >
              Get Your Invite Link &amp; Climb The Ladder ⚡
            </button>
          </div>
        </div>

      </div>
    </section>
  );
};
