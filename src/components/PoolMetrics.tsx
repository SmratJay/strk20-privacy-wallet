'use client';

import React from 'react';
import { Activity, ShieldCheck, Cpu, Database } from 'lucide-react';
import { useNetwork } from '@/context/NetworkContext';

export const PoolMetrics: React.FC = () => {
  const { currentNetwork, isSepolia } = useNetwork();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {/* Metric 1: Pool Status */}
      <div className="p-3.5 rounded-xl bg-surface border border-surface-border flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isSepolia ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
          <Activity className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isSepolia ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
            <span className="text-[11px] font-semibold text-zinc-300">STRK20 Pool</span>
          </div>
          <p className={`text-xs font-mono font-bold mt-0.5 ${isSepolia ? 'text-amber-300' : 'text-white'}`}>
            {currentNetwork.label} Active
          </p>
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
