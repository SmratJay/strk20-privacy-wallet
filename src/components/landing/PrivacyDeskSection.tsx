'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  TrendingUp, 
  ShieldCheck, 
  QrCode, 
  Key, 
  ArrowRight, 
  Sparkles, 
  Lock, 
  Layers,
  ArrowUpRight,
  CheckCircle2,
  Terminal
} from 'lucide-react';
import { 
  NoCapSticker, 
  GoatSticker, 
  MeltingTongueSticker, 
  PixelShadesSticker 
} from './InteractiveStickers';

export const PrivacyDeskSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'TRADE' | 'SHIELD' | 'STEALTH' | 'COLLECT'>('TRADE');
  const [leverage, setLeverage] = useState(25);
  const [stealthAmount, setStealthAmount] = useState('50');
  const [stealthCreated, setStealthCreated] = useState(false);

  return (
    <section 
      id="desk" 
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-20 sm:py-28 overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at 50% 40%, #A94A22 0%, #8F3F1F 35%, #0F0A07 85%)'
      }}
    >
      {/* Subtle Pixel Grid Texture */}
      <div className="absolute inset-0 pixel-grid-bg opacity-30 pointer-events-none" />

      {/* Floating Culture Stickers matching Screenshot 3 */}
      <div className="absolute top-12 left-4 sm:left-14 lg:left-24 z-20 animate-float-medium hidden sm:block">
        <MeltingTongueSticker size={88} />
      </div>

      <div className="absolute top-16 left-32 sm:left-48 lg:left-64 z-20 animate-float-slow hidden md:block">
        <NoCapSticker size={95} />
      </div>

      <div className="absolute top-12 right-4 sm:right-14 lg:right-24 z-20 animate-float-slow hidden sm:block">
        <PixelShadesSticker size={110} />
      </div>

      <div className="absolute top-28 right-16 sm:right-32 lg:right-48 z-20 animate-float-medium hidden md:block">
        <GoatSticker size={85} />
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-5xl mx-auto flex flex-col items-center text-center space-y-8 w-full">
        
        {/* Massive Condensed Headline */}
        <div className="space-y-1">
          <h2 className="font-bebas text-6xl xs:text-7xl sm:text-8xl md:text-9xl text-[#FBF7F4] leading-[0.88] tracking-tight uppercase select-none drop-shadow-[0_15px_30px_rgba(0,0,0,0.7)]">
            YOUR ENTIRE <br />
            <span className="text-white drop-shadow-[0_4px_16px_rgba(255,255,255,0.4)]">
              PRIVACY DESK.
            </span>
          </h2>
        </div>

        {/* Descriptive Pitch */}
        <p className="font-sans text-sm sm:text-base md:text-lg text-zinc-200/90 max-w-2xl leading-relaxed font-medium">
          Shielded STRK, stealth transfers, private perpetuals &amp; compliance keys — one clean, fast desk built for how the new generation actually moves money.
        </p>

        {/* Floating Tab Switcher Pill Dock (Screenshot 3 & 4) */}
        <div className="glass-pill rounded-full p-1.5 flex items-center gap-1 sm:gap-2 shadow-2xl border border-white/20 bg-black/40 backdrop-blur-2xl">
          <button
            onClick={() => setActiveTab('TRADE')}
            className={`px-4 sm:px-6 py-2 rounded-full text-xs sm:text-sm font-syne font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'TRADE'
                ? 'bg-white text-black shadow-lg scale-105'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>TRADE</span>
          </button>

          <button
            onClick={() => setActiveTab('SHIELD')}
            className={`px-4 sm:px-6 py-2 rounded-full text-xs sm:text-sm font-syne font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'SHIELD'
                ? 'bg-white text-black shadow-lg scale-105'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>SHIELD</span>
          </button>

          <button
            onClick={() => setActiveTab('STEALTH')}
            className={`px-4 sm:px-6 py-2 rounded-full text-xs sm:text-sm font-syne font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'STEALTH'
                ? 'bg-white text-black shadow-lg scale-105'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>STEALTH</span>
          </button>

          <button
            onClick={() => setActiveTab('COLLECT')}
            className={`px-4 sm:px-6 py-2 rounded-full text-xs sm:text-sm font-syne font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'COLLECT'
                ? 'bg-white text-black shadow-lg scale-105'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>COLLECT</span>
          </button>
        </div>

        {/* Live Interactive Desk Simulator Card */}
        <div className="w-full max-w-3xl glass-card-amber rounded-3xl p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)] border border-[#C45B2C]/40 text-left transition-all relative overflow-hidden">
          
          {/* Active Tab 1: TRADE & PERPS */}
          {activeTab === 'TRADE' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#C45B2C]/20 border border-[#C45B2C]/40 flex items-center justify-center text-[#F08A3C]">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base sm:text-lg font-syne font-bold text-white flex items-center gap-2">
                      <span>STRK-PERP</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        +14.82%
                      </span>
                    </div>
                    <div className="text-xs font-mono text-zinc-400">Zero-Knowledge Settlement // 0-Slippage</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-bold text-[#FBF7F4]">$1.428 STRK</div>
                  <div className="text-[10px] font-mono text-zinc-500">24H VOL $8.4M</div>
                </div>
              </div>

              {/* Leverage Slider */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-zinc-300">
                  <span>CONFIDENTIAL LEVERAGE</span>
                  <span className="font-bold text-[#F08A3C]">{leverage}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full accent-[#F08A3C] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>1x Spot</span>
                  <span>25x</span>
                  <span>50x</span>
                  <span>100x Degen</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <Link
                  href="/app"
                  className="py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-syne font-black text-sm text-center transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <span>Private Long STRK</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/app"
                  className="py-3 rounded-2xl bg-rose-500 hover:bg-rose-400 text-white font-syne font-black text-sm text-center transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <span>Private Short STRK</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}

          {/* Active Tab 2: SHIELD & SWAP */}
          {activeTab === 'SHIELD' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-violet-300">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base sm:text-lg font-syne font-bold text-white">Confidential Note Pool</div>
                    <div className="text-xs font-mono text-zinc-400">Garaga Groth16 Snark Proof Verifier</div>
                  </div>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/30">
                  100% UNLINKABLE
                </span>
              </div>

              <div className="p-4 rounded-2xl bg-black/40 border border-zinc-800 space-y-3 font-mono text-xs text-zinc-300">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Deposit Asset:</span>
                  <span className="text-white font-bold">1,000 STRK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">UTXO Commitment:</span>
                  <span className="text-violet-300">0x7f4a...92b1 (Shielded)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Anonymity Set:</span>
                  <span className="text-emerald-400">4,812 Active Notes</span>
                </div>
              </div>

              <Link
                href="/app"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#C45B2C] to-[#F08A3C] text-black font-syne font-black text-sm text-center block transition-all shadow-lg hover:brightness-110"
              >
                Shield STRK into Confidential Pool ⚡
              </Link>
            </div>
          )}

          {/* Active Tab 3: STEALTH CASH */}
          {activeTab === 'STEALTH' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#F08A3C]/20 border border-[#F08A3C]/40 flex items-center justify-center text-[#F08A3C]">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base sm:text-lg font-syne font-bold text-white">Stealth Cash Generator</div>
                    <div className="text-xs font-mono text-zinc-400">One-time disposable burner pay links</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-mono text-zinc-400">Amount to send secretly:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={stealthAmount}
                    onChange={(e) => setStealthAmount(e.target.value)}
                    className="flex-1 bg-black/60 border border-zinc-700 rounded-xl px-4 py-2.5 font-mono text-white text-sm focus:outline-none focus:border-[#F08A3C]"
                  />
                  <span className="font-syne font-bold text-white px-3 py-2 bg-zinc-800 rounded-xl">STRK</span>
                </div>
              </div>

              {stealthCreated ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 font-mono text-xs">
                  <div className="text-emerald-300 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Stealth Burner Link Created!</span>
                  </div>
                  <div className="text-zinc-300 break-all bg-black/50 p-2 rounded border border-zinc-800">
                    https://orrange.cash/claim#key=0x8f2a...c914
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setStealthCreated(true)}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#D76A24] to-[#F08A3C] text-black font-syne font-black text-sm text-center block transition-all shadow-lg hover:brightness-110"
                >
                  Generate One-Time Stealth Link 🔗
                </button>
              )}
            </div>
          )}

          {/* Active Tab 4: COLLECT & KEYS */}
          {activeTab === 'COLLECT' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base sm:text-lg font-syne font-bold text-white">Selective Compliance Keys</div>
                    <div className="text-xs font-mono text-zinc-400">Prove solvency to auditors without doxxing history</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                <div className="p-3 rounded-xl bg-black/40 border border-zinc-800 space-y-1">
                  <div className="text-zinc-400 font-bold">VIEWING KEY</div>
                  <div className="text-zinc-500 text-[10px] break-all">vk_sn_08a7f1...e901</div>
                  <div className="text-[#F08A3C] text-[10px]">Read-only audit access</div>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-zinc-800 space-y-1">
                  <div className="text-zinc-400 font-bold">COMPLIANCE PASSPORT</div>
                  <div className="text-emerald-400 text-[10px]">OFAC &amp; Clean Funds Verified</div>
                  <div className="text-zinc-500 text-[10px]">Garaga Zero-Knowledge ZK-Pass</div>
                </div>
              </div>

              <Link
                href="/app"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#8F3F1F] via-[#C45B2C] to-[#F08A3C] text-white font-syne font-black text-sm text-center block transition-all shadow-lg hover:brightness-110"
              >
                Launch App &amp; Export Audit Keys
              </Link>
            </div>
          )}

        </div>

      </div>
    </section>
  );
};
