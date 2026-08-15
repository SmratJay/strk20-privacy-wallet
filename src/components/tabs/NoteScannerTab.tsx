'use client';

import React, { useState } from 'react';
import { Search, Eye, Lock, CheckCircle2, RefreshCw, Key, Shield, Layers, Hash } from 'lucide-react';
import { strk20Crypto, SimulatedNote } from '@/services/strk20Crypto';
import { MAINNET_TOKENS } from '@/config/tokens';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';

interface NoteScannerTabProps {
  wallet: any;
}

export const NoteScannerTab: React.FC<NoteScannerTabProps> = ({ wallet }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'UNSPENT' | 'SPENT'>('ALL');

  // Simulated live UTXO pool notes for this session/wallet
  const [notes, setNotes] = useState<SimulatedNote[]>([
    {
      noteId: strk20Crypto.computeNoteId('0x1a8f9c2d...', MAINNET_TOKENS[0].address, 0),
      channelKey: '0x1a8f9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
      tokenAddress: MAINNET_TOKENS[0].address,
      tokenSymbol: 'STRK',
      index: 0,
      salt: '0x3f1a',
      amount: 50000000000000000000n, // 50 STRK
      nullifier: strk20Crypto.computeNullifier('0x1a8f...', MAINNET_TOKENS[0].address, 0, '0xowner'),
      isSpent: false,
      blockNumber: 624192,
      timestamp: Date.now() - 1000 * 60 * 45,
    },
    {
      noteId: strk20Crypto.computeNoteId('0x1a8f9c2d...', MAINNET_TOKENS[0].address, 1),
      channelKey: '0x1a8f9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
      tokenAddress: MAINNET_TOKENS[0].address,
      tokenSymbol: 'STRK',
      index: 1,
      salt: '0x99b2',
      amount: 70000000000000000000n, // 70 STRK
      nullifier: strk20Crypto.computeNullifier('0x1a8f...', MAINNET_TOKENS[0].address, 1, '0xowner'),
      isSpent: false,
      blockNumber: 624210,
      timestamp: Date.now() - 1000 * 60 * 20,
    },
    {
      noteId: strk20Crypto.computeNoteId('0x2b9e1d4c...', MAINNET_TOKENS[2].address, 0),
      channelKey: '0x2b9e1d4c5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c',
      tokenAddress: MAINNET_TOKENS[2].address,
      tokenSymbol: 'USDC',
      index: 0,
      salt: '0x12a8',
      amount: 500000000n, // 500 USDC
      nullifier: strk20Crypto.computeNullifier('0x2b9e...', MAINNET_TOKENS[2].address, 0, '0xowner'),
      isSpent: false,
      blockNumber: 624225,
      timestamp: Date.now() - 1000 * 60 * 5,
    },
    {
      noteId: strk20Crypto.computeNoteId('0x1a8f9c2d...', MAINNET_TOKENS[0].address, 2),
      channelKey: '0x1a8f9c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
      tokenAddress: MAINNET_TOKENS[0].address,
      tokenSymbol: 'STRK',
      index: 2,
      salt: '0x7c41',
      amount: 25000000000000000000n, // 25 STRK
      nullifier: strk20Crypto.computeNullifier('0x1a8f...', MAINNET_TOKENS[0].address, 2, '0xowner'),
      isSpent: true,
      blockNumber: 624150,
      timestamp: Date.now() - 1000 * 60 * 120,
    },
  ]);

  const handleScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
    }, 1200);
  };

  const filteredNotes = notes.filter((n) => {
    if (activeFilter === 'UNSPENT') return !n.isSpent;
    if (activeFilter === 'SPENT') return n.isSpent;
    return true;
  });

  const totalUnspentCount = notes.filter((n) => !n.isSpent).length;

  return (
    <div className="max-w-3xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <span>UTXO Channel & Note Inspector</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Off-chain subchannel discovery engine. Scans only your directional lanes in WriteOnce storage.
          </p>
        </div>

        <button
          onClick={handleScan}
          disabled={isScanning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? 'Scanning Channels...' : 'Rescan Subchannels'}</span>
        </button>
      </div>

      {/* Discovery Metrics */}
      <div className="grid grid-cols-3 gap-2.5 text-xs font-mono">
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Active Subchannels</span>
          <div className="text-white font-bold text-sm mt-0.5">2 Lanes</div>
        </div>
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Spendable UTXOs</span>
          <div className="text-emerald-400 font-bold text-sm mt-0.5">{totalUnspentCount} Notes</div>
        </div>
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Storage Density</span>
          <div className="text-sky-400 font-bold text-sm mt-0.5">100% Sequential</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => setActiveFilter('ALL')}
          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
            activeFilter === 'ALL'
              ? 'bg-zinc-700 text-white'
              : 'bg-surface-elevated text-zinc-400 hover:text-zinc-200'
          }`}
        >
          All Notes ({notes.length})
        </button>
        <button
          onClick={() => setActiveFilter('UNSPENT')}
          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
            activeFilter === 'UNSPENT'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
              : 'bg-surface-elevated text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Unspent Only ({totalUnspentCount})
        </button>
        <button
          onClick={() => setActiveFilter('SPENT')}
          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
            activeFilter === 'SPENT'
              ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40'
              : 'bg-surface-elevated text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Spent ({notes.length - totalUnspentCount})
        </button>
      </div>

      {/* Note List */}
      <div className="space-y-2.5">
        {filteredNotes.map((note) => {
          const decimals = note.tokenSymbol === 'USDC' ? 6 : 18;
          return (
            <div
              key={note.noteId}
              className={`p-4 rounded-xl border transition-all ${
                note.isSpent
                  ? 'bg-surface/50 border-surface-border opacity-70'
                  : 'bg-surface-elevated border-surface-border hover:border-sky-500/30'
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-surface-border/60">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${note.isSpent ? 'bg-zinc-800 text-zinc-500' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    <Lock className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white font-mono">
                      {note.tokenSymbol} Note (Index #{note.index})
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono ml-2">Block #{note.blockNumber}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-mono">
                  <span className={`text-xs font-bold ${note.isSpent ? 'text-zinc-500 line-through' : 'text-emerald-400'}`}>
                    {formatTokenAmount(note.amount, decimals)} {note.tokenSymbol}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                    note.isSpent
                      ? 'bg-zinc-800 text-zinc-400'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {note.isSpent ? 'SPENT' : 'UNSPENT (Spendable)'}
                  </span>
                </div>
              </div>

              {/* Technical Note Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-[11px] font-mono text-zinc-400">
                <div>
                  <span className="text-zinc-500">Poseidon Note ID:</span>{' '}
                  <span className="text-zinc-300">{shortenAddress(note.noteId, 6)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Nullifier:</span>{' '}
                  <span className="text-purple-400">{shortenAddress(note.nullifier, 6)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
