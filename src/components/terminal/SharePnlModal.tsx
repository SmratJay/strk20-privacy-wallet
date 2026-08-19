'use client';

import React, { useState } from 'react';
import { ShieldCheck, Copy, Check, X, Download, Share2, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { PerpPosition, PerpMarket } from '@/services/perpsService';

interface SharePnlModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: PerpPosition | null;
  market: PerpMarket;
}

export const SharePnlModal: React.FC<SharePnlModalProps> = ({
  isOpen,
  onClose,
  position,
  market,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !position) return null;

  const isProfit = position.unrealizedPnlUsd >= 0;
  const pnlPct = position.pnlPercentage;

  const handleShare = () => {
    const text = `🔥 Just made ${isProfit ? '+' : ''}${pnlPct.toFixed(2)}% on ${position.marketId} (${position.leverage}x ${position.side}) with 100% Zero-Knowledge Privacy on Starknet! 🛡️⚡\n\nTrade private perpetuals with zero MEV or wallet leakage: strk20.app`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="bg-[#121214] border border-[#27272a] rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-white">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#71717a] hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs font-semibold text-[#a855f7] mb-3">
          <Sparkles className="w-4 h-4" />
          <span>Share Performance Card</span>
        </div>

        {/* The Graphic PnL Card */}
        <div
          id="pnl-share-card"
          className="relative overflow-hidden rounded-2xl p-6 border border-[#3f3f46]/50 bg-gradient-to-br from-[#18181b] via-[#121214] to-[#09090b] shadow-2xl"
        >
          {/* Subtle Ambient Glow */}
          <div
            className={`absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl pointer-events-none ${
              isProfit ? 'bg-emerald-500/20' : 'bg-rose-500/20'
            }`}
          />

          {/* Header */}
          <div className="flex items-center justify-between relative z-10 mb-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#27272a] border border-[#3f3f46] flex items-center justify-center font-bold text-xs text-white">
                {position.marketId.split('-')[0]}
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">{position.marketId}</h4>
                <div className="flex items-center gap-1 text-[11px] font-semibold">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      position.side === 'LONG'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {position.side} {position.leverage}x
                  </span>
                  <span className="text-[#71717a]">•</span>
                  <span className="text-[#a1a1aa] font-mono">SNIP-36 Cairo STARK</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" />
              <span>Shielded</span>
            </div>
          </div>

          {/* Large PnL Percentage */}
          <div className="my-4 relative z-10">
            <div className="text-[11px] text-[#a1a1aa] uppercase font-semibold tracking-wider mb-1">
              Realized / Unrealized ROI
            </div>
            <div
              className={`text-4xl font-extrabold font-mono tracking-tight ${
                isProfit ? 'text-[#10b981] drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]' : 'text-rose-400'
              }`}
            >
              {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
            </div>
            <div className="text-sm font-semibold text-[#a1a1aa] mt-1 font-mono">
              {isProfit ? '+' : ''}${position.unrealizedPnlUsd.toFixed(2)} USD
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 py-3 border-t border-[#27272a] relative z-10 text-xs font-mono">
            <div>
              <span className="text-[10px] text-[#71717a] block uppercase">Entry Price</span>
              <span className="font-semibold text-white">${position.entryPrice.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#71717a] block uppercase">Mark Price</span>
              <span className="font-semibold text-white">${market.markPrice.toFixed(2)}</span>
            </div>
          </div>

          {/* Footer Branding */}
          <div className="pt-3 border-t border-[#27272a] flex items-center justify-between text-[10px] text-[#71717a] relative z-10">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-white tracking-wider">PEL PERPETUALS</span>
              <span>• Starknet Sepolia</span>
            </div>
            <span className="font-mono text-[#52525b]">C_t: {position.zkCommitment.slice(0, 8)}...</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            onClick={handleShare}
            className="py-2.5 px-4 rounded-xl bg-[#a855f7] hover:bg-[#9333ea] text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-lg shadow-[#a855f7]/25"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied to Clipboard!' : 'Copy Tweet / Text'}</span>
          </button>
          <button
            onClick={onClose}
            className="py-2.5 px-4 rounded-xl bg-[#27272a] hover:bg-[#3f3f46] text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Close</span>
          </button>
        </div>
      </div>
    </div>
  );
};
