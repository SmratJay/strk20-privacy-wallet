'use client';

import React, { useState } from 'react';
import { X, Check, Copy, FileText, Info, ExternalLink } from 'lucide-react';
import { shortenAddress } from '@/utils/formatters';
import { STRK20_POOL_ADDRESS } from '@/config/tokens';
import { strk20Crypto } from '@/services/strk20Crypto';

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
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Derive real domain-separated Poseidon commitment for auditor key escrow
  const escrowedBlob = strk20Crypto.computeAuditorEscrowCommitment(
    accountAddress,
    STRK20_POOL_ADDRESS
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(escrowedBlob);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-surface-elevated border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Selective Disclosure Protocol</h3>
              <p className="text-xs text-zinc-400 font-mono">STRK20 Viewing Key Escrow Commitment</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-surface-border transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/20 text-xs text-purple-200/90 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <p>
              STRK20 supports selective disclosure: the pool is confidential by default and can disclose the information needed to respond to a legitimate regulatory request without exposing unrelated users. At registration (<code>SetViewingKey</code>), your viewing key is encrypted via ECDH to the threshold auditor public key.
            </p>
          </div>

          <div className="space-y-1.5 font-mono">
            <label className="text-xs font-semibold text-zinc-400">
              Auditor Escrow Commitment (Poseidon Domain Hashed)
            </label>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-surface border border-surface-border text-xs text-zinc-300 break-all">
              <span className="flex-1 truncate">{escrowedBlob}</span>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg bg-surface-border hover:bg-zinc-700 text-zinc-200 shrink-0 transition-colors"
                title="Copy commitment hash"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Protocol Invariants */}
          <div className="p-3.5 rounded-xl bg-surface border border-surface-border text-xs space-y-2">
            <div className="font-semibold text-zinc-200">Cryptographic Guarantees:</div>
            <ul className="text-zinc-400 space-y-1.5 list-disc list-inside text-[11px]">
              <li>
                <strong className="text-zinc-300">Auditors cannot spend:</strong> Viewing keys provide read-only history decryption; signing spend transactions requires account authority.
              </li>
              <li>
                <strong className="text-zinc-300">Targeted isolation:</strong> Unsealing an escrow record decrypts only the specific target user's notes, preserving privacy for all other pool participants.
              </li>
              <li>
                <strong className="text-zinc-300">On-Chain Screening:</strong> Deposits are screened by protocol FPI before acceptance.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface flex justify-between items-center">
          <a
            href="https://strk20-by-example.org/compliance"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-400 hover:underline flex items-center gap-1 font-mono"
          >
            <span>strk20-by-example.org/compliance</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
