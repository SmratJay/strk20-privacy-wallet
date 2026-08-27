'use client';

import React, { useState } from 'react';
import { X, Check, Copy, FileText, Info } from 'lucide-react';
import { strk20Crypto } from '@/services/strk20Crypto';
import { useNetwork } from '@/context/NetworkContext';

interface AuditorExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountAddress: string;
}

export const AuditorExportModal: React.FC<AuditorExportModalProps> = ({
  isOpen,
  onClose,
  accountAddress,
}) => {
  const { currentNetwork } = useNetwork();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const escrowedBlob = strk20Crypto.computeAuditorEscrowCommitment(
    accountAddress,
    currentNetwork.poolAddress
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(escrowedBlob);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md font-mono">
      <div className="relative w-full max-w-lg bg-zinc-950 border border-orrange-500/50 corner-box shadow-2xl overflow-hidden space-y-4 p-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Selective Disclosure Protocol</h3>
              <p className="text-[10px] text-zinc-500 uppercase">STRK20 Viewing Key Escrow Commitment ({currentNetwork.label})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3">
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
            <span className="text-orrange-400 font-bold uppercase text-[10px]">Institutional Compliance:</span>
            <p>
              STRK20 enables selective disclosure: the pool is confidential by default and can disclose specific slices needed for regulatory compliance without exposing unrelated participants.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-500 uppercase">
              Auditor Escrow Commitment (Poseidon Domain Hash)
            </label>
            <div className="flex items-center gap-2 p-2 bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 break-all">
              <span className="flex-1 truncate">{escrowedBlob}</span>
              <button
                onClick={handleCopy}
                className="text-orrange-400 hover:underline text-[10px] uppercase font-bold shrink-0"
              >
                {copied ? '[COPIED]' : '[COPY]'}
              </button>
            </div>
          </div>

          {/* Protocol Invariants */}
          <div className="p-3 bg-zinc-900/40 border border-zinc-800 text-xs space-y-1.5 text-[11px]">
            <div className="font-bold text-white uppercase text-[10px]">Cryptographic Guarantees:</div>
            <ul className="text-zinc-400 space-y-1 list-disc list-inside">
              <li>
                <strong className="text-zinc-300">Auditors cannot spend:</strong> Viewing keys only decrypt read history; spending requires account private key.
              </li>
              <li>
                <strong className="text-zinc-300">Targeted isolation:</strong> Unsealing decrypts only your target note slice.
              </li>
            </ul>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white text-xs font-bold uppercase tracking-wider transition-all"
        >
          Close Escrow Inspector
        </button>
      </div>
    </div>
  );
};
