'use client';

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Lock, 
  Cpu, 
  CheckCircle2, 
  ExternalLink, 
  Copy, 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Layers,
  Sparkles
} from 'lucide-react';
import { PerpPosition, PerpMarket } from '@/services/perpsService';
import { shortenAddress } from '@/utils/formatters';
import { useToast } from '@/components/Toast';

interface DualViewInspectorProps {
  position: PerpPosition;
  market: PerpMarket;
  onClose?: () => void;
}

export const DualViewInspector: React.FC<DualViewInspectorProps> = ({ position, market, onClose }) => {
  const { showToast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    showToast({
      type: 'success',
      title: `${label} Copied`,
      description: 'Copied cryptographic proof artifact to clipboard.',
    });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isProfit = position.unrealizedPnlUsd >= 0;

  return (
    <div className="bg-zinc-950 border border-orrange-500/50 p-5 corner-box space-y-6 font-mono text-xs shadow-2xl">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Dual-View Cryptographic Verifier</span>
              <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 border border-purple-500/30">
                SNIP-36 STARK
              </span>
            </h3>
            <p className="text-[10px] text-zinc-500 uppercase">
              Whitepaper Section 28 Demonstration: Private Trader Witness vs Public Explorer State
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white uppercase font-bold text-[10px]"
          >
            Close Inspector
          </button>
        )}
      </div>

      {/* Side-by-Side Dual Matrix Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ========================================================
            LEFT COLUMN: TRADER PRIVATE VIEW (Decrypted Witness)
           ======================================================== */}
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-4 relative">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-emerald-400 font-bold uppercase">
              <Eye className="w-4 h-4" />
              <span>Trader Private View (Decrypted Witness)</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
              OWNER KEY
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Market & Side:</span>
              <span className="font-bold text-white flex items-center gap-1">
                {position.side === 'LONG' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                )}
                {position.marketId} {position.side} ({position.leverage}x)
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Position Size (q):</span>
              <span className="font-bold text-zinc-200">
                {position.sizeTokens} {market.baseAsset} (${position.notionalUsd.toLocaleString()})
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Private Entry Price (e):</span>
              <span className="font-bold text-white">
                ${position.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Collateral Margin (m):</span>
              <span className="font-bold text-emerald-300">
                ${position.marginUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Unrealized PnL:</span>
              <span className={`font-black text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isProfit ? '+' : ''}${position.unrealizedPnlUsd.toFixed(2)} ({isProfit ? '+' : ''}{position.pnlPercentage}%)
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Liquidation Threshold (Plik):</span>
              <span className="font-bold text-amber-400">
                ${position.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400">
            <span className="text-emerald-400 font-bold uppercase block mb-1">Confidentiality Guarantee:</span>
            Only the holder of the account private viewing key can decrypt and view these position witness attributes.
          </div>
        </div>

        {/* ========================================================
            RIGHT COLUMN: PUBLIC EXPLORER VIEW (Observer State)
           ======================================================== */}
        <div className="p-4 bg-zinc-900/60 border border-orrange-500/40 space-y-4 relative">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-orrange-400 font-bold uppercase">
              <Lock className="w-4 h-4" />
              <span>Public Block Explorer View (Observer)</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 bg-orrange-500/10 text-orrange-400 border border-orrange-500/30 font-bold">
              VOYAGER LEDGER
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1 py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase block text-[10px]">State Commitment (Ct):</span>
              <div className="flex items-center justify-between text-zinc-300 font-mono">
                <span className="truncate">{position.zkCommitment}</span>
                <button
                  onClick={() => handleCopy(position.zkCommitment, 'Commitment')}
                  className="text-orrange-400 hover:underline ml-2 text-[10px] uppercase font-bold shrink-0"
                >
                  {copiedKey === 'Commitment' ? '[COPIED]' : '[COPY]'}
                </button>
              </div>
            </div>

            <div className="space-y-1 py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase block text-[10px]">Consumed Nullifier (NF):</span>
              <div className="flex items-center justify-between text-zinc-300 font-mono">
                <span className="truncate">{position.nullifier || '0x4e554c4c...'}</span>
                <button
                  onClick={() => handleCopy(position.nullifier || '', 'Nullifier')}
                  className="text-orrange-400 hover:underline ml-2 text-[10px] uppercase font-bold shrink-0"
                >
                  {copiedKey === 'Nullifier' ? '[COPIED]' : '[COPY]'}
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">STARK Proof Status:</span>
              <span className="font-bold text-purple-300 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                STARK_VALID [SNIP-36]
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Public Oracle (Pt):</span>
              <span className="font-bold text-white">
                ${market.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Pragma Median)
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Position Size:</span>
              <span className="px-2 py-0.5 bg-zinc-950 border border-zinc-800 text-zinc-500 font-bold uppercase">
                [ PROTECTED / PRIVATE ]
              </span>
            </div>

            <div className="flex justify-between items-center py-1 border-b border-zinc-900">
              <span className="text-zinc-500 uppercase">Margin & PnL:</span>
              <span className="px-2 py-0.5 bg-zinc-950 border border-zinc-800 text-zinc-500 font-bold uppercase">
                [ HIDDEN WITNESS ]
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400">
            <span className="text-orrange-400 font-bold uppercase block mb-1">Zero-Knowledge Guarantee:</span>
            Observers and MEV bots see only cryptographic commitments and valid proof-facts. Zero trade parameters are leaked.
          </div>
        </div>
      </div>
    </div>
  );
};
