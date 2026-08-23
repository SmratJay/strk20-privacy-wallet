'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  ShieldCheck, 
  Activity, 
  Sparkles, 
  ArrowLeftRight, 
  Lock, 
  Layers, 
  PieChart,
  RefreshCw
} from 'lucide-react';

import { JupiterSidebar, PELTabType } from '@/components/terminal/JupiterSidebar';
import { TerminalTopBar } from '@/components/terminal/TerminalTopBar';
import { BalanceCards } from '@/components/BalanceCards';
import { PoolMetrics } from '@/components/PoolMetrics';

// 10 Tabs of the Financial Super-App
import { PortfolioTab } from '@/components/tabs/PortfolioTab';
import { SwapTab } from '@/components/tabs/SwapTab';
import { PerpsTab } from '@/components/tabs/PerpsTab';
import { EarnTab } from '@/components/tabs/EarnTab';
import { ShieldTab } from '@/components/tabs/ShieldTab';
import { SendTab } from '@/components/tabs/SendTab';
import { UnshieldTab } from '@/components/tabs/UnshieldTab';
import { RequestTab } from '@/components/tabs/RequestTab';
import { NoteScannerTab } from '@/components/tabs/NoteScannerTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';

import { PublishAddressModal } from '@/components/PublishAddressModal';
import { AuditorExportModal } from '@/components/AuditorExportModal';
import { CompliancePassportModal } from '@/components/CompliancePassportModal';
import { ConnectWalletModal } from '@/components/ConnectWalletModal';

import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { privacyService, ShieldedBalance, PrivacyTransaction } from '@/services/privacyService';
import { strk20WalletApiService } from '@/services/strk20WalletApiService';
import { TokenInfo } from '@/config/tokens';
import { useToast } from '@/components/Toast';
import { useNetwork } from '@/context/NetworkContext';
import { constants } from 'starknet';

