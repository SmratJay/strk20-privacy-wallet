'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExtendedAdapter, type PlaceOrderParams } from '@/extended/adapter';
import type {
  Balance,
  ExtendedAccountSnapshot,
  ExtendedOrder,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
} from '@/extended/types';

export function useExtended() {
  const adapter = useMemo(() => new ExtendedAdapter(), []);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('BTC-USD');
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  const [status, setStatus] = useState<{ read: boolean; trade: boolean } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [balance, setBalance] = useState<Balance | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<ExtendedOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<ExtendedOrder[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<PlacedOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isConnected = Boolean(status?.read);
  const canRead = Boolean(status?.read);
  const canTrade = Boolean(status?.trade);

  const market = useMemo(
    () => markets.find((m) => m.name === selectedMarket) ?? markets[0] ?? null,
    [markets, selectedMarket],
  );

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

  const refreshOrderbook = useCallback(async () => {
    if (!selectedMarket) return;
    try {
      setOrderbook(await adapter.getOrderbook(selectedMarket));
    } catch {
      // Orderbook is best-effort.
    }
  }, [adapter, selectedMarket]);

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
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to read auth status.');
    } finally {
      setStatusLoading(false);
    }
  }, [adapter]);

  const refreshAccount = useCallback(async () => {
    if (!status?.read) return;
    setAccountLoading(true);
    setAccountError(null);
    try {
      const snapshot: ExtendedAccountSnapshot = await adapter.getAccountSnapshot();
      setBalance(snapshot.balance);
      setPositions(snapshot.positions);
      setOpenOrders(snapshot.openOrders);
      setOrderHistory(snapshot.history);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to load account data.');
    } finally {
      setAccountLoading(false);
    }
  }, [adapter, status?.read]);

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

  // Load markets once.
  useEffect(() => {
    void refreshMarkets();
  }, [refreshMarkets]);

  // Load server auth status once.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Poll orderbook for the selected market.
  useEffect(() => {
    void refreshOrderbook();
    const t = setInterval(refreshOrderbook, 5000);
    return () => clearInterval(t);
  }, [refreshOrderbook]);

  // Poll account data while the server has read credentials.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (!status?.read) return;
    const t = setInterval(refreshAccount, 10000);
    return () => clearInterval(t);
  }, [status?.read, refreshAccount]);

  return {
    adapter,
    markets,
    selectedMarket,
    setSelectedMarket,
    market,
    orderbook,
    marketsLoading,
    marketsError,
    status,
    statusLoading,
    statusError,
    refreshStatus,
    isConnected,
    canRead,
    canTrade,
    balance,
    positions,
    openOrders,
    orderHistory,
    accountLoading,
    accountError,
    refreshAccount,
    refreshMarkets,
    placeOrder,
    closePosition,
    cancelOrder,
    submitting,
    lastPlacedOrder,
    actionError,
  };
}

export type UseExtended = ReturnType<typeof useExtended>;