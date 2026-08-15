'use client';

import React from 'react';
import { Activity, ShieldCheck, Cpu, Database, CheckCircle2 } from 'lucide-react';
import { STRK20_POOL_ADDRESS, CHAIN_ID } from '@/config/tokens';
import { shortenAddress } from '@/utils/formatters';

export const PoolMetrics: React.FC = () => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {/* Metric 1: Pool Status */}
      <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
          <Activity className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-zinc-300">STRK20 Pool</span>
          </div>
          <p className="text-xs font-mono font-bold text-white mt-0.5">{CHAIN_ID} Live</p>
        </div>
      </div>

      {/* Metric 2: Stwo ZK Verifier */}
      <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
          <Cpu className="w-4 h-4" />
        </div>
        <div>
          <span className="text-[11px] font-semibold text-zinc-300">Stwo Prover</span>
          <p className="text-xs font-mono font-bold text-purple-400 mt-0.5">STARK ZK Active</p>
        </div>
      </div>

      {/* Metric 3: FPI Screening */}
      <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <span className="text-[11px] font-semibold text-zinc-300">Deposit Screening</span>
          <p className="text-xs font-mono font-bold text-sky-400 mt-0.5">FPI Verified</p>
        </div>
      </div>

      {/* Metric 4: Relayer / Paymaster */}
      <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
          <Database className="w-4 h-4" />
        </div>
        <div>
          <span className="text-[11px] font-semibold text-zinc-300">Paymaster Relay</span>
          <p className="text-xs font-mono font-bold text-amber-400 mt-0.5">Gas Decoupled</p>
        </div>
      </div>
    </div>
  );
};
