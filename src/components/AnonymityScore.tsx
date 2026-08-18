'use client';

import React from 'react';
import { ShieldCheck, ShieldAlert, Sparkles, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { ShieldedBalance } from '@/services/privacyService';

interface AnonymityScoreProps {
  balances: ShieldedBalance[];
}

export const AnonymityScore: React.FC<AnonymityScoreProps> = ({ balances }) => {
  let totalPublicCount = 0;
  let totalShieldedCount = 0;

  balances.forEach((b) => {
    if (b.publicBalance > 0n) totalPublicCount++;
    if (b.shieldedBalance > 0n) totalShieldedCount++;
  });

  const hasShielded = totalShieldedCount > 0;

  return (
    <div className="p-4 bg-zinc-950 border border-zinc-800 corner-box mb-6 font-mono">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-900">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 border ${
            hasShielded 
              ? 'bg-orrange-500/10 border-orrange-500/30 text-orrange-400' 
              : 'bg-zinc-900 border-zinc-800 text-zinc-400'
          }`}>
            {hasShielded ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Privacy Set & Anonymity</h3>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                hasShielded
                  ? 'bg-orrange-950/60 border-orrange-500/40 text-orrange-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}>
                {hasShielded ? '● SHIELD_ENGAGED' : 'EXPOSED'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {hasShielded 
                ? 'Your private capital is encrypted inside the STRK20 UTXO pool'
                : 'Deposit tokens into the pool to activate confidential execution'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="text-right">
            <span className="text-zinc-600 text-[9px] uppercase">Shielded Assets</span>
            <div className="text-orrange-400 font-bold">{totalShieldedCount} Tokens</div>
          </div>
          <div className="w-px h-6 bg-zinc-800" />
          <div className="text-right">
            <span className="text-zinc-600 text-[9px] uppercase">Public Assets</span>
            <div className="text-zinc-400 font-bold">{totalPublicCount} Tokens</div>
          </div>
        </div>
      </div>

      {/* Privacy Best Practice Tips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-3 text-[10px] text-zinc-400">
        <div className="p-2 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-orrange-400 font-bold mr-1">◆ ZERO TRAIL:</span>
          <span>Private transfers leave no on-chain event breadcrumbs.</span>
        </div>
        <div className="p-2 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-amber-400 font-bold mr-1">◆ MATURITY:</span>
          <span>Notes mature after ~10 blocks for maximum entropy.</span>
        </div>
        <div className="p-2 bg-zinc-900/50 border border-zinc-800/80">
          <span className="text-emerald-400 font-bold mr-1">◆ SESSION:</span>
          <span>1-Click keys eliminate repeated wallet signature leaks.</span>
        </div>
      </div>
    </div>
  );
};
