'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExtendedAdapter, type PlaceOrderParams } from '@/extended/adapter';
import { buildDepositCalldata } from '@/extended/deposit';
import { getExtendedEnvironment } from '@/extended/config';
import { ExtendedStream, marketStreamUrl } from '@/extended/stream';
import { accountCreationTypedData, accountRegistrationTypedData } from '@/extended/typedData';
import type {
  Balance,
  Candle,
  Deposit,
  ExtendedAccountSnapshot,
  ExtendedOrder,
  Market,
  Orderbook,
  OrderbookStreamMessage,
  PlacedOrder,
  Position,
  PublicTrade,
  TradesStreamMessage,
} from '@/extended/types';

export interface DepositExecution {
  status: 'idle' | 'signing' | 'submitted' | 'confirmed' | 'error';
  transactionHash?: string;
  error?: string;
  amount?: string;
}

/** Session lifecycle for the terminal. */
export type SessionState =
  | 'bootstrapping' // initial status check in flight
  | 'none' // no session, no env credentials, wallet connected or not
  | 'needsOnboarding' // wallet connected but no valid Extended session
  | 'active' // a valid session (or env credentials) is active
  | 'error'; // status check failed

/** Native Starknet onboarding lifecycle. */
export type OnboardingState =
  | 'idle'
  | 'checking' // verifying the wallet is deployed on Mainnet
  | 'notDeployed' // wallet is not deployed on Starknet Mainnet
  | 'checkFailed' // could not confirm deployment (RPC issue)
  | 'signing' // waiting for wallet signature requests
  | 'submitting' // POST /auth/register
  | 'success'
  | 'unavailable' // backend could not complete onboarding
  | 'error';

export interface ExtendedWalletInfo {
  address?: string | null;
  chainId?: string | null;
  isConnected?: boolean;
  walletAccount?: {
    signMessage?: (typedData: unknown) => Promise<{ r: unknown; s: unknown }>;
    execute?: (calls: unknown[]) => Promise<{ transaction_hash?: string; transactionHash?: string }>;
    provider?: { waitForTransaction?: (hash: string, opts?: unknown) => Promise<unknown> };
  } | null;
}

const CANDLE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

const TERMINAL_ORDER_STATUSES = new Set(['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED']);

/**
 * Map raw Extended/network error text into a concise, user-actionable message.
 * Falls back to the raw message when the cause is not recognized.
 */
export function translateError(raw: string | unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '');
  if (/wallet not installed|not detected|install the ready/i.test(msg)) {
    return 'Ready Wallet is not installed. Install the Ready extension, then connect.';
  }
  if (/wrong network|mainnet|SN_MAIN|switch your wallet/i.test(msg)) {
    return 'Your wallet must be on Starknet Mainnet to use Extended. Switch networks in your wallet.';
  }
  if (/user rejected|user abort|user refused|rejected in your wallet|denied by user/i.test(msg)) {
    return 'The signature was rejected in your wallet.';
  }
  if (/insufficient (usdc|balance|funds)/i.test(msg)) {
    return 'Insufficient USDC balance to place this order.';
  }
  if (/margin|maintenance margin/i.test(msg)) {
    return 'Insufficient margin for this order. Reduce size or increase collateral.';
  }
  if (/min order|minimum order|minPositionSize|minOrderSize/i.test(msg)) {
    return 'Order size is below the market minimum.';
  }
  if (/not (configured|onboarded)/i.test(msg)) {
    return 'Your Extended account is not ready yet. Complete onboarding first.';
  }
  if (/stale|expired session|session.*invalid|sessionExpired/i.test(msg)) {
    return 'Your Extended session expired. Reconnect your wallet to continue.';
  }
  if (/market.*not (found|available)|MarketNotFound/i.test(msg)) {
    return 'This market is not available. Select another market.';
  }
  if (/websocket|stream|disconnect/i.test(msg)) {
    return 'Live market feed disconnected. Reconnecting…';
  }
  if (/deposit.*pending|pending.*deposit/i.test(msg)) {
    return 'Your deposit is still pending. It will appear in your balance once confirmed on-chain.';
  }
  if (/withdraw.*pending|pending.*withdraw/i.test(msg)) {
    return 'Your withdrawal is pending. It will be processed by Extended.';
  }
  if (msg && msg !== 'Something went wrong.') return msg;
  return 'Something went wrong. Please try again.';
}

