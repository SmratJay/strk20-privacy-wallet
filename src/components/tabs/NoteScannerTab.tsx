'use client';

import React, { useState, useEffect } from 'react';
import { Lock, RefreshCw, Layers, ExternalLink, Key, AlertCircle, Loader2 } from 'lucide-react';
import { UTXONote } from '@/services/strk20Crypto';
import { viewingKeyService } from '@/services/viewingKeyService';
import { vaultService } from '@/services/vaultService';
import { formatTokenAmount, shortenAddress } from '@/utils/formatters';
import { RpcProvider } from 'starknet';
import { useNetwork } from '@/context/NetworkContext';

interface NoteScannerTabProps {
  wallet: any;
  onShieldRedirect?: () => void;
}

const VK_STORAGE_KEY = 'strk20_viewing_key';

function loadViewingKey(address: string): { privateKey: string; publicKey: string } | null {
  try {
    const raw = localStorage.getItem(`${VK_STORAGE_KEY}_${address}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveViewingKey(address: string, vk: { privateKey: string; publicKey: string }): void {
  try {
    localStorage.setItem(`${VK_STORAGE_KEY}_${address}`, JSON.stringify(vk));
  } catch {}
}

export const NoteScannerTab: React.FC<NoteScannerTabProps> = ({ wallet }) => {
  const { currentNetwork } = useNetwork();
  const [isScanning, setIsScanning] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'UNSPENT' | 'SPENT'>('ALL');
  const [notes, setNotes] = useState<UTXONote[]>([]);
  const [lastScannedBlock, setLastScannedBlock] = useState<number | null>(null);
  const [viewingKey, setViewingKey] = useState<{ privateKey: string; publicKey: string } | null>(null);
  const [isDeriving, setIsDeriving] = useState(false);
  const [deriveError, setDeriveError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.address) {
      const cached = loadViewingKey(wallet.address);
      setViewingKey(cached);
      const vaultNotes = vaultService.getNotes(wallet.address, currentNetwork.id);
      setNotes(vaultNotes);
      setLastScannedBlock(null);
    } else {
      setViewingKey(null);
      setNotes([]);
    }
  }, [wallet.address, currentNetwork.id]);

  useEffect(() => {
    if (wallet.address && viewingKey) {
      scanAccountNotes(viewingKey);
    }
  }, [wallet.address, viewingKey, currentNetwork]);

  const handleDeriveViewingKey = async () => {
    if (!wallet.rawWallet || !wallet.address) return;
    setIsDeriving(true);
    setDeriveError(null);

    try {
      let signatureResult: string[] | null = null;
      const provider = wallet.rawWallet;
      if (provider.request) {
        try {
          const res = await provider.request({
            type: 'wallet_signTypedData',
            params: {
              message: {
                types: {
                  StarkNetDomain: [
                    { name: 'name', type: 'felt' },
                    { name: 'version', type: 'felt' },
                    { name: 'chainId', type: 'felt' },
                  ],
                  Message: [{ name: 'action', type: 'felt' }],
                },
                primaryType: 'Message',
                domain: {
                  name: 'STRK20 Privacy Wallet',
                  version: '1',
                  chainId: currentNetwork.chainId,
                },
                message: {
                  action: 'Derive Viewing Key',
                },
              },
            },
          });
          signatureResult = Array.isArray(res) ? res : [res];
        } catch (err: any) {
          throw new Error(`Signature request rejected or failed: ${err?.message || 'User cancelled'}`);
        }
      }

      if (!signatureResult || signatureResult.length < 1 || !signatureResult[0]) {
        throw new Error('Wallet signature is required to securely derive your private viewing key.');
      }

      const derived = viewingKeyService.deriveViewingKeyFromSignature(signatureResult[0]);

      const vk = {
        privateKey: derived.privateViewingKey,
        publicKey: derived.publicViewingKey,
      };

      saveViewingKey(wallet.address, vk);
      setViewingKey(vk);
      await scanAccountNotes(vk);
    } catch (err: any) {
      setDeriveError(err.message || 'Could not derive viewing key');
    } finally {
      setIsDeriving(false);
    }
  };

  const scanAccountNotes = async (vkToUse?: { privateKey: string; publicKey: string }) => {
    const key = vkToUse || viewingKey;
    if (!key || !wallet.address) return;

    setIsScanning(true);
    try {
      const provider = new RpcProvider({ nodeUrl: currentNetwork.rpcUrls[0] });
      const currentBlock = await provider.getBlockNumber().catch(() => 0);
      setLastScannedBlock(currentBlock);

      const localNotes = vaultService.getNotes(wallet.address, currentNetwork.id);
      setNotes(localNotes);
    } catch (err) {
      console.error('Note scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const filteredNotes = notes.filter((n) => {
    if (activeFilter === 'UNSPENT') return !n.isSpent;
    if (activeFilter === 'SPENT') return n.isSpent;
    return true;
  });

  const totalUnspentCount = notes.filter((n) => !n.isSpent).length;

  return (
    <div className="max-w-2xl mx-auto p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl space-y-5 font-mono">
      <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
            <Lock className="w-4 h-4 text-orrange-400" />
            <span>Poseidon UTXO Note Scanner</span>
          </h2>
          <p className="text-[10px] text-zinc-500 uppercase mt-0.5">
            Client-Side Decryption Engine // {currentNetwork.name}
          </p>
        </div>

        <button
          onClick={() => scanAccountNotes()}
          disabled={isScanning || !viewingKey}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-bold text-zinc-200 transition-all uppercase disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-orrange-400' : ''}`} />
          <span>{isScanning ? 'Scanning...' : 'Scan Events'}</span>
        </button>
      </div>

      {/* Viewing Key Status */}
      {!viewingKey && (
        <div className="p-4 bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400 shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Derive Viewing Key to Decrypt Notes
              </h3>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Your viewing key decrypts your incoming UTXOs locally in the browser without revealing your private spending credentials.
              </p>
            </div>
          </div>

          {deriveError && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{deriveError}</span>
            </div>
          )}

          <button
            onClick={handleDeriveViewingKey}
            disabled={isDeriving || !wallet.isConnected}
            className="w-full py-2.5 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
          >
            {isDeriving ? 'Deriving Key in Wallet...' : 'Derive Viewing Key'}
          </button>
        </div>
      )}

      {/* Active Key Badge */}
      {viewingKey && (
        <div className="flex items-center justify-between p-2.5 bg-zinc-900 border border-zinc-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-orrange-500 animate-pulse" />
            <span className="text-orrange-400 font-bold uppercase text-[10px]">VIEWING_KEY_ACTIVE:</span>
            <span className="text-zinc-400 font-mono text-[10px]">{shortenAddress(viewingKey.publicKey, 6)}</span>
          </div>
          <button
            onClick={() => {
              if (wallet.address) localStorage.removeItem(`${VK_STORAGE_KEY}_${wallet.address}`);
              setViewingKey(null);
              setNotes([]);
            }}
            className="text-[10px] text-zinc-500 hover:text-rose-400 uppercase"
          >
            [CLEAR]
          </button>
        </div>
      )}

      {/* Filters */}
      {notes.length > 0 && (
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-3 py-1 text-[10px] font-bold uppercase border transition-all ${
              activeFilter === 'ALL'
                ? 'border-orrange-500 bg-orrange-500 text-black'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            All Notes ({notes.length})
          </button>
          <button
            onClick={() => setActiveFilter('UNSPENT')}
            className={`px-3 py-1 text-[10px] font-bold uppercase border transition-all ${
              activeFilter === 'UNSPENT'
                ? 'border-orrange-500 bg-orrange-500 text-black'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            Unspent ({totalUnspentCount})
          </button>
          <button
            onClick={() => setActiveFilter('SPENT')}
            className={`px-3 py-1 text-[10px] font-bold uppercase border transition-all ${
              activeFilter === 'SPENT'
                ? 'border-orrange-500 bg-orrange-500 text-black'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            Spent ({notes.length - totalUnspentCount})
          </button>
        </div>
      )}

      {/* Note List / Empty State */}
      {viewingKey && notes.length === 0 && !isScanning && (
        <div className="p-8 text-center bg-zinc-900/30 border border-dashed border-zinc-800 space-y-2">
          <p className="text-xs font-bold text-white uppercase">No Encrypted Notes Found</p>
          <p className="text-[11px] text-zinc-500">Deposit tokens into the pool to generate your first UTXO note.</p>
        </div>
      )}

      {filteredNotes.length > 0 && (
        <div className="space-y-2">
          {filteredNotes.map((note) => {
            const token = currentNetwork.tokens.find(t => t.address === note.tokenAddress) || currentNetwork.tokens[0];
            return (
              <div
                key={note.noteId}
                className={`p-3.5 border transition-all ${
                  note.isSpent
                    ? 'bg-zinc-950/40 border-zinc-900 opacity-60'
                    : 'bg-zinc-900/60 border-zinc-800 hover:border-orrange-500/40'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white font-mono">
                      {note.tokenSymbol} Note #{note.index}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">Block #{note.blockNumber}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${note.isSpent ? 'text-zinc-500 line-through' : 'text-orrange-400'}`}>
                      {formatTokenAmount(note.amount, token.decimals)} {note.tokenSymbol}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.2 font-bold border ${
                      note.isSpent
                        ? 'bg-zinc-900 text-zinc-500 border-zinc-800'
                        : 'bg-orrange-500/20 text-orrange-300 border-orrange-500/40'
                    }`}>
                      {note.isSpent ? 'SPENT' : 'UNSPENT'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-[10px] text-zinc-500">
                  <div>
                    <span>Poseidon Note ID: </span>
                    <span className="text-zinc-300">{shortenAddress(note.noteId, 6)}</span>
                  </div>
                  <div>
                    <span>Nullifier: </span>
                    <span className="text-amber-400">{shortenAddress(note.nullifier, 6)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
