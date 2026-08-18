'use client';

import React from 'react';
import { Activity, ShieldCheck, Cpu, Database } from 'lucide-react';
import { useNetwork } from '@/context/NetworkContext';

export const PoolMetrics: React.FC = () => {
  const { currentNetwork, isSepolia } = useNetwork();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6 font-mono text-xs">
      {/* Metric 1: Pool Status */}
      <div className="p-3 bg-zinc-950 border border-zinc-800/90 corner-box flex items-center gap-2.5">
        <div className={`p-1.5 border ${isSepolia ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-orrange-500/30 bg-orrange-500/10 text-orrange-400'}`}>
          <Activity className="w-3.5 h-3.5" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <span className={`w-1 h-1 rounded-full ${isSepolia ? 'bg-amber-400' : 'bg-orrange-500'} animate-pulse`} />
            <span className="text-[10px] text-zinc-500 uppercase">Pool Status</span>
          </div>
          <p className={`text-xs font-bold ${isSepolia ? 'text-amber-300' : 'text-orrange-400'}`}>
            {currentNetwork.label} Active
          </p>
        </div>
      </div>

      {/* Metric 2: Stwo ZK Verifier */}
      <div className="p-3 bg-zinc-950 border border-zinc-800/90 corner-box flex items-center gap-2.5">
        <div className="p-1.5 border border-purple-500/30 bg-purple-500/10 text-purple-400">
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <div>
          <span className="text-[10px] text-zinc-500 uppercase">Stwo Prover</span>
          <p className="text-xs font-bold text-purple-300">Cairo STARKs</p>
        </div>
      </div>

      {/* Metric 3: FPI Screening */}
      <div className="p-3 bg-zinc-950 border border-zinc-800/90 corner-box flex items-center gap-2.5">
        <div className="p-1.5 border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
        </div>
        <div>
          <span className="text-[10px] text-zinc-500 uppercase">FPI Screening</span>
          <p className="text-xs font-bold text-emerald-300">Clean Substrate</p>
        </div>
      </div>

      {/* Metric 4: Relayer / Paymaster */}
      <div className="p-3 bg-zinc-950 border border-zinc-800/90 corner-box flex items-center gap-2.5">
        <div className="p-1.5 border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <Database className="w-3.5 h-3.5" />
        </div>
        <div>
          <span className="text-[10px] text-zinc-500 uppercase">1-Click Relay</span>
          <p className="text-xs font-bold text-amber-300">Session Keys</p>
        </div>
      </div>
    </div>
  );
};
