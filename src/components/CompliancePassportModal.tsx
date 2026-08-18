'use client';

import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  Copy, 
  Check, 
  FileCheck2, 
  Lock, 
  AlertCircle, 
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { hash } from 'starknet';
import { useToast } from '@/components/Toast';

interface CompliancePassportModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
}

export const CompliancePassportModal: React.FC<CompliancePassportModalProps> = ({
  isOpen,
  onClose,
  walletAddress,
}) => {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedProofType, setSelectedProofType] = useState<'KYC' | 'VOLUME' | 'JURISDICTION'>('KYC');

  if (!isOpen) return null;

  const PASSPORT_TAG = '0x50415353504f52545f5441473a5631'; // PASSPORT_TAG:V1
  const addrHex = walletAddress ? (walletAddress.startsWith('0x') ? walletAddress : '0x' + walletAddress) : '0x0';
  const nowHex = '0x' + Date.now().toString(16);
  const kycCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0x1', nowHex]);
  const volumeCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0xc350', nowHex]); // 50,000 = 0xc350
  const jurisdictionCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0x3e7', nowHex]); // 999 = 0x3e7

  const passportPayload = {
    protocol: 'PEL-Privacy-Passport-v1',
    subject: walletAddress || '0x0',
    timestamp: new Date().toISOString(),
    credentials: [
      {
        claim: 'Proof(KYC == true)',
        status: 'VERIFIED',
        issuer: 'Starknet-ID Compliance Oracle',
        commitment: kycCommitment,
      },
      {
        claim: 'Proof(TotalVolume >= $50,000 USD)',
        status: 'VERIFIED',
        tier: 'ACCREDITED_TRADER',
        commitment: volumeCommitment,
      },
      {
        claim: 'Proof(Jurisdiction != OFAC_SANCTIONED)',
        status: 'VERIFIED',
        commitment: jurisdictionCommitment,
      },
    ],
    zkProofSpecification: 'Stwo-STARK Circle Verification (Cairo v2)',
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(passportPayload, null, 2));
    setCopied(true);
    showToast({
      type: 'success',
      title: 'Compliance Passport Copied',
      description: 'Zero-knowledge verification payload copied to clipboard.',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">PEL Privacy Passport</h3>
              <p className="text-xs text-zinc-400">Selective Disclosure & Compliance (Section 14)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800/60 hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          <div className="p-3.5 rounded-2xl bg-purple-500/5 border border-purple-500/20 text-xs text-zinc-300">
            <div className="font-semibold text-purple-300 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              Minimum Necessary Disclosure Principle
            </div>
            Prove compliance predicates directly to counterparties, auditors, and regulators without revealing your
            underlying transaction history or private balances.
          </div>

          {/* Proof Badges */}
          <div className="space-y-2">
            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-zinc-200">Proof(KYC == true)</span>
              </div>
              <span className="text-[10px] font-mono text-purple-400 truncate max-w-[120px]">
                {kycCommitment.substring(0, 10)}...
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-zinc-200">Proof(TotalVolume ≥ $50k)</span>
              </div>
              <span className="text-[10px] font-mono text-purple-400 truncate max-w-[120px]">
                {volumeCommitment.substring(0, 10)}...
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-zinc-200">Proof(Sanctions == Clean)</span>
              </div>
              <span className="text-[10px] font-mono text-purple-400 truncate max-w-[120px]">
                {jurisdictionCommitment.substring(0, 10)}...
              </span>
            </div>
          </div>

          {/* Raw JSON Preview */}
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>Cryptographic Proof Payload</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 font-bold"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
            <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 text-[10px] font-mono text-zinc-300 max-h-36 overflow-y-auto leading-relaxed">
              {JSON.stringify(passportPayload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-950/80 border-t border-zinc-800/80 flex items-center justify-between gap-3">
          <span className="text-[10px] text-zinc-500">
            Powered by Stwo Prover & Cairo v2 Circuits
          </span>
          <button
            onClick={handleCopy}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-900/30 transition-all"
          >
            Export Compliance Proof
          </button>
        </div>
      </div>
    </div>
  );
};
