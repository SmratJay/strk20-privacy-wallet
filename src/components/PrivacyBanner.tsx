'use client';

import React from 'react';
import { Lock, EyeOff, ShieldCheck, Zap, Cpu } from 'lucide-react';

export const PrivacyBanner: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 font-mono">
      {/* Card 1: UTXO Model */}
      <div className="p-3.5 bg-zinc-950 border border-zinc-800/90 corner-box flex items-start gap-3">
        <div className="p-2 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400 shrink-0">
          <EyeOff className="w-4 h-4" />
        </div>
        <div>
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">UTXO Encrypted Notes</h4>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
            Sender, recipient, token, & amount encrypted inside Poseidon note hashes.
          </p>
        </div>
      </div>

      {/* Card 2: Gas & Paymaster */}
      <div className="p-3.5 bg-zinc-950 border border-zinc-800/90 corner-box flex items-start gap-3">
        <div className="p-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
          <Zap className="w-4 h-4" />
        </div>
        <div>
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Gas-Free 1-Click Keys</h4>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
            Scoped ephemeral keys decouple execution from repetitive signature popups.
          </p>
        </div>
      </div>

      {/* Card 3: Note Protocol Parameters */}
      <div className="p-3.5 bg-zinc-950 border border-zinc-800/90 corner-box flex items-start gap-3">
        <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
          <Cpu className="w-4 h-4" />
        </div>
        <div>
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Stwo STARK Proofs</h4>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
            FPI deposit screening & circle STARK proofs verified on Starknet L2.
          </p>
        </div>
      </div>
    </div>
  );
};
