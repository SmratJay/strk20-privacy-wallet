'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtendedAdapter, type PlaceOrderParams } from '@/extended/adapter';
import { buildDepositCalldata } from '@/extended/deposit';
import { getExtendedEnvironment } from '@/extended/config';
import { ExtendedStream, marketStreamUrl } from '@/extended/stream';
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

const CANDLE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export function useExtended() {
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [leverage, setLeverage] = useState<string>('');
  const [leverageLoading, setLeverageLoading] = useState(false);
  const [withdrawState, setWithdrawState] = useState<{ loading: boolean; id?: number; error?: string }>({ loading: false });
  const [depositState, setDepositState] = useState<DepositExecution>({ status: 'idle' });

  const isConnected = Boolean(status?.read);
  const canRead = Boolean(status?.read);
  const canTrade = Boolean(status?.trade);
  const sessionWallet = adapter.sessionWallet;

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
        setCandles(data);
      } catch {
        // Best-effort.
      } finally {
        setCandlesLoading(false);
      }
    },
    [adapter, selectedMarket, candleInterval],
  );

  // ── REST orderbook fallback ────────────────────────────────────────────────────
  const refreshOrderbook = useCallback(async () => {
    if (!selectedMarket) return;
    try {
      setOrderbook(await adapter.getOrderbook(selectedMarket));
    } catch {
      // Orderbook is best-effort.
    }
  }, [adapter, selectedMarket]);

  // ── REST trades fallback ───────────────────────────────────────────────────────
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

    // Maintain the orderbook locally from SNAPSHOT/DELTA messages.
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

    // REST polling fallback (orderbook 2.5s, trades 3s) whenever WS is unavailable.
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

  // ── Session / auth status ──────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await adapter.getStatus();
      setStatus(s);
      if (!s.read) {
        setBalance(null);
        setPositions([]);
        setOpenOrders([]);
        setOrderHistory([]);
        setDeposits([]);
        setAccountInfo(null);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to read auth status.');
    } finally {
      setStatusLoading(false);
    }
  }, [adapter]);

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
        await refreshAccount();
        return placed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Order failed.';
        setActionError(msg);
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [adapter, selectedMarket, refreshAccount],
  );

  const closePosition = useCallback(
    async (position: Position, size?: string) => {
      setSubmitting(true);
      setActionError(null);
      try {
        const placed = await adapter.closePosition(position, size);
        await refreshAccount();
        return placed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Close failed.';
        setActionError(msg);
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [adapter, refreshAccount],
  );

  const cancelOrder = useCallback(
    async (id: number) => {
      setActionError(null);
      try {
        await adapter.cancelOrder(id);
        await refreshAccount();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Cancel failed.');
      }
    },
    [adapter, refreshAccount],
  );

  // ── Deposit (on-chain, native Starknet USDC) ───────────────────────────────────
  const depositOnChain = useCallback(
    async (amount: string, walletAccount: { execute: (calls: unknown[]) => Promise<{ transaction_hash?: string; transactionHash?: string }> } | null | undefined) => {
      if (!walletAccount) throw new Error('No Starknet wallet connected.');
      if (!accountInfo) throw new Error('Extended account info is not loaded yet.');
      if (!market) throw new Error('No market selected.');
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
        await refreshAccount();
        setDepositState({ status: 'confirmed', transactionHash: txHash, amount });
        return txHash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Deposit failed.';
        setDepositState({ status: 'error', error: msg, amount });
        throw err;
      }
    },
    [accountInfo, market, refreshAccount],
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
    void refreshStatus();
  }, [refreshStatus]);

  // Candles: initial + interval-based refresh (respect the chart interval).
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

  // Leverage refresh when the market or trade capability changes.
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
    refreshStatus,
    refreshMarkets,
    isConnected,
    canRead,
    canTrade,
    sessionWallet,
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
    actionError,
  };
}

export type UseExtended = ReturnType<typeof useExtended>;
export { CANDLE_INTERVALS };