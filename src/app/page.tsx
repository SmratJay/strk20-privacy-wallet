'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { 
  Shield, 
  ArrowUpRight, 
  ArrowDownLeft, 
  History, 
  Sparkles, 
  Layers, 
  QrCode, 
  PieChart, 
  TrendingUp, 
  Zap, 
  Lock, 
  FileCheck2 
} from 'lucide-react';
import { Header } from '@/components/Header';
import { PrivacyBanner } from '@/components/PrivacyBanner';
import { BalanceCards } from '@/components/BalanceCards';
import { AnonymityScore } from '@/components/AnonymityScore';
import { PoolMetrics } from '@/components/PoolMetrics';
import { PortfolioTab } from '@/components/tabs/PortfolioTab';
import { PerpsTab } from '@/components/tabs/PerpsTab';
import { EarnTab } from '@/components/tabs/EarnTab';
import { ShieldTab } from '@/components/tabs/ShieldTab';
import { SendTab } from '@/components/tabs/SendTab';
import { UnshieldTab } from '@/components/tabs/UnshieldTab';
import { SwapTab } from '@/components/tabs/SwapTab';
import { RequestTab } from '@/components/tabs/RequestTab';
import { NoteScannerTab } from '@/components/tabs/NoteScannerTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';
import { PublishAddressModal } from '@/components/PublishAddressModal';
import { AuditorExportModal } from '@/components/AuditorExportModal';
import { CompliancePassportModal } from '@/components/CompliancePassportModal';
import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { TokenInfo } from '@/config/tokens';
import { ShieldedBalance, PrivacyTransaction, privacyService } from '@/services/privacyService';
import { useToast } from '@/components/Toast';
import { NetworkProvider, useNetwork } from '@/context/NetworkContext';

export type PELTabType = 
  | 'PORTFOLIO'
  | 'SWAP'
  | 'PERPS'
  | 'EARN'
  | 'SEND'
  | 'REQUEST'
  | 'SHIELD'
  | 'UNSHIELD'
  | 'SCANNER'
  | 'HISTORY';

