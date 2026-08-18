'use client';

import React, { useState } from 'react';
import { Eye, ShieldAlert, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react';

interface SectorItem {
  id: string;
  tag: string;
  number: string;
  title: string;
  description: string;
  icon: any;
  highlightColor: string;
}

const SECTORS: SectorItem[] = [
  {
    id: 'sector-01',
    tag: 'FRAGMENTATION',
    number: '01',
    title: 'Public Balances & Profiling',
    description: 'Every token balance, counterparty interaction, and historical trading strategy is permanently indexed and publicly visible on block explorers.',
    icon: Eye,
    highlightColor: 'border-rose-500/40 text-rose-400',
  },
  {
    id: 'sector-02',
    tag: 'EXPLOITATION',
    number: '02',
    title: 'Toxic MEV & Adverse Solvers',
    description: 'Transparent intent flow and public mempools allow adversarial arbitrageurs to front-run, sandwich, and extract alpha from large executions.',
    icon: ShieldAlert,
    highlightColor: 'border-amber-500/40 text-amber-400',
  },
  {
    id: 'sector-03',
    tag: 'SOLUTION',
    number: '03',
    title: 'orrange Private Execution Layer',
    description: 'Combines STRK20 shielded UTXO substrate with intent routing, private perpetuals, and zero-knowledge compliance proofs over a unified terminal.',
    icon: ShieldCheck,
    highlightColor: 'border-orrange-500 text-orrange-400',
  },
];

interface ProblemSectorCardsProps {
  onLaunchTerminal: () => void;
}

export const ProblemSectorCards: React.FC<ProblemSectorCardsProps> = ({ onLaunchTerminal }) => {
  const [activeSector, setActiveSector] = useState<string>('sector-03');

  return (
    <div className="py-20 border-t border-zinc-800/80">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left Headline */}
        <div className="lg:col-span-5 space-y-4 sticky top-24">
          <div className="text-[11px] font-mono text-orrange-500 uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orrange-500 animate-pulse" />
            <span>[ SECTOR_DIAGNOSTICS // V0.2 ]</span>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight uppercase">
            Onchain Finance Is <br />
            <span className="text-orrange-500 terminal-glow">Still Exposed</span>
          </h2>

          <p className="text-sm font-mono text-zinc-400 leading-relaxed">
            Public blockchains make auditing trivial, but they turn privacy into a luxury. 
            Alpha, leverage, and counterparty relationships collapse under total transparency.
          </p>

          <div className="pt-2">
            <button
              onClick={onLaunchTerminal}
              className="px-5 py-2.5 rounded-none border border-orrange-500 bg-orrange-500/10 hover:bg-orrange-500 hover:text-black text-orrange-400 font-mono text-xs font-bold tracking-wider uppercase transition-all flex items-center gap-2 corner-box group"
            >
              <span>Explore orrange Engine</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>

        {/* Right Stacked Sector Cards */}
        <div className="lg:col-span-7 space-y-4">
          {SECTORS.map((sector) => {
            const isSelected = activeSector === sector.id;
            const Icon = sector.icon;

            return (
              <div
                key={sector.id}
                onClick={() => setActiveSector(sector.id)}
                className={`p-6 bg-zinc-950 border transition-all duration-300 cursor-pointer corner-box ${
                  isSelected
                    ? 'border-orrange-500 shadow-2xl shadow-orrange-950/40 bg-zinc-900/80 scale-[1.01]'
                    : 'border-zinc-800/80 hover:border-zinc-700 bg-zinc-950/60'
                }`}
              >
                {/* Header Tag Bar */}
                <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
                  <div className="flex items-center gap-2 text-[11px] font-mono font-bold tracking-wider text-orrange-500">
                    <span>◆</span>
                    <span>{sector.tag}</span>
                  </div>
                  <div className="text-[11px] font-mono px-2 py-0.5 border border-zinc-800 bg-zinc-900 text-zinc-400 font-bold">
                    {sector.number}
                  </div>
                </div>

                {/* Body Content */}
                <div className="pt-4">
                  <div className="flex items-start gap-3.5">
                    <div className={`p-2.5 rounded border ${sector.highlightColor} bg-zinc-900/50 shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white font-mono">{sector.title}</h3>
                      <p className="text-xs font-mono text-zinc-400 mt-2 leading-relaxed">
                        {sector.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Subtext indicator */}
                <div className="mt-4 pt-3 border-t border-zinc-900/80 flex items-center justify-between text-[10px] font-mono text-zinc-600">
                  <span>SECTOR_ID: {sector.id.toUpperCase()}</span>
                  <span className={isSelected ? 'text-orrange-500 font-bold' : ''}>
                    {isSelected ? '● ACTIVE_LAYER' : 'INSPECT'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
