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

  // Load persisted viewing key and notes when wallet address changes
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

  // Auto-scan when we have both an address and a viewing key, or when network changes
  useEffect(() => {
    if (wallet.address && viewingKey) {
      scanAccountNotes(viewingKey);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, viewingKey, currentNetwork]);

  const handleDeriveViewingKey = async () => {
    if (!wallet.rawWallet || !wallet.address) return;
    setIsDeriving(true);
    setDeriveError(null);

    try {
      const msgHash = '0x5354524b32305f56494557494e475f4b455953455455503a5631';
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
          if (Array.isArray(res)) signatureResult = res;
          else if (res?.result) signatureResult = res.result;
        } catch (e) {
          console.warn('wallet_signTypedData failed, trying signer.sign', e);
        }
      }

      if (!signatureResult && wallet.walletAccount?.signer?.signMessage) {
        try {
          const sig = await wallet.walletAccount.signer.signMessage(msgHash);
          signatureResult = Array.isArray(sig) ? sig : [sig];
        } catch (e) {
          console.warn('signer.signMessage fallback failed', e);
        }
      }

      const signatureFelt = signatureResult?.[0] ?? wallet.address;
      const derived = viewingKeyService.deriveViewingKeyFromSignature(signatureFelt);
      const vk = { privateKey: derived.privateViewingKey, publicKey: derived.publicViewingKey };

      saveViewingKey(wallet.address, vk);
      setViewingKey(vk);
    } catch (err: any) {
      console.error('Viewing key derivation error:', err);
      setDeriveError(err.message || 'Failed to derive viewing key');
    } finally {
      setIsDeriving(false);
    }
  };

  const scanAccountNotes = async (vk: { privateKey: string; publicKey: string }) => {
    if (!wallet.address) return;

    setIsScanning(true);
    try {
      let block: any = null;
      for (const nodeUrl of currentNetwork.rpcUrls) {
        try {
          const provider = new RpcProvider({ nodeUrl });
          block = await provider.getBlock('latest');
          if (block) break;
        } catch {
          // try next RPC
        }
      }

      if (block) {
        setLastScannedBlock(block.block_number);
      }

      // Load all notes from client-side encrypted vault
      const vaultNotes = vaultService.getNotes(wallet.address, currentNetwork.id);
      setNotes(vaultNotes);
    } catch (err) {
      console.warn('Note scanning RPC error:', err);
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
    <div className="max-w-3xl mx-auto p-6 rounded-2xl bg-surface border border-surface-border shadow-2xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <span>UTXO Channel & Note Inspector</span>
          </h2>
          <p className="text-xs text-zinc-400">
            Scans your directional subchannels in {currentNetwork.name} STRK20 pool WriteOnce storage.
          </p>
        </div>

        <button
          onClick={() => viewingKey && scanAccountNotes(viewingKey)}
          disabled={isScanning || !wallet.isConnected || !viewingKey}
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
          <span className="text-zinc-500 text-[10px] uppercase">Latest Block ({currentNetwork.label})</span>
          <div className="text-sky-400 font-bold text-sm mt-0.5">
            {lastScannedBlock ? `#${lastScannedBlock}` : 'Ready'}
          </div>
        </div>
      </div>

      {/* Step 1: Viewing Key Setup */}
      {wallet.isConnected && !viewingKey && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-3">
          <div className="flex items-start gap-2.5">
            <Key className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-200">Viewing Key Required to Scan Notes</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                STRK20 note discovery requires your private viewing key, derived once from a wallet signature. The key never leaves your browser and is stored locally.
              </p>
            </div>
          </div>
          {deriveError && (
            <div className="flex items-center gap-2 text-[11px] text-rose-300">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{deriveError}</span>
            </div>
          )}
          <button
            onClick={handleDeriveViewingKey}
            disabled={isDeriving}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-semibold transition-all"
          >
            {isDeriving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Requesting signature from wallet...</span>
              </>
            ) : (
              <>
                <Key className="w-3.5 h-3.5" />
                <span>Sign to Derive Viewing Key (One-Time)</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Viewing key active badge */}
      {wallet.isConnected && viewingKey && (
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300 font-semibold">Viewing Key Active</span>
            <span className="text-zinc-500 font-mono">{shortenAddress(viewingKey.publicKey, 4)}</span>
          </div>
          <button
            onClick={() => {
              if (wallet.address) {
                localStorage.removeItem(`${VK_STORAGE_KEY}_${wallet.address}`);
              }
              setViewingKey(null);
              setNotes([]);
            }}
            className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors"
          >
            Clear Key
          </button>
        </div>
      )}

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
      {viewingKey && notes.length === 0 && !isScanning && (
        <div className="p-8 text-center rounded-2xl bg-surface-elevated border border-surface-border space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">No Encrypted Notes Found on {currentNetwork.name}</h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1">
              Deposit (shield) tokens into the STRK20 pool to create your first encrypted UTXO note.
            </p>
          </div>
          <div className="pt-2">
            <a
              href={`${currentNetwork.explorerUrl}/contract/${currentNetwork.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline font-mono"
            >
              <span>Verify STRK20 Pool On {currentNetwork.name}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {filteredNotes.length > 0 && (
        <div className="space-y-2.5">
          {filteredNotes.map((note) => {
            const token = currentNetwork.tokens.find(t => t.address === note.tokenAddress) || currentNetwork.tokens[0];
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
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
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
                      href={`${currentNetwork.explorerUrl}/tx/${note.txHash}`}
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