function WalletAppContent() {
  const wallet = useStarknetWallet();
  const { showToast } = useToast();
  const { currentNetwork, networkId, setNetworkId, isSepolia } = useNetwork();
  const [activeTab, setActiveTab] = useState<PELTabType>('PORTFOLIO');
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isAuditorModalOpen, setIsAuditorModalOpen] = useState(false);
  const [isPassportModalOpen, setIsPassportModalOpen] = useState(false);

  // Deep-link / invoice pre-fill state
  const [initialRecipient, setInitialRecipient] = useState('');
  const [initialTokenSymbol, setInitialTokenSymbol] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [initialMemo, setInitialMemo] = useState('');
  
  const [balances, setBalances] = useState<ShieldedBalance[]>(
    currentNetwork.tokens.map((token) => ({
      token,
      publicBalance: 0n,
      shieldedBalance: 0n,
      pendingNotesCount: 0,
      privacyApiSupported: false,
    }))
  );
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [transactions, setTransactions] = useState<PrivacyTransaction[]>([]);

  // Parse URL search parameters on client mount for Invoice Deep-Links
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      const networkParam = urlParams.get('network');
      const toParam = urlParams.get('to');
      const tokenParam = urlParams.get('token');
      const amountParam = urlParams.get('amount');
      const memoParam = urlParams.get('memo');

      if (networkParam && (networkParam === 'mainnet' || networkParam === 'sepolia')) {
        setNetworkId(networkParam);
      }

      if (toParam) setInitialRecipient(decodeURIComponent(toParam));
      if (tokenParam) setInitialTokenSymbol(tokenParam);
      if (amountParam) setInitialAmount(amountParam);
      if (memoParam) setInitialMemo(decodeURIComponent(memoParam));

      if (tabParam === 'SEND' || toParam) {
        setActiveTab('SEND');
        if (memoParam) {
          showToast({
            type: 'info',
            title: 'Invoice Loaded',
            description: `Payment request for ${amountParam || ''} ${tokenParam || 'tokens'} pre-filled.`,
          });
        }
      }
    } catch {
      // Ignore URL parse issues
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Fetch balances when wallet connects or network changes
  const refreshBalances = useCallback(async () => {
    if (!wallet.address) return;
    setIsLoadingBalances(true);
    try {
      const updated = await privacyService.fetchBalances(
        wallet.address,
        wallet.walletAccount,
        currentNetwork
      );
      setBalances(updated);
    } catch (err) {
      console.error('Error refreshing balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet.address, wallet.walletAccount, currentNetwork]);

  useEffect(() => {
    if (wallet.address) {
      refreshBalances();
    }
  }, [wallet.address, currentNetwork, refreshBalances]);

  // Handle successful transaction callbacks
  const handleTxSuccess = (tx: PrivacyTransaction) => {
    const updated = [tx, ...transactions];
    saveTransactions(updated);
    refreshBalances();
    showToast({
      type: 'success',
      title: 'Transaction Submitted',
      description: `${tx.type} for ${tx.amount} ${tx.tokenSymbol} confirmed.`,
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col font-sans selection:bg-purple-500 selection:text-white">
      {/* Super-App Header */}
      <Header
        wallet={wallet}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
        onOpenPassportModal={() => setIsPassportModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-6">
        {/* Top Context & Anonymity Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          <div className="lg:col-span-8">
            <PrivacyBanner />
          </div>
          <div className="lg:col-span-4">
            <AnonymityScore balances={balances} />
          </div>
        </div>

        {/* Global Super-App Navigation Menu */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 overflow-x-auto shadow-lg backdrop-blur-md">
          <button
            onClick={() => setActiveTab('PORTFOLIO')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'PORTFOLIO'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <PieChart className="w-3.5 h-3.5" />
            <span>Portfolio</span>
          </button>

          <button
            onClick={() => setActiveTab('SWAP')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'SWAP'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Trade (Spot)</span>
          </button>

          <button
            onClick={() => setActiveTab('PERPS')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'PERPS'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Perpetuals</span>
          </button>

          <button
            onClick={() => setActiveTab('EARN')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'EARN'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>Earn (Yield)</span>
          </button>

          <button
            onClick={() => setActiveTab('SEND')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'SEND'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-sky-400" />
            <span>Send Privately</span>
          </button>

          <button
            onClick={() => setActiveTab('REQUEST')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'REQUEST'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <QrCode className="w-3.5 h-3.5 text-indigo-400" />
            <span>Invoice (QR)</span>
          </button>

          <button
            onClick={() => setActiveTab('SHIELD')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'SHIELD'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5 text-purple-400" />
            <span>Shield</span>
          </button>

          <button
            onClick={() => setActiveTab('UNSHIELD')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'UNSHIELD'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-zinc-400" />
            <span>Unshield</span>
          </button>

          <button
            onClick={() => setActiveTab('SCANNER')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'SCANNER'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>UTXO Scanner</span>
          </button>

          <button
            onClick={() => setActiveTab('HISTORY')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              activeTab === 'HISTORY'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <History className="w-3.5 h-3.5 text-zinc-400" />
            <span>Activity</span>
          </button>
        </div>

        {/* Tab Viewport */}
        <div className="pt-2">
          {activeTab === 'PORTFOLIO' && (
            <PortfolioTab
              balances={balances}
              walletAddress={wallet.address || ''}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'SWAP' && (
            <SwapTab
              balances={balances}
              wallet={wallet}
              onSuccess={(txHash, fromToken, toToken, amount) => {
                handleTxSuccess({
                  id: `tx_${Date.now()}`,
                  type: 'SWAP',
                  tokenSymbol: `${fromToken.symbol} ➔ ${toToken.symbol}`,
                  amount,
                  txHash,
                  timestamp: Date.now(),
                  status: 'CONFIRMED',
                  isPrivate: true,
                  privacyDetails: 'Routed via PEL Intent Optimizer with Anonymizer Pool',
                });
              }}
            />
          )}

          {activeTab === 'PERPS' && (
            <PerpsTab walletAddress={wallet.address || ''} />
          )}

          {activeTab === 'EARN' && (
            <EarnTab walletAddress={wallet.address || ''} balances={balances} />
          )}

          {activeTab === 'SHIELD' && (
            <ShieldTab
              balances={balances}
              wallet={wallet}
              onSuccess={(txHash, token, amount) => {
                handleTxSuccess({
                  id: `tx_${Date.now()}`,
                  type: 'SHIELD',
                  tokenSymbol: token.symbol,
                  amount,
                  txHash,
                  timestamp: Date.now(),
                  status: 'CONFIRMED',
                  isPrivate: true,
                  privacyDetails: 'Deposit into STRK20 Note-Based Pool',
                });
              }}
            />
          )}

          {activeTab === 'SEND' && (
            <SendTab
              balances={balances}
              wallet={wallet}
              initialRecipient={initialRecipient}
              initialTokenSymbol={initialTokenSymbol}
              initialAmount={initialAmount}
              initialMemo={initialMemo}
              onSuccess={(txHash, token, amount, recipient) => {
                handleTxSuccess({
                  id: `tx_${Date.now()}`,
                  type: 'PRIVATE_TRANSFER',
                  tokenSymbol: token.symbol,
                  amount,
                  recipient,
                  txHash,
                  timestamp: Date.now(),
                  status: 'CONFIRMED',
                  isPrivate: true,
                  privacyDetails: 'Confidential UTXO Note Transfer to Stealth Recipient',
                });
              }}
            />
          )}

          {activeTab === 'REQUEST' && (
            <RequestTab wallet={wallet} />
          )}

          {activeTab === 'UNSHIELD' && (
            <UnshieldTab
              balances={balances}
              wallet={wallet}
              onSuccess={(txHash, token, amount, destination) => {
                handleTxSuccess({
                  id: `tx_${Date.now()}`,
                  type: 'UNSHIELD',
                  tokenSymbol: token.symbol,
                  amount,
                  recipient: destination,
                  txHash,
                  timestamp: Date.now(),
                  status: 'CONFIRMED',
                  isPrivate: true,
                  privacyDetails: 'Burned Note & Transferred to Public Starknet Address',
                });
              }}
            />
          )}

          {activeTab === 'SCANNER' && (
            <NoteScannerTab wallet={wallet} onShieldRedirect={() => setActiveTab('SHIELD')} />
          )}

          {activeTab === 'HISTORY' && (
            <HistoryTab transactions={transactions} onClear={() => saveTransactions([])} />
          )}
        </div>
      </main>

      {/* Modals */}
      <PublishAddressModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        accountAddress={wallet.address || ''}
      />

      <AuditorExportModal
        isOpen={isAuditorModalOpen}
        onClose={() => setIsAuditorModalOpen(false)}
        accountAddress={wallet.address || ''}
      />

      <CompliancePassportModal
        isOpen={isPassportModalOpen}
        onClose={() => setIsPassportModalOpen(false)}
        walletAddress={wallet.address || ''}
      />
    </div>
  );
}

export default function Home() {
  return (
    <NetworkProvider>
      <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">Loading PEL Super-App...</div>}>
        <WalletAppContent />
      </Suspense>
    </NetworkProvider>
  );
}