function TerminalContent() {
  const { showToast } = useToast();
  const { currentNetwork, setNetworkId } = useNetwork();
  const wallet = useStarknetWallet();
  const searchParams = useSearchParams();

  // Active Terminal Tab State — Default is PORTFOLIO per user request
  const [activeTab, setActiveTab] = useState<PELTabType>('PORTFOLIO');

  // Modal visibility states
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isAuditorModalOpen, setIsAuditorModalOpen] = useState(false);
  const [isPassportModalOpen, setIsPassportModalOpen] = useState(false);

  // Pre-filled props for SendTab from invoice deep-links
  const [initialRecipient, setInitialRecipient] = useState('');
  const [initialTokenSymbol, setInitialTokenSymbol] = useState('');
  const [initialAmount, setInitialAmount] = useState('');

  // Balances state
  const [balances, setBalances] = useState<ShieldedBalance[]>(() =>
    currentNetwork.tokens.map((token) => ({
      token,
      publicBalance: 0n,
      publicBalanceAvailable: true,
      shieldedBalance: 0n,
      shieldedBalanceAvailable: false,
      pendingNotesCount: 0,
      privacyApiSupported: false,
    }))
  );
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [transactions, setTransactions] = useState<PrivacyTransaction[]>([]);

  // Parse URL search parameters on client mount for Invoice Deep-Links
  useEffect(() => {
    if (!searchParams) return;
    try {
      const tabParam = searchParams.get('tab');
      const networkParam = searchParams.get('network');
      const toParam = searchParams.get('to');
      const tokenParam = searchParams.get('token');
      const amountParam = searchParams.get('amount');
      const memoParam = searchParams.get('memo');

      if (networkParam && (networkParam === 'mainnet' || networkParam === 'sepolia')) {
        setNetworkId(networkParam);
      }

      if (toParam) setInitialRecipient(decodeURIComponent(toParam));
      if (tokenParam) setInitialTokenSymbol(tokenParam);
      if (amountParam) setInitialAmount(amountParam);

      if (tabParam) {
        const uppercaseTab = tabParam.toUpperCase() as PELTabType;
        setActiveTab(uppercaseTab);
      } else if (toParam) {
        setActiveTab('SEND');
      }

      if (memoParam) {
        showToast({
          type: 'info',
          title: 'Invoice Loaded',
          description: `Payment request for ${amountParam || ''} ${tokenParam || 'tokens'} pre-filled.`,
        });
      }
    } catch {
      // Ignore URL parse issues
    }
  }, [searchParams, setNetworkId, showToast]);

  // Load transaction history from localStorage scoped by active network
  useEffect(() => {
    try {
      const storageKey = `strk20_privacy_txs_${currentNetwork.id}`;
      const storedTxs = localStorage.getItem(storageKey);
      if (storedTxs) {
        setTransactions(JSON.parse(storedTxs));
      } else {
        const legacyTxs = localStorage.getItem('strk20_privacy_txs');
        if (legacyTxs && currentNetwork.id === 'mainnet') {
          setTransactions(JSON.parse(legacyTxs));
        } else {
          setTransactions([]);
        }
      }
    } catch (e) {
      console.warn('Failed to load transaction history', e);
    }
  }, [currentNetwork.id]);

  const saveTransactions = (txs: PrivacyTransaction[]) => {
    setTransactions(txs);
    try {
      const storageKey = `strk20_privacy_txs_${currentNetwork.id}`;
      localStorage.setItem(storageKey, JSON.stringify(txs));
    } catch (e) {
      console.warn('Failed to save transaction history', e);
    }
  };

  // ── Private-balance permission (session-only) ────────────────────────────────
  // Ready gates wallet_strk20Balances behind a "Share private balances" consent.
  // We track it in-memory for the current wallet session and NEVER poll private
  // balances — only read them after explicit grant / explicit refresh / a successful
  // shield/send/unshield.
  const [privateBalancePermission, setPrivateBalancePermission] = useState<
    'UNKNOWN' | 'GRANTED' | 'DENIED'
  >('UNKNOWN');

  const resetBalances = useCallback(() => {
    setBalances(
      currentNetwork.tokens.map((token) => ({
        token,
        publicBalance: 0n,
        publicBalanceAvailable: true,
        shieldedBalance: 0n,
        shieldedBalanceAvailable: false,
        pendingNotesCount: 0,
        privacyApiSupported: false,
      }))
    );
  }, [currentNetwork]);

  // PUBLIC balances: safe to poll (on-chain RPC, no wallet permission UI).
  const refreshPublicBalances = useCallback(async () => {
    if (!wallet.isConnected || !wallet.address) {
      resetBalances();
      return;
    }
    setIsLoadingBalances(true);
    try {
      const results = await privacyService.fetchBalances(
        wallet.address,
        wallet.walletAccount,
        currentNetwork
      );
      // Preserve wallet-derived private balances across public-only refreshes.
      setBalances((prev) => {
        const prevByAddr = new Map(
          prev.map((b) => [b.token.address.toLowerCase(), b] as const),
        );
        return results.map((b) => {
          const prior = prevByAddr.get(b.token.address.toLowerCase());
          return {
            ...b,
            shieldedBalance: prior?.shieldedBalance ?? 0n,
            shieldedBalanceAvailable: prior?.shieldedBalanceAvailable ?? false,
          };
        });
      });
    } catch (err) {
      console.error('Failed to fetch public balances:', err);
    } finally {
      setIsLoadingBalances(false);
    }
  }, [wallet.isConnected, wallet.address, wallet.walletAccount, currentNetwork, resetBalances]);

  // PRIVATE balances: only read when the wallet has granted access this session.
  const refreshPrivateBalances = useCallback(async () => {
    if (privateBalancePermission !== 'GRANTED') return;
    try {
      const status = await strk20WalletApiService.getWalletApiStatus(wallet);
      if (status.state !== 'READY') return;
      const entries = await strk20WalletApiService.getPrivateBalances(
        wallet,
        currentNetwork.tokens.map((t) => t.address),
      );
      const walletPrivate = new Map(entries.map((e) => [e.token.toLowerCase(), e.balance]));
      setBalances((prev) =>
        prev.map((b) => {
          const bal = walletPrivate.get(b.token.address.toLowerCase());
          if (bal !== undefined) {
            return { ...b, shieldedBalance: bal, shieldedBalanceAvailable: true };
          }
          return { ...b, shieldedBalance: 0n, shieldedBalanceAvailable: false };
        }),
      );
    } catch {
      // Leave the current state; never fabricate a balance.
    }
  }, [wallet, privateBalancePermission, currentNetwork]);

  // Explicit user action: request the wallet to share private balances. This is the
  // ONLY place the "Share private balances" consent is triggered.
  const requestPrivateBalanceAccess = useCallback(async () => {
    if (!wallet.isConnected) return;
    try {
      const entries = await strk20WalletApiService.getPrivateBalances(
        wallet,
        currentNetwork.tokens.map((t) => t.address),
      );
      setPrivateBalancePermission('GRANTED');
      const walletPrivate = new Map(entries.map((e) => [e.token.toLowerCase(), e.balance]));
      setBalances((prev) =>
        prev.map((b) => {
          const bal = walletPrivate.get(b.token.address.toLowerCase());
          if (bal !== undefined) {
            return { ...b, shieldedBalance: bal, shieldedBalanceAvailable: true };
          }
          return { ...b, shieldedBalance: 0n, shieldedBalanceAvailable: false };
        }),
      );
    } catch (err: any) {
      const t = strk20WalletApiService.translateWalletError(err);
      // User refused the balance-sharing consent -> remember for the session.
      setPrivateBalancePermission(t.code === 113 ? 'DENIED' : 'UNKNOWN');
      // Surface WHY the read failed instead of leaving the button silently doing nothing.
      if (t.code === 118) {
        showToast({
          type: 'error',
          title: 'Private receiving not enabled',
          description: 'Use "Enable Private Receiving" first to register this address for STRK20.',
        });
      } else if (t.code !== 113) {
        showToast({
          type: 'error',
          title: 'Private balances unavailable',
          description: t.userMessage,
        });
      }
    }
  }, [wallet, currentNetwork, showToast]);

  // Initial load: public balances only (no wallet permission prompt on render).
  useEffect(() => {
    refreshPublicBalances();
  }, [refreshPublicBalances]);

  // New wallet session -> reset the session-level private-balance permission.
  useEffect(() => {
    setPrivateBalancePermission('UNKNOWN');
  }, [wallet.isConnected, wallet.address]);

  // Auto-sync the app network to the connected wallet's chain. The whole deployed
  // protocol (STRK20 pool, PEL contracts, test USDC) is Sepolia-only; without this,
  // a Sepolia-connected user would have their balances queried against Mainnet and
  // see fabricated zeros.
  useEffect(() => {
    if (!wallet.isConnected || !wallet.chainId) return;
    try {
      const raw = String(wallet.chainId);
      const chainBig = typeof wallet.chainId === 'bigint'
        ? wallet.chainId
        : BigInt(raw.startsWith('0x') || raw.startsWith('0X') ? raw : '0x' + raw);
      const wantSepolia = chainBig === BigInt(constants.StarknetChainId.SN_SEPOLIA);
      setNetworkId(wantSepolia ? 'sepolia' : 'mainnet');
    } catch {
      // Ignore unparseable chainId; keep the current app network.
    }
  }, [wallet.isConnected, wallet.chainId, setNetworkId]);

  // Auto-refresh PUBLIC balances so newly received funds (e.g. Sepolia USDC) appear
  // without a manual refresh. PRIVATE balances are NEVER polled — the wallet's
  // "share private balances" consent is only requested on explicit user action.
  useEffect(() => {
    if (!wallet.isConnected) return;
    const t = setInterval(refreshPublicBalances, 12000);
    return () => clearInterval(t);
  }, [refreshPublicBalances, wallet.isConnected]);

  const handleTxSuccess = (tx: PrivacyTransaction) => {
    const updated = [tx, ...transactions];
    saveTransactions(updated);
    showToast({
      type: 'success',
      title: `${tx.type} Transaction Confirmed`,
      description: `Tx: ${tx.txHash?.slice(0, 10)}... | Privacy: ${tx.privacyDetails}`,
    });
    // Reconcile public + (if granted) private balances after a real transaction.
    refreshPublicBalances();
    if (privateBalancePermission === 'GRANTED') {
      refreshPrivateBalances();
    }
  };

  // Onboarding ("Enable Private Receiving") submits a real deposit through the wallet,
  // which registers + shields the first note. Record it in history and refresh balances.
  const handleOnboarded = (txHash: string, tokenSymbol: string, amount: string) => {
    handleTxSuccess({
      id: `tx_${Date.now()}`,
      type: 'SHIELD',
      tokenSymbol,
      amount,
      txHash,
      timestamp: Date.now(),
      status: 'CONFIRMED',
      isPrivate: true,
      privacyDetails: 'STRK20 privacy onboarding (auto-register + first note)',
    });
  };

  const handleSearchIntent = (query: string) => {
    const q = query.trim().toUpperCase();
    if (q.includes('SWAP') || q.includes('BUY') || q.includes('SELL')) {
      setActiveTab('SWAP');
    } else if (q.includes('PERP') || q.includes('LONG') || q.includes('SHORT') || q.includes('LEVERAGE')) {
      setActiveTab('PERPS');
    } else if (q.includes('SHIELD') || q.includes('DEPOSIT')) {
      setActiveTab('SHIELD');
    } else if (q.includes('UNSHIELD') || q.includes('WITHDRAW')) {
      setActiveTab('UNSHIELD');
    } else if (q.includes('SEND') || q.includes('TRANSFER')) {
      setActiveTab('SEND');
    } else if (q.includes('EARN') || q.includes('YIELD') || q.includes('VAULT')) {
      setActiveTab('EARN');
    } else if (q.includes('SCAN') || q.includes('UTXO')) {
      setActiveTab('SCANNER');
    } else if (q.includes('HISTORY') || q.includes('ACTIVITY')) {
      setActiveTab('HISTORY');
    } else if (q.includes('PORTFOLIO') || q.includes('BALANCE')) {
      setActiveTab('PORTFOLIO');
    } else {
      showToast({
        type: 'info',
        title: 'Intent Search',
        description: `Navigating terminal to best matching intent: ${query}`,
      });
      setActiveTab('SWAP');
    }
  };

  const [isSidebarPinned, setIsSidebarPinned] = useState(true);

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-mono flex">
      {/* 1. Jupiter-Style Left Sidebar (Hover-expandable desktop + mobile drawer) */}
      <JupiterSidebar
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onOpenPassportModal={() => setIsPassportModalOpen(true)}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        isPinned={isSidebarPinned}
        onTogglePin={() => setIsSidebarPinned(!isSidebarPinned)}
      />

      {/* 2. Main Terminal Content Area (Offset for desktop left sidebar) */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 pb-20 md:pb-10 ${
        isSidebarPinned ? 'md:pl-64' : 'md:pl-20'
      }`}>
        {/* Terminal Top Bar */}
        <TerminalTopBar
          wallet={wallet}
          onSearchIntent={handleSearchIntent}
        />

        {/* Workstation Container */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* Top Pool Status Metrics */}
          <PoolMetrics />

          {/* Quick Balance Cards (Shown prominently when in Portfolio or Shield/Unshield) */}
          {(activeTab === 'PORTFOLIO' || activeTab === 'SHIELD' || activeTab === 'UNSHIELD') && (
            <BalanceCards
              balances={balances}
              isLoading={isLoadingBalances}
              onRefresh={refreshPublicBalances}
              onSelectAction={(action) => setActiveTab(action as PELTabType)}
              wallet={wallet}
              privateBalancePermission={privateBalancePermission}
              onRequestPrivateBalanceAccess={requestPrivateBalanceAccess}
              onRefreshPrivateBalances={refreshPrivateBalances}
            />
          )}

          {/* Active Workstation Viewport */}
          <div className="p-4 sm:p-6 bg-zinc-950 border border-zinc-800 corner-box shadow-2xl relative">
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
              <EarnTab walletAddress={wallet.address || ''} />
            )}

            {activeTab === 'SHIELD' && (
              <ShieldTab
                balances={balances}
                wallet={wallet}
                privateBalancePermission={privateBalancePermission}
                onRequestPrivateBalanceAccess={requestPrivateBalanceAccess}
                onOnboarded={handleOnboarded}
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
                privateBalancePermission={privateBalancePermission}
                onRequestPrivateBalanceAccess={requestPrivateBalanceAccess}
                onOnboarded={handleOnboarded}
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
                    privacyDetails: 'Encrypted note transfer (Poseidon note hash)',
                  });
                }}
              />
            )}

            {activeTab === 'REQUEST' && <RequestTab wallet={wallet} />}

            {activeTab === 'UNSHIELD' && (
              <UnshieldTab
                balances={balances}
                wallet={wallet}
                privateBalancePermission={privateBalancePermission}
                onRequestPrivateBalanceAccess={requestPrivateBalanceAccess}
                onOnboarded={handleOnboarded}
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
                    privacyDetails: 'Relayer-mediated public withdrawal',
                  });
                }}
              />
            )}

            {activeTab === 'SCANNER' && (
              <NoteScannerTab
                wallet={wallet}
                onShieldRedirect={() => setActiveTab('SHIELD')}
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
      </div>

      {/* Compliance & Identity Modals */}
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

      {/* Connect Wallet Modal */}
      <ConnectWalletModal
        isOpen={wallet.isConnectModalOpen}
        onClose={wallet.closeConnectModal}
        supportedWallets={wallet.supportedWallets}
        isConnecting={wallet.isConnecting}
        connectingWalletId={wallet.connectingWalletId}
        connectionError={wallet.error}
        onSelectWallet={wallet.connectWallet}
        onRescan={wallet.rescan}
      />
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-orrange-400">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>INITIALIZING PEL TERMINAL WORKSTATION...</span>
        </div>
      </div>
    }>
      <TerminalContent />
    </Suspense>
  );
}
