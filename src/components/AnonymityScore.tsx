'use client';

import React from 'react';
import { ShieldCheck, ShieldAlert, Sparkles, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { ShieldedBalance } from '@/services/privacyService';

interface AnonymityScoreProps {
  balances: ShieldedBalance[];
}

export const AnonymityScore: React.FC<AnonymityScoreProps> = ({ balances }) => {
  // Calculate total shielded vs total balance ratio
  let totalPublicCount = 0;
  let totalShieldedCount = 0;

  balances.forEach((b) => {
    if (b.publicBalance > 0n) totalPublicCount++;
    if (b.shieldedBalance > 0n) totalShieldedCount++;
  });

  const hasShielded = totalShieldedCount > 0;
  const isOptimal = hasShielded && totalShieldedCount >= totalPublicCount;

  return (
    <div className="p-4 rounded-2xl bg-surface border border-surface-border mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl border ${
            hasShielded 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>
            {hasShielded ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">Privacy Health & Shield Status</h3>
              <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                hasShielded
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              }`}>
                {hasShielded ? 'Shield Active' : 'Unshielded Assets'}
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              {hasShielded 
                ? 'Your private funds are encrypted inside the STRK20 UTXO pool'
                : 'Deposit tokens into the pool to activate confidential transfers'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <span className="text-zinc-500 text-[10px] uppercase">Shielded Assets</span>
            <div className="text-emerald-400 font-bold">{totalShieldedCount} Tokens</div>
          </div>
          <div className="w-px h-7 bg-surface-border" />
          <div className="text-right">
            <span className="text-zinc-500 text-[10px] uppercase">Public Assets</span>
            <div className="text-zinc-300 font-bold">{totalPublicCount} Tokens</div>
          </div>
        </div>
      </div>

      {/* Privacy Best Practice Tips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-3 text-[11px] text-zinc-300">
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-elevated/60 border border-surface-border">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span><strong>Zero Public Trail:</strong> Private transfers and discovery leave no on-chain event breadcrumbs.</span>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-elevated/60 border border-surface-border">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span><strong>Note Maturity:</strong> Freshly shielded notes mature after ~10 blocks for maximum unlinkability.</span>
        </div>
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-elevated/60 border border-surface-border">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span><strong>Timing Tip:</strong> Avoid immediate in-and-out withdrawals to preserve optimal anonymity set.</span>
        </div>
      </div>
    </div>
  );
};
