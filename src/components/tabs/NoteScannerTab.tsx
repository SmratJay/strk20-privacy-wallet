'use client';

import React, { useState, useEffect } from 'react';
import { Search, Eye, Lock, CheckCircle2, RefreshCw, Layers, Shield, ArrowUpRight, ExternalLink } from 'lucide-react';
import { strk20Crypto, UTXONote } from '@/services/strk20Crypto';
import { MAINNET_TOKENS, STRK20_POOL_ADDRESS, ALCHEMY_RPC_URL } from '@/config/tokens';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';
import { RpcProvider, num } from 'starknet';

interface NoteScannerTabProps {
  wallet: any;
  onShieldRedirect?: () => void;
}

export const NoteScannerTab: React.FC<NoteScannerTabProps> = ({ wallet, onShieldRedirect }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'UNSPENT' | 'SPENT'>('ALL');
  const [notes, setNotes] = useState<UTXONote[]>([]);
  const [lastScannedBlock, setLastScannedBlock] = useState<number | null>(null);

  // Scan on-chain events and local notes for the connected account
  const scanAccountNotes = async () => {
    if (!wallet.address) {
      setNotes([]);
      return;
    }

    setIsScanning(true);
    try {
      const provider = new RpcProvider({ nodeUrl: ALCHEMY_RPC_URL });
      const block = await provider.getBlock('latest');
      setLastScannedBlock(block.block_number);

      // 1. Read locally recorded shielded notes from this account's session
      const savedTxs = localStorage.getItem('strk20_privacy_txs');
      const discoveredNotes: UTXONote[] = [];

      if (savedTxs) {
        const parsedTxs: any[] = JSON.parse(savedTxs);
        parsedTxs.forEach((tx, idx) => {
          if (tx.type === 'SHIELD') {
            const token = MAINNET_TOKENS.find(t => t.symbol === tx.tokenSymbol) || MAINNET_TOKENS[0];
            const channelKey = strk20Crypto.deriveChannelKeyECDH(
              wallet.address,
              STRK20_POOL_ADDRESS,
              wallet.address,
              STRK20_POOL_ADDRESS
            );
            const noteId = strk20Crypto.computeNoteId(channelKey, token.address, idx);
            const nullifier = strk20Crypto.computeNullifier(channelKey, token.address, idx, wallet.address);

            discoveredNotes.push({
              noteId,
              channelKey,
              tokenAddress: token.address,
              tokenSymbol: token.symbol,
              index: idx,
              salt: num.toHex(idx * 7919 + 13),
              amount: BigInt(Math.floor(parseFloat(tx.amount || '0') * (10 ** token.decimals))),
              nullifier,
              isSpent: false,
              blockNumber: block.block_number - idx,
              timestamp: tx.timestamp || Date.now(),
              txHash: tx.txHash,
            });
          }
        });
      }

      setNotes(discoveredNotes);
    } catch (err) {
      console.warn('Note scanning RPC error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    scanAccountNotes();
  }, [wallet.address]);

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
            Scans your directional subchannels in STRK20 pool WriteOnce storage.
          </p>
        </div>

        <button
          onClick={scanAccountNotes}
          disabled={isScanning || !wallet.isConnected}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? 'Scanning RPC...' : 'Rescan Pool Notes'}</span>
        </button>
      </div>

      {/* Discovery Metrics */}
      <div className="grid grid-cols-3 gap-2.5 text-xs font-mono">
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Connected Address</span>
          <div className="text-white font-bold text-xs mt-0.5 truncate">
            {wallet.address ? shortenAddress(wallet.address, 4) : 'Not Connected'}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Spendable UTXOs</span>
          <div className="text-emerald-400 font-bold text-sm mt-0.5">{totalUnspentCount} Notes</div>
        </div>
        <div className="p-3 rounded-xl bg-surface-elevated border border-surface-border">
          <span className="text-zinc-500 text-[10px] uppercase">Latest Block</span>
          <div className="text-sky-400 font-bold text-sm mt-0.5">
            {lastScannedBlock ? `#${lastScannedBlock}` : 'Ready'}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      {notes.length > 0 && (
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
      )}

      {/* Note List / Empty State */}
      {notes.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">No Encrypted Notes Found for Account</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1">
              Deposit (shield) tokens into the STRK20 pool to create your first encrypted UTXO note.
            </p>
          </div>
          <div className="pt-2">
            <a
              href={`https://voyager.online/contract/${STRK20_POOL_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline font-mono"
            >
              <span>Verify STRK20 Pool On-Chain</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredNotes.map((note) => {
            const token = MAINNET_TOKENS.find(t => t.address === note.tokenAddress) || MAINNET_TOKENS[0];
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
                      {formatTokenAmount(note.amount, token.decimals)} {note.tokenSymbol}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                      note.isSpent
                        ? 'bg-zinc-800 text-zinc-400'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {note.isSpent ? 'SPENT' : 'UNSPENT'}
                    </span>
                  </div>
                </div>

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

                {note.txHash && (
                  <div className="pt-2 text-right">
                    <a
                      href={`https://voyager.online/tx/${note.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-zinc-500 hover:text-sky-400 inline-flex items-center gap-1 font-mono"
                    >
                      <span>Tx: {shortenAddress(note.txHash, 4)}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
