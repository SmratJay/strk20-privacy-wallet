'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, History, Sparkles, Key, Lock, EyeOff, Layers, FileText, QrCode } from 'lucide-react';
import { Header } from '@/components/Header';
import { PrivacyBanner } from '@/components/PrivacyBanner';
import { BalanceCards } from '@/components/BalanceCards';
import { AnonymityScore } from '@/components/AnonymityScore';
import { PoolMetrics } from '@/components/PoolMetrics';
import { ShieldTab } from '@/components/tabs/ShieldTab';
import { SendTab } from '@/components/tabs/SendTab';
import { UnshieldTab } from '@/components/tabs/UnshieldTab';
import { SwapTab } from '@/components/tabs/SwapTab';
import { RequestTab } from '@/components/tabs/RequestTab';
import { NoteScannerTab } from '@/components/tabs/NoteScannerTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';
import { PublishAddressModal } from '@/components/PublishAddressModal';
import { AuditorExportModal } from '@/components/AuditorExportModal';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { MAINNET_TOKENS, TokenInfo, STRK20_POOL_ADDRESS } from '@/config/tokens';
import { ShieldedBalance, PrivacyTransaction, privacyService } from '@/services/privacyService';
import { useToast } from '@/components/Toast';

export default function Home() {
  const wallet = useStarknetWallet();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'SHIELD' | 'SEND' | 'REQUEST' | 'UNSHIELD' | 'SWAP' | 'SCANNER' | 'HISTORY'>('SHIELD');
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isAuditorModalOpen, setIsAuditorModalOpen] = useState(false);
  
  const [balances, setBalances] = useState<ShieldedBalance[]>(
    MAINNET_TOKENS.map((token) => ({
      token,
      publicBalance: 0n,
      shieldedBalance: 0n,
      pendingNotesCount: 0,
    }))
  );
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [transactions, setTransactions] = useState<PrivacyTransaction[]>([]);

  // Load transaction history from localStorage on client load
  useEffect(() => {
    try {
      const saved = localStorage.getItem('strk20_privacy_txs');
      if (saved) {
        setTransactions(JSON.parse(saved));
      }
    } catch (err) {
      console.warn('Could not load history from localStorage', err);
    }
  }, []);

  // Save transaction history to localStorage
  const saveTransactions = (newTxs: PrivacyTransaction[]) => {
    setTransactions(newTxs);
    try {
      localStorage.setItem('strk20_privacy_txs', JSON.stringify(newTxs));
    } catch (err) {
      console.warn('Could not save history to localStorage', err);
    }
  };

  // Fetch balances when wallet connects or changes
  const refreshBalances = useCallback(async () => {
    if (!wallet.address) return;
    setIsLoadingBalances(true);
    try {
      const updated = await privacyService.fetchBalances(wallet.address, wallet.walletAccount);
      setBalances(updated);
    } catch (err) {
      console.error('Balance fetch failed:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet.address, wallet.walletAccount]);

  useEffect(() => {
    if (wallet.isConnected && wallet.address) {
      refreshBalances();
    }
  }, [wallet.isConnected, wallet.address, refreshBalances]);

  // Handlers for completed operations
  const handleShieldSuccess = (txHash: string, token: TokenInfo, amount: string) => {
    const newTx: PrivacyTransaction = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'SHIELD',
      txHash,
      timestamp: Date.now(),
      tokenSymbol: token.symbol,
      amount,
      status: 'CONFIRMED',
      isPrivate: true,
      privacyDetails: `Deposited public ${token.symbol} into encrypted STRK20 note`,
    };
    saveTransactions([newTx, ...transactions]);
    refreshBalances();
    showToast({
      type: 'success',
      title: 'Tokens Shielded Successfully',
      description: `Deposited ${amount} ${token.symbol} into STRK20 pool encrypted note`,
    });
  };

  const handleSendSuccess = (txHash: string, token: TokenInfo, amount: string, recipient: string) => {
    const newTx: PrivacyTransaction = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'PRIVATE_TRANSFER',
      txHash,
      timestamp: Date.now(),
      tokenSymbol: token.symbol,
      amount,
      recipient,
      status: 'CONFIRMED',
      isPrivate: true,
      privacyDetails: `Encrypted transfer inside pool (sender & recipient hidden)`,
    };
    saveTransactions([newTx, ...transactions]);
    refreshBalances();
    showToast({
      type: 'success',
      title: 'Private Transfer Relayed',
      description: `Sent ${amount} ${token.symbol} to stealth recipient. Stwo proof verified.`,
    });
  };

  const handleUnshieldSuccess = (txHash: string, token: TokenInfo, amount: string, destination: string) => {
    const newTx: PrivacyTransaction = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'UNSHIELD',
      txHash,
      timestamp: Date.now(),
      tokenSymbol: token.symbol,
      amount,
      recipient: destination,
      status: 'CONFIRMED',
      isPrivate: false,
      privacyDetails: `Withdrew private note to public address ${destination.slice(0, 6)}...`,
    };
    saveTransactions([newTx, ...transactions]);
    refreshBalances();
    showToast({
      type: 'info',
      title: 'Unshield Withdrawal Executed',
      description: `Withdrew ${amount} ${token.symbol} to public address`,
    });
  };

  const handleSwapSuccess = (txHash: string, fromToken: TokenInfo, toToken: TokenInfo, amount: string) => {
    const newTx: PrivacyTransaction = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'SWAP',
      txHash,
      timestamp: Date.now(),
      tokenSymbol: `${fromToken.symbol} → ${toToken.symbol}`,
      amount,
      status: 'CONFIRMED',
      isPrivate: true,
      privacyDetails: `AVNU private swap credited to fresh encrypted note`,
    };
    saveTransactions([newTx, ...transactions]);
    refreshBalances();
    showToast({
      type: 'success',
      title: 'Private Swap Completed',
      description: `Swapped ${fromToken.symbol} to ${toToken.symbol} via AVNU privacy router`,
    });
  };

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col">
      {/* Header */}
      <Header
        wallet={wallet}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6 sm:py-8">
        {/* Network & Proof Metrics */}
        <PoolMetrics />

        {/* Intro / Privacy Invariant Banner */}
        <PrivacyBanner />

        {/* Privacy Health Score */}
        <AnonymityScore balances={balances} />

        {/* Dual Balance Cards */}
        <BalanceCards
          balances={balances}
          isLoading={isLoadingBalances}
          onRefresh={refreshBalances}
          onSelectAction={(tab) => setActiveTab(tab)}
        />

        {/* Tab Navigation */}
        <div className="flex items-center justify-center gap-1.5 p-1.5 bg-surface-elevated border border-surface-border rounded-2xl max-w-2xl mx-auto mb-6 shadow-lg overflow-x-auto">
          <button
            onClick={() => setActiveTab('SHIELD')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'SHIELD'
                ? 'bg-sky-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Shield</span>
          </button>

          <button
            onClick={() => setActiveTab('SEND')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'SEND'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>

          <button
            onClick={() => setActiveTab('REQUEST')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'REQUEST'
                ? 'bg-teal-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Invoice</span>
          </button>

          <button
            onClick={() => setActiveTab('UNSHIELD')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'UNSHIELD'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Unshield</span>
          </button>

          <button
            onClick={() => setActiveTab('SWAP')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'SWAP'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Swap</span>
          </button>

          <button
            onClick={() => setActiveTab('SCANNER')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'SCANNER'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>UTXO Scanner</span>
          </button>

          <button
            onClick={() => setActiveTab('HISTORY')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === 'HISTORY'
                ? 'bg-zinc-700 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History</span>
          </button>
        </div>

        {/* Tab Content Display */}
        <div className="transition-all duration-200">
          {activeTab === 'SHIELD' && (
            <ShieldTab
              balances={balances}
              wallet={wallet}
              onSuccess={handleShieldSuccess}
            />
          )}

          {activeTab === 'SEND' && (
            <SendTab
              balances={balances}
              wallet={wallet}
              onSuccess={handleSendSuccess}
            />
          )}

          {activeTab === 'REQUEST' && (
            <RequestTab
              wallet={wallet}
            />
          )}

          {activeTab === 'UNSHIELD' && (
            <UnshieldTab
              balances={balances}
              wallet={wallet}
              onSuccess={handleUnshieldSuccess}
            />
          )}

          {activeTab === 'SWAP' && (
            <SwapTab
              balances={balances}
              wallet={wallet}
              onSuccess={handleSwapSuccess}
            />
          )}

          {activeTab === 'SCANNER' && (
            <NoteScannerTab
              wallet={wallet}
            />
          )}

          {activeTab === 'HISTORY' && (
            <HistoryTab
              transactions={transactions}
              onClear={() => saveTransactions([])}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-border bg-surface/50 py-6 text-center text-xs text-zinc-500 font-mono">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span>Powered by STRK20 Privacy Pool</span>
            <span>•</span>
            <a
              href="https://strk20-by-example.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              strk20-by-example.org
            </a>
          </div>

          <div>
            Built by{' '}
            <a
              href="https://github.com/SmratJay"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 hover:text-white font-semibold"
            >
              Jai Bhati
            </a>{' '}
            (
            <a
              href="https://t.me/popexenon"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              @popexenon
            </a>
            ) — Founder of{' '}
            <a
              href="https://orrange.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:underline"
            >
              orrange.xyz
            </a>
          </div>
        </div>
      </footer>

      {/* Publish Privacy Address Modal */}
      {wallet.address && (
        <PublishAddressModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          accountAddress={wallet.address}
        />
      )}

      {/* Selective Disclosure & Auditor Modal */}
      {wallet.address && (
        <AuditorExportModal
          isOpen={isAuditorModalOpen}
          onClose={() => setIsAuditorModalOpen(false)}
          accountAddress={wallet.address}
        />
      )}
    </div>
  );
}