export function useExtended(wallet?: ExtendedWalletInfo) {
  const adapter = useMemo(() => new ExtendedAdapter(), []);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('BTC-USD');
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  // Candles + trades.
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('5m');
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [trades, setTrades] = useState<PublicTrade[]>([]);

  // Session + auth status.
  const [status, setStatus] = useState<{
    read: boolean;
    trade: boolean;
    session?: { wallet: string; read: boolean; trade: boolean; accountId?: number | null; vaultId?: number | null } | null;
  } | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('bootstrapping');
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Account data.
  const [balance, setBalance] = useState<Balance | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<ExtendedOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<ExtendedOrder[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [accountInfo, setAccountInfo] = useState<{ accountId: number; l2Vault: number } | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Actions.
  const [submitting, setSubmitting] = useState(false);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<PlacedOrder | null>(null);
  const [lastOrder, setLastOrder] = useState<{ id: number; externalId: string } | null>(null);
  const [lastOrderStatus, setLastOrderStatus] = useState<string | null>(null);
  const [trackingOrder, setTrackingOrder] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [leverage, setLeverage] = useState<string>('');
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [withdrawState, setWithdrawState] = useState<{ loading: boolean; id?: number; error?: string }>({ loading: false });
  const [depositState, setDepositState] = useState<DepositExecution>({ status: 'idle' });

  // Onboarding state machine.
  const [onboardingState, setOnboardingState] = useState<OnboardingState>('idle');
  const [onboardingDetail, setOnboardingDetail] = useState<string | null>(null);

  const connectedAddress = wallet?.address ?? null;
  const connectedChain = wallet?.chainId ?? null;
  const walletConnected = Boolean(wallet?.isConnected && wallet?.address);

  const isConnected = Boolean(status?.read);
  const canRead = Boolean(status?.read);
  const canTrade = Boolean(status?.trade);
  const sessionWallet = adapter.sessionWallet;
  const hasStoredSession = adapter.hasStoredSession;

  const market = useMemo(
    () => markets.find((m) => m.name === selectedMarket) ?? markets[0] ?? null,
    [markets, selectedMarket],
  );

  // ── Markets ────────────────────────────────────────────────────────────────────
  const refreshMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const all = await adapter.getPerpetualMarkets();
      setMarkets(all);
      setSelectedMarket((prev) => {
        if (all.some((m) => m.name === prev)) return prev;
        return all.some((m) => m.name === 'BTC-USD') ? 'BTC-USD' : (all[0]?.name ?? '');
      });
    } catch (err) {
      setMarketsError(err instanceof Error ? err.message : 'Failed to load markets.');
    } finally {
      setMarketsLoading(false);
    }
  }, [adapter]);

  // ── Candles ────────────────────────────────────────────────────────────────────
  const refreshCandles = useCallback(
    async (interval: CandleInterval = candleInterval) => {
      if (!selectedMarket) return;
      setCandlesLoading(true);
      try {
        const data = await adapter.getCandles(selectedMarket, 'trades', interval, 400);
        // The API returns candles newest-first; render oldest→newest left→right.
        setCandles(data.slice().reverse());
      } catch {
        // Best-effort.
      } finally {
        setCandlesLoading(false);
      }
    },
    [adapter, selectedMarket, candleInterval],
  );

  // ── REST orderbook / trades fallback ───────────────────────────────────────────
  const refreshOrderbook = useCallback(async () => {
    if (!selectedMarket) return;
    try {
      setOrderbook(await adapter.getOrderbook(selectedMarket));
    } catch {
      // Best-effort.
    }
  }, [adapter, selectedMarket]);

  const refreshTrades = useCallback(async () => {
    if (!selectedMarket) return;
    try {
      const data = await adapter.getTrades(selectedMarket);
      if (data.length > 0) setTrades(data.slice(0, 50));
    } catch {
      // Best-effort.
    }
  }, [adapter, selectedMarket]);

  // ── WebSocket streams (orderbook + trades) with REST fallback ─────────────────
  useEffect(() => {
    if (!selectedMarket) return;
    const env = getExtendedEnvironment();

    let localBook: Record<string, { bid: Map<string, string>; ask: Map<string, string> }> = {};
    const handleMessage = (raw: unknown) => {
      const msg = raw as OrderbookStreamMessage;
      if (msg?.type === 'SNAPSHOT') {
        const bid = new Map<string, string>();
        const ask = new Map<string, string>();
        for (const l of msg.data?.b ?? []) bid.set(l.p, l.q);
        for (const l of msg.data?.a ?? []) ask.set(l.p, l.q);
        localBook[msg.data.m] = { bid, ask };
        setOrderbook({ market: msg.data.m, bid: [...bid.entries()].map(([p, q]) => ({ price: p, qty: q })), ask: [...ask.entries()].map(([p, q]) => ({ price: p, qty: q })) });
      } else if (msg?.type === 'DELTA') {
        const book = localBook[msg.data.m];
        if (!book) return;
        for (const l of msg.data?.b ?? []) {
          if (Number(l.q) === 0) book.bid.delete(l.p);
          else book.bid.set(l.p, l.q);
        }
        for (const l of msg.data?.a ?? []) {
          if (Number(l.q) === 0) book.ask.delete(l.p);
          else book.ask.set(l.p, l.q);
        }
        setOrderbook({
          market: msg.data.m,
          bid: [...book.bid.entries()].map(([p, q]) => ({ price: p, qty: q })),
          ask: [...book.ask.entries()].map(([p, q]) => ({ price: p, qty: q })),
        });
      }
    };

    const handleTrades = (raw: unknown) => {
      const msg = raw as TradesStreamMessage;
      if (Array.isArray(msg?.data)) setTrades((prev) => [...msg.data, ...prev].slice(0, 50));
    };

    let orderbookStream: ExtendedStream | null = null;
    let tradesStream: ExtendedStream | null = null;
    let obPoll: ReturnType<typeof setInterval> | null = null;
    let tradesPoll: ReturnType<typeof setInterval> | null = null;
    let wsSupported = typeof WebSocket !== 'undefined';

    if (wsSupported) {
      try {
        orderbookStream = new ExtendedStream(marketStreamUrl(env.streamUrl, `orderbooks/${selectedMarket}`), {
          onMessage: handleMessage,
        });
        tradesStream = new ExtendedStream(marketStreamUrl(env.streamUrl, `publicTrades/${selectedMarket}`), {
          onMessage: handleTrades,
        });
      } catch {
        orderbookStream = null;
        tradesStream = null;
        wsSupported = false;
      }
    }

    if (!wsSupported || !orderbookStream) {
      void refreshOrderbook();
      obPoll = setInterval(refreshOrderbook, 2500);
    }
    if (!wsSupported || !tradesStream) {
      void refreshTrades();
      tradesPoll = setInterval(refreshTrades, 3000);
    }

    return () => {
      orderbookStream?.dispose();
      tradesStream?.dispose();
      if (obPoll) clearInterval(obPoll);
      if (tradesPoll) clearInterval(tradesPoll);
      localBook = {};
    };
  }, [adapter, selectedMarket, refreshOrderbook, refreshTrades]);

  // ── Live candle stream (updates the most recent candle in place) ─────────────
  useEffect(() => {
    if (!selectedMarket) return;
    const env = getExtendedEnvironment();
    if (typeof WebSocket === 'undefined') return;
    let stream: ExtendedStream | null = null;
    try {
      stream = new ExtendedStream(
        marketStreamUrl(env.streamUrl, `candles/${selectedMarket}/trades?interval=${candleInterval}`),
        {
          onMessage: (raw) => {
            const msg = raw as { data?: Candle[] };
            const incoming = Array.isArray(msg?.data) ? msg.data[msg.data.length - 1] : null;
            if (!incoming || !incoming.T) return;
            setCandles((prev) => {
              if (!prev.length) return prev;
              const last = prev[prev.length - 1];
              if (incoming.T === last.T) {
                return [...prev.slice(0, -1), incoming];
              }
              if (incoming.T > last.T) {
                return [...prev, incoming].slice(-400);
              }
              return prev;
            });
          },
        },
      );
    } catch {
      stream = null;
    }
    return () => {
      stream?.dispose();
    };
  }, [selectedMarket, candleInterval]);

  // ── Session / auth status (state machine) ─────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    setSessionState((prev) => (prev === 'active' ? prev : 'bootstrapping'));
    try {
      const s = await adapter.getStatus();

      // A stale/expired token was detected server-side (adapter already cleared it).
      if (s.sessionExpired) {
        setStatus({ read: s.read, trade: s.trade, session: null });
        setBalance(null);
        setPositions([]);
        setOpenOrders([]);
        setOrderHistory([]);
        setDeposits([]);
        setAccountInfo(null);
        // Env credentials may still be configured — keep the terminal usable in that case.
        setSessionState(s.read ? 'active' : walletConnected ? 'needsOnboarding' : 'none');
        return;
      }

      // A session exists but belongs to a different wallet → clear and re-onboard.
      if (s.session?.wallet && connectedAddress && s.session.wallet.toLowerCase() !== connectedAddress.toLowerCase()) {
        adapter.clearSession();
        setStatus({ read: s.read, trade: s.trade, session: null });
        setBalance(null);
        setPositions([]);
        setOpenOrders([]);
        setOrderHistory([]);
        setDeposits([]);
        setAccountInfo(null);
        setSessionState(s.read ? 'active' : walletConnected ? 'needsOnboarding' : 'none');
        return;
      }

      setStatus(s);
      if (!s.read) {
        setBalance(null);
        setPositions([]);
        setOpenOrders([]);
        setOrderHistory([]);
        setDeposits([]);
        setAccountInfo(null);
        setSessionState(walletConnected ? 'needsOnboarding' : 'none');
      } else {
        setSessionState('active');
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to read auth status.');
      setSessionState('error');
    } finally {
      setStatusLoading(false);
    }
  }, [adapter, walletConnected, connectedAddress]);

  // On mount + whenever the connected wallet (address) changes → reconcile the session.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, connectedAddress]);

  // ── Account snapshot + info ────────────────────────────────────────────────────
  const refreshAccount = useCallback(async () => {
    if (!status?.read) return;
    setAccountLoading(true);
    setAccountError(null);
    try {
      const [snapshot, info, dep] = await Promise.allSettled([
        adapter.getAccountSnapshot(),
        adapter.getAccountInfo(),
        adapter.getDeposits(),
      ]);
      if (snapshot.status === 'fulfilled') {
        const s: ExtendedAccountSnapshot = snapshot.value;
        setBalance(s.balance);
        setPositions(s.positions);
        setOpenOrders(s.openOrders);
        setOrderHistory(s.history);
      }
      if (info.status === 'fulfilled') {
        setAccountInfo({ accountId: info.value.accountId, l2Vault: info.value.l2Vault });
        setLeverage((prev) => prev || '');
      }
      if (dep.status === 'fulfilled') setDeposits(dep.value);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to load account data.');
    } finally {
      setAccountLoading(false);
    }
  }, [adapter, status?.read]);

  // ── Leverage ───────────────────────────────────────────────────────────────────
  const refreshLeverage = useCallback(async () => {
    if (!selectedMarket || !canTrade) return;
    setLeverageLoading(true);
    try {
      const res = await fetch(`/api/extended/leverage?market=${encodeURIComponent(selectedMarket)}`, {
        cache: 'no-store',
        headers: { 'X-Extended-Session': adapter.sessionToken ?? '' },
      });
      if (res.ok) {
        const data = (await res.json()) as { leverage?: string };
        if (data.leverage) setLeverage(data.leverage);
      }
    } catch {
      // Best-effort.
    } finally {
      setLeverageLoading(false);
    }
  }, [selectedMarket, canTrade, adapter]);

  const setLeverageForMarket = useCallback(
    async (value: string) => {
      if (!selectedMarket) return;
      setLeverageLoading(true);
      setActionError(null);
      try {
        await adapter.setLeverage(selectedMarket, value);
        setLeverage(value);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Leverage update failed.');
      } finally {
        setLeverageLoading(false);
      }
    },
    [adapter, selectedMarket],
  );

  // ── Orders ─────────────────────────────────────────────────────────────────────
  const trackOrder = useCallback(
    (id: number, externalId: string) => {
      setLastOrder({ id, externalId });
      setLastOrderStatus('SUBMITTED');
      setTrackingOrder(true);
      let attempts = 0;
      const maxAttempts = 12;
      const stop = (interval: ReturnType<typeof setInterval>) => {
        setTrackingOrder(false);
        clearInterval(interval);
      };
      const tick = async (interval: ReturnType<typeof setInterval>) => {
        attempts += 1;
        try {
          const snap = await adapter.getAccountSnapshot();
          const found =
            snap.openOrders.find((o) => o.id === id) ??
            snap.history.find((o) => o.id === id) ??
            snap.history.find((o) => o.externalId === externalId);
          if (found) {
            setLastOrderStatus(found.status);
            if (TERMINAL_ORDER_STATUSES.has(found.status)) stop(interval);
          }
        } catch {
          // Best-effort — the regular account poll reconciles state too.
        }
        if (attempts >= maxAttempts) stop(interval);
      };
      const interval = setInterval(() => void tick(interval), 3000);
      void tick(interval);
    },
    [adapter],
  );

  const placeOrder = useCallback(
    async (params: Omit<PlaceOrderParams, 'market'> & { market?: string }) => {
      setSubmitting(true);
      setActionError(null);
      setLastPlacedOrder(null);
      try {
        const placed = await adapter.placeOrder({
          ...params,
          market: params.market ?? selectedMarket,
        });
        setLastPlacedOrder(placed);
        trackOrder(placed.id, placed.externalId);
        await refreshAccount();
        return placed;
      } catch (err) {
        setActionError(translateError(err));
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [adapter, selectedMarket, refreshAccount, trackOrder],
  );

  const closePosition = useCallback(
    async (position: Position, size?: string) => {
      setSubmitting(true);
      setActionError(null);
      try {
        const placed = await adapter.closePosition(position, size);
        trackOrder(placed.id, placed.externalId);
        await refreshAccount();
        return placed;
      } catch (err) {
        setActionError(translateError(err));
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [adapter, refreshAccount, trackOrder],
  );

  const cancelOrder = useCallback(
    async (id: number) => {
      setActionError(null);
      try {
        await adapter.cancelOrder(id);
        if (lastOrder?.id === id) {
          setLastOrderStatus('CANCELLED');
          setTrackingOrder(false);
        }
        await refreshAccount();
      } catch (err) {
        setActionError(translateError(err));
      }
    },
    [adapter, refreshAccount, lastOrder],
  );

  // ── Native Starknet onboarding (state machine) ────────────────────────────────
  const runOnboarding = useCallback(async () => {
    const account = wallet?.walletAccount;
    const address = wallet?.address;
    if (!account || !address) {
      setOnboardingState('error');
      setOnboardingDetail('No Starknet wallet connected. Connect your wallet first.');
      return;
    }

    setOnboardingState('checking');
    setOnboardingDetail(null);

    // 1. Verify the wallet is deployed on Starknet Mainnet (Extended verifies on-chain).
    try {
      const deployment = await adapter.checkWalletDeployment(address);
      if (deployment.deployed === false && !deployment.unknown) {
        setOnboardingState('notDeployed');
        setOnboardingDetail(
          'This wallet is not deployed on Starknet Mainnet yet. Extended verifies the wallet on-chain, so it must be deployed (fund it or deploy it once) before it can trade.',
        );
        return;
      }
      // `unknown` (RPC node issue) is non-blocking: proceed and let the register result
      // decide. A confirmed non-deployment is the only hard stop.
    } catch {
      // Deployment check failed at the HTTP layer — proceed best-effort.
    }

    // 2-4. Generate the exact AccountCreation + AccountRegistration signatures.
    setOnboardingState('signing');
    try {
      if (typeof account.signMessage !== 'function') {
        setOnboardingState('error');
        setOnboardingDetail('The connected wallet does not support typed-data signing.');
        return;
      }
      const env = getExtendedEnvironment();
      const time = new Date().toISOString();
      const creationSig = await account.signMessage(accountCreationTypedData(address, env.starknetDomain));
      const registrationSig = await account.signMessage(
        accountRegistrationTypedData(address, env.authHost, time, env.starknetDomain),
      );

      // 5. Submit the exact production request.
      setOnboardingState('submitting');
      const result = await adapter.onboardStarknet({
        wallet: address,
        accountCreationSig: { r: String(creationSig.r), s: String(creationSig.s) },
        accountRegistrationSig: { r: String(registrationSig.r), s: String(registrationSig.s) },
        time,
      });

      // 6-8. Verify response + account info, then enter the terminal.
      setOnboardingState('success');
      setOnboardingDetail(result.status);
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Onboarding failed.';
      // The backend returns HTTP 500 for STARKNET requests it cannot verify. Surface a
      // clean, non-technical message and preserve the credential-backed fallback.
      const clean = /HTTP 5\d\d|Failed to fetch|network/i.test(msg)
        ? 'Extended could not complete account creation for this wallet right now. Your wallet must be deployed on Starknet Mainnet. Try again, or use provisioned server API credentials.'
        : translateError(msg);
      setOnboardingState('unavailable');
      setOnboardingDetail(clean);
    }
  }, [adapter, wallet, refreshStatus]);

  // Clear the onboarding state when a session becomes active.
  useEffect(() => {
    if (sessionState === 'active') {
      setOnboardingState((prev) => (prev === 'success' ? 'success' : 'idle'));
    }
  }, [sessionState]);

  // ── Deposit (on-chain, native Starknet USDC) ───────────────────────────────────
  const depositOnChain = useCallback(
    async (amount: string, walletAccount: ExtendedWalletInfo['walletAccount']) => {
      if (!walletAccount?.execute) throw new Error('No Starknet wallet connected.');
      if (!accountInfo) throw new Error('Extended account info is not loaded yet.');
      const calldata = buildDepositCalldata(amount, accountInfo.l2Vault);
      setDepositState({ status: 'signing', amount });
      try {
        const res = await walletAccount.execute([
          {
            contractAddress: calldata.approve.contractAddress,
            entrypoint: calldata.approve.entrypoint,
            calldata: calldata.approve.calldata,
          },
          {
            contractAddress: calldata.deposit.contractAddress,
            entrypoint: calldata.deposit.entrypoint,
            calldata: calldata.deposit.calldata,
          },
        ]);
        const txHash = res.transaction_hash ?? res.transactionHash ?? '';
        setDepositState({ status: 'submitted', transactionHash: txHash, amount });

        // Wait for on-chain acceptance (best-effort, bounded) before reconciling.
        if (txHash && walletAccount.provider?.waitForTransaction) {
          try {
            await walletAccount.provider.waitForTransaction(txHash, { retryInterval: 4000, timeout: 180000 });
          } catch {
            // The transaction is broadcast; reconciliation below is authoritative.
          }
        }

        await refreshAccount();
        setDepositState({ status: 'confirmed', transactionHash: txHash, amount });
        return txHash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Deposit failed.';
        setDepositState({ status: 'error', error: msg, amount });
        throw err;
      }
    },
    [accountInfo, refreshAccount],
  );

  // ── Withdraw ───────────────────────────────────────────────────────────────────
  const withdraw = useCallback(
    async (amount: string) => {
      setWithdrawState({ loading: true });
      setActionError(null);
      try {
        const result = await adapter.withdraw({ amount });
        setWithdrawState({ loading: false, id: result.id });
        await refreshAccount();
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Withdrawal failed.';
        setWithdrawState({ loading: false, error: msg });
        throw err;
      }
    },
    [adapter, refreshAccount],
  );

  // ── Initial load + polling ─────────────────────────────────────────────────────
  useEffect(() => {
    void refreshMarkets();
  }, [refreshMarkets]);

  useEffect(() => {
    void refreshCandles(candleInterval);
    const t = setInterval(() => void refreshCandles(candleInterval), 30000);
    return () => clearInterval(t);
  }, [refreshCandles, candleInterval, selectedMarket]);

  // Account polling while a session/credential is active.
  useEffect(() => {
    if (!status?.read) return;
    void refreshAccount();
    const t = setInterval(refreshAccount, 10000);
    return () => clearInterval(t);
  }, [status?.read, refreshAccount]);

  useEffect(() => {
    if (selectedMarket) void refreshLeverage();
  }, [selectedMarket, refreshLeverage]);

  return {
    adapter,
    env: getExtendedEnvironment(),
    markets,
    selectedMarket,
    setSelectedMarket,
    market,
    orderbook,
    candles,
    candleInterval,
    setCandleInterval,
    candlesLoading,
    trades,
    marketsLoading,
    marketsError,
    status,
    statusLoading,
    statusError,
    sessionState,
    refreshStatus,
    refreshMarkets,
    refreshOrderbook,
    isConnected,
    canRead,
    canTrade,
    sessionWallet,
    hasStoredSession,
    balance,
    positions,
    openOrders,
    orderHistory,
    deposits,
    accountInfo,
    accountLoading,
    accountError,
    refreshAccount,
    leverage,
    leverageLoading,
    setLeverageForMarket,
    placeOrder,
    closePosition,
    cancelOrder,
    depositOnChain,
    withdraw,
    withdrawState,
    depositState,
    submitting,
    lastPlacedOrder,
    lastOrder,
    lastOrderStatus,
    trackingOrder,
    actionError,
    clearActionError: () => setActionError(null),
    onboardingState,
    onboardingDetail,
    runOnboarding,
    resetOnboarding: () => setOnboardingState('idle'),
  };
}

export type UseExtended = ReturnType<typeof useExtended>;
export { CANDLE_INTERVALS };