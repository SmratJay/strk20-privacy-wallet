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
  FileCheck2,
  Terminal,
  Activity,
  Maximize2
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
import { LandingHero } from '@/components/landing/LandingHero';
import { ProblemSectorCards } from '@/components/landing/ProblemSectorCards';
import { MoatArchitectureSection } from '@/components/landing/MoatArchitectureSection';
import { InteractiveCliBar } from '@/components/landing/InteractiveCliBar';
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

  const scrollToTerminal = (targetTab?: PELTabType) => {
    if (targetTab) setActiveTab(targetTab);
    const terminalEl = document.getElementById('terminal');
    if (terminalEl) {
      terminalEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

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
        scrollToTerminal('SEND');
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
      const storedTxs = localStorage.getItem('strk20_privacy_txs');
      if (storedTxs) {
        setTransactions(JSON.parse(storedTxs));
      }
    } catch (e) {
      console.warn('Failed to load transaction history', e);
    }
  }, []);

  const saveTransactions = (txs: PrivacyTransaction[]) => {
    setTransactions(txs);
    try {
      localStorage.setItem('strk20_privacy_txs', JSON.stringify(txs));
    } catch (e) {
      console.warn('Failed to save transaction history', e);
    }
  };

  // Refresh public and shielded balances across all supported tokens
  const refreshBalances = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) {
      setBalances(
        currentNetwork.tokens.map((token) => ({
          token,
          publicBalance: 0n,
          shieldedBalance: 0n,
          pendingNotesCount: 0,
          privacyApiSupported: false,
        }))
      );
      return;
    }

    setIsLoadingBalances(true);
    try {
      const results = await privacyService.fetchBalances(
        wallet.address,
        wallet.walletAccount,
        currentNetwork
      );
      setBalances(results);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet.isConnected, wallet.address, wallet.walletAccount, currentNetwork]);

  useEffect(() => {
    refreshBalances();
    const interval = setInterval(refreshBalances, 12000);
    return () => clearInterval(interval);
  }, [refreshBalances]);

  const handleTxSuccess = (tx: PrivacyTransaction) => {
    const updated = [tx, ...transactions];
    saveTransactions(updated);
    refreshBalances();
    showToast({
      type: 'success',
      title: 'Confidential Transaction Confirmed',
      description: `Hash: ${tx.txHash ? tx.txHash.slice(0, 10) + '...' : 'Recorded in UTXO Vault'}`,
    });
  };

  return (
    <div className="min-h-screen bg-background text-zinc-100 flex flex-col font-sans pb-24 selection:bg-orrange-500 selection:text-black">
      <Header
        wallet={wallet}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
        onOpenPassportModal={() => setIsPassportModalOpen(true)}
        onLaunchTerminal={() => scrollToTerminal('PORTFOLIO')}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        {/* 1. Covalent-Style Landing Page Hero */}
        <LandingHero onLaunchTerminal={() => scrollToTerminal('PORTFOLIO')} />

        {/* 2. Onchain Finance Is Still Exposed Sector Breakdown */}
        <ProblemSectorCards onLaunchTerminal={() => scrollToTerminal('SWAP')} />

        {/* 3. Confidentiality Is The Only Moat Left */}
        <div id="architecture">
          <MoatArchitectureSection />
        </div>

        {/* 4. Live orrange Super-App Terminal Section */}
        <div id="terminal" className="pt-16 border-t border-zinc-800/80 space-y-8 scroll-mt-20">
          {/* Terminal Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-orrange-500 tracking-wider uppercase mb-1">
                <Terminal className="w-4 h-4" />
                <span>ORRANGE // TERMINAL WORKSTATION</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white font-mono tracking-tight uppercase">
                Private Financial Terminal
              </h2>
            </div>

            <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800">
                <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>BLOCK: #13551720</span>
              </span>
              <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-orrange-400 font-bold">
                <span>POOL: ACTIVE</span>
              </span>
            </div>
          </div>

          <PrivacyBanner />

          {/* Core Wallet & Pool Metrics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <BalanceCards
                balances={balances}
                isLoading={isLoadingBalances}
                onRefresh={refreshBalances}
                onSelectAction={(tab) => scrollToTerminal(tab)}
              />
            </div>
            <div className="space-y-6">
              <AnonymityScore balances={balances} />
              <PoolMetrics />
            </div>
          </div>

          {/* 10 Terminal Navigation Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-zinc-800 no-scrollbar font-mono text-xs">
            <button
              onClick={() => setActiveTab('PORTFOLIO')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'PORTFOLIO'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <PieChart className="w-3.5 h-3.5" />
              <span>Portfolio</span>
            </button>

            <button
              onClick={() => setActiveTab('SWAP')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'SWAP'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Trade (Spot)</span>
            </button>

            <button
              onClick={() => setActiveTab('PERPS')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'PERPS'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Perpetuals</span>
            </button>

            <button
              onClick={() => setActiveTab('EARN')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'EARN'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Earn (Yield)</span>
            </button>

            <button
              onClick={() => setActiveTab('SEND')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'SEND'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Send Privately</span>
            </button>

            <button
              onClick={() => setActiveTab('REQUEST')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'REQUEST'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Invoice (QR)</span>
            </button>

            <button
              onClick={() => setActiveTab('SHIELD')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'SHIELD'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Shield</span>
            </button>

            <button
              onClick={() => setActiveTab('UNSHIELD')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'UNSHIELD'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Unshield</span>
            </button>

            <button
              onClick={() => setActiveTab('SCANNER')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'SCANNER'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>UTXO Scanner</span>
            </button>

            <button
              onClick={() => setActiveTab('HISTORY')}
              className={`flex items-center gap-2 px-3.5 py-2 transition-all shrink-0 uppercase font-bold corner-box ${
                activeTab === 'HISTORY'
                  ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/50'
                  : 'border border-zinc-800/80 bg-zinc-950/80 text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Activity</span>
            </button>
          </div>

          {/* Active Workstation Viewport */}
          <div className="p-4 sm:p-6 bg-zinc-950/90 border border-zinc-800 corner-box shadow-2xl">
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
                    privacyDetails: 'Routed via orrange Intent Optimizer with Anonymizer Pool',
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
        </div>
      </main>

      {/* 5. Sticky Interactive CLI Bar at Bottom */}
      <InteractiveCliBar onExecuteCommand={(tab) => scrollToTerminal(tab)} />

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

export default function WalletApp() {
  return (
    <NetworkProvider>
      <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-orrange-500 font-mono text-sm">INITIALIZING ORRANGE...</div>}>
        <WalletAppContent />
      </Suspense>
    </NetworkProvider>
  );
}
