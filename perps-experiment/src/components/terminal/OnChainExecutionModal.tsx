'use client';

import React from 'react';
import { ShieldCheck, CheckCircle2, Loader2, ExternalLink, Copy, Check, X, Cpu } from 'lucide-react';

export interface ExecutionStep {
  title: string;
  desc: string;
  status: 'PENDING' | 'LOADING' | 'SUCCESS' | 'ERROR';
  hash?: string;
  explorerUrl?: string;
}

interface OnChainExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  steps: ExecutionStep[];
  txHash?: string;
  explorerUrl?: string;
}

export const OnChainExecutionModal: React.FC<OnChainExecutionModalProps> = ({
  isOpen,
  onClose,
  title,
  steps,
  txHash,
  explorerUrl,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isAllSuccess = steps.every((s) => s.status === 'SUCCESS');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121214] border border-[#27272a] rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-white font-sans">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#71717a] hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#a855f7]/10 border border-[#a855f7]/30 flex items-center justify-center text-[#a855f7]">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-xs text-[#a1a1aa]">Starknet Sepolia Zero-Knowledge Execution</p>
          </div>
        </div>

        {/* Steps Lifecycle */}
        <div className="space-y-4 my-6">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-xl border transition-all ${
                step.status === 'LOADING'
                  ? 'bg-[#18181b] border-[#a855f7]/40 ring-1 ring-[#a855f7]/20'
                  : step.status === 'SUCCESS'
                  ? 'bg-[#18181b]/60 border-emerald-500/30'
                  : 'bg-[#18181b]/30 border-[#27272a]/50 text-[#71717a]'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {step.status === 'LOADING' && (
                    <Loader2 className="w-4 h-4 text-[#a855f7] animate-spin" />
                  )}
                  {step.status === 'SUCCESS' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {step.status === 'PENDING' && (
                    <div className="w-4 h-4 rounded-full border border-[#3f3f46] flex items-center justify-center text-[10px]">
                      {idx + 1}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{step.title}</span>
                    {step.status === 'SUCCESS' && (
                      <span className="text-[10px] text-emerald-400 font-mono">Verified</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#a1a1aa] mt-0.5">{step.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* On-Chain Transaction Explorer Card */}
        {txHash && (
          <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl mb-5 text-xs">
            <div className="flex items-center justify-between text-[#71717a] mb-1.5">
              <span>Starknet Transaction Hash:</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[#a855f7] hover:text-[#c084fc] transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="font-mono text-[11px] text-white truncate bg-[#09090b] p-1.5 rounded border border-[#27272a]">
              {txHash}
            </p>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-white font-medium text-xs transition-colors"
              >
                <span>View on Voyager Sepolia Explorer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Done / Dismiss Button */}
        <button
          onClick={onClose}
          disabled={!isAllSuccess && steps.some((s) => s.status === 'LOADING')}
          className={`w-full py-2.5 rounded-xl font-semibold text-xs transition-all ${
            isAllSuccess
              ? 'bg-[#a855f7] hover:bg-[#9333ea] text-white shadow-lg shadow-[#a855f7]/25'
              : 'bg-[#27272a] text-[#a1a1aa] cursor-not-allowed'
          }`}
        >
          {isAllSuccess ? 'Done & Return to Terminal' : 'Processing On-Chain...'}
        </button>
      </div>
    </div>
  );
};
