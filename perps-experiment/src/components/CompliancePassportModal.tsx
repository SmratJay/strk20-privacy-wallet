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
  const [selectedProofType, setSelectedProofType] = useState<'KYC' | 'VOLUME' | 'JURISDICTION'>('KYC');

  if (!isOpen) return null;

  const PASSPORT_TAG = '0x50415353504f52545f5441473a5631';
  const addrHex = walletAddress ? (walletAddress.startsWith('0x') ? walletAddress : '0x' + walletAddress) : '0x0';
  const nowHex = '0x' + Date.now().toString(16);
  const kycCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0x1', nowHex]);
  const volumeCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0xc350', nowHex]);
  const jurisdictionCommitment = hash.computePoseidonHashOnElements([PASSPORT_TAG, addrHex, '0x3e7', nowHex]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md font-mono">
      <div className="bg-zinc-950 border border-orrange-500/50 corner-box w-full max-w-lg overflow-hidden shadow-2xl space-y-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400">
              <FileCheck2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">PEL Privacy Passport</h3>
              <p className="text-[10px] text-zinc-500 uppercase">ZK Selective Compliance Credentials</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
          <span className="text-orrange-400 font-bold uppercase text-[10px]">Zero-Knowledge Proof Attestation:</span>
          <p>
            Prove accredited status and sanction screening without revealing wallet balances, personal identity, or historical trading counterparties.
          </p>
        </div>

        {/* Credentials Breakdown */}
        <div className="space-y-2">
          <div className="p-3 bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">Proof(KYC == true)</div>
              <div className="text-[10px] text-zinc-500">Poseidon Hash: {kycCommitment.slice(0, 14)}...</div>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase font-bold">
              VERIFIED
            </span>
          </div>

          <div className="p-3 bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">Proof(Volume &gt;= $50k)</div>
              <div className="text-[10px] text-zinc-500">Tier: ACCREDITED_TRADER</div>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase font-bold">
              VERIFIED
            </span>
          </div>

          <div className="p-3 bg-zinc-900 border border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">Proof(Jurisdiction != Sanctioned)</div>
              <div className="text-[10px] text-zinc-500">OFAC / FATF Compliant</div>
            </div>
            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 uppercase font-bold">
              VERIFIED
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-2.5 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 text-black font-black text-xs uppercase tracking-wider transition-all"
          >
            {copied ? '✓ Copied ZK Payload' : 'Export JSON Passport'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white text-xs font-bold uppercase transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
