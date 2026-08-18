'use client';

import React from 'react';
import { 
  Shield, 
  Layers, 
  TrendingUp, 
  Sparkles, 
  Cpu, 
  FileCheck2, 
  Activity,
  ArrowUpRight
} from 'lucide-react';

const PROTOCOL_ENGINES = [
  {
    name: 'STRK20 Shielded Pool',
    desc: 'Encrypted UTXO Notes & Nullifiers',
    tag: 'SUBSTRATE',
    icon: Shield,
  },
  {
    name: 'AVNU Intent Router',
    desc: 'Cost-Optimized Private Aggregation',
    tag: 'ROUTING',
    icon: Layers,
  },
  {
    name: 'Paradex ZK Perps',
    desc: 'Private Positions & Margin Proofs',
    tag: 'DERIVATIVES',
    icon: TrendingUp,
  },
  {
    name: 'Vesu Yield Vaults',
    desc: 'Shielded Overcollateralized Lending',
    tag: 'EARN',
    icon: Sparkles,
  },
  {
    name: 'Stwo Prover Engine',
    desc: 'Cairo v2 STARK Circle Proofs',
    tag: 'CRYPTO',
    icon: Cpu,
  },
  {
    name: 'Selective Disclosure',
    desc: 'Zero-Knowledge Compliance Passports',
    tag: 'AUDIT',
    icon: FileCheck2,
  },
];

export const MoatArchitectureSection: React.FC = () => {
  return (
    <div className="py-20 border-t border-zinc-800/80">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left Manifesto Text */}
        <div className="lg:col-span-5 space-y-8">
          <div className="space-y-3">
            <div className="text-[11px] font-mono text-orrange-500 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orrange-500 animate-pulse" />
              <span>[ THESIS_STATEMENT // 03 ]</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight uppercase">
              Confidentiality is the only <br />
              <span className="text-orrange-500 terminal-glow">moat left</span>
            </h2>
          </div>

          <div className="space-y-6 pt-2 font-mono text-xs text-zinc-300">
            <div className="flex items-start gap-4 p-3 rounded bg-zinc-950/60 border border-zinc-900">
              <span className="text-orrange-500 font-bold">01</span>
              <p className="leading-relaxed">
                AI agents, MEV bots, and solvers are actively profiling every transparent transaction on-chain.
              </p>
            </div>

            <div className="flex items-start gap-4 p-3 rounded bg-zinc-950/60 border border-zinc-900">
              <span className="text-orrange-500 font-bold">02</span>
              <p className="leading-relaxed">
                Financial alpha, strategic leverage, and institutional relationships collapse on completely public ledgers.
              </p>
            </div>

            <div className="flex items-start gap-4 p-3 rounded bg-zinc-950/60 border border-zinc-900">
              <span className="text-orrange-500 font-bold">03</span>
              <p className="leading-relaxed">
                Intent-driven, verifiable private execution becomes the permanent, compounding moat of Web3 finance.
              </p>
            </div>
          </div>
        </div>

        {/* Right Architecture Matrix Card */}
        <div className="lg:col-span-7">
          <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-none corner-box shadow-2xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-white">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-zinc-400">APP.LAYER //</span>
                <span className="text-orrange-500">ORRANGE ARCHITECTURE</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">[ STARKNET_NATIVE ]</span>
            </div>

            {/* 6 Sub-System Module Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PROTOCOL_ENGINES.map((engine) => {
                const Icon = engine.icon;
                return (
                  <div
                    key={engine.name}
                    className="p-3.5 rounded bg-zinc-900/60 border border-zinc-800/80 hover:border-orrange-500/50 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-orrange-400">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          {engine.tag}
                        </span>
                      </div>
                      <div className="font-mono font-bold text-xs text-white">{engine.name}</div>
                      <p className="font-mono text-[10px] text-zinc-400 mt-1">{engine.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Convergence Zone Slider Bar */}
            <div className="pt-3 border-t border-zinc-900 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 uppercase">
                <span>Apps Proliferating</span>
                <span className="text-orrange-500 font-bold">Convergence Zone</span>
                <span>Alpha Accumulates</span>
              </div>
              <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden flex">
                <div className="w-1/3 bg-zinc-700" />
                <div className="w-1/3 bg-gradient-to-r from-orrange-500 to-amber-400" />
                <div className="w-1/3 bg-emerald-500" />
              </div>
            </div>

            {/* Uptime Status Footer */}
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 pt-2">
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                ALL SYSTEMS NOMINAL
              </span>
              <span>99.99% PROVING UPTIME</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
