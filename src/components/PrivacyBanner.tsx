'use client';

import React from 'react';
import { Lock, EyeOff, ShieldCheck, Zap, Info } from 'lucide-react';
import { NOTE_MATURITY_BLOCKS, DEFAULT_POOL_FEE_STRK } from '@/config/tokens';

export const PrivacyBanner: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      {/* Card 1: UTXO Model */}
      <div className="p-4 rounded-2xl bg-surface border border-surface-border flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <EyeOff className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">UTXO Encrypted Notes</h4>
          <p className="text-xs text-zinc-400 mt-0.5">
            Sender, recipient, token, & amount are encrypted inside pool storage.
          </p>
        </div>
      </div>

      {/* Card 2: Gas & Paymaster */}
      <div className="p-4 rounded-2xl bg-surface border border-surface-border flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Gas-Free Relay</h4>
          <p className="text-xs text-zinc-400 mt-0.5">
            Pool-mediated withdrawals & sponsored paymasters decouple transaction senders.
          </p>
        </div>
      </div>

      {/* Card 3: Note Protocol Parameters */}
      <div className="p-4 rounded-2xl bg-surface border border-surface-border flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">On-Chain Verified</h4>
          <p className="text-xs text-zinc-400 mt-0.5">
            FPI deposit screening & Stwo zero-knowledge STARK proofs verified in-protocol.
          </p>
        </div>
      </div>
    </div>
  );
};
