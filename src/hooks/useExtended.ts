'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExtendedAdapter, type ExtendedAccountCredentials } from '@/extended/adapter';
import type {
  Balance,
  ExtendedOrder,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
} from '@/extended/types';
import type { PlaceOrderParams } from '@/extended/adapter';

export interface ExtendedAccountState {
  apiKey: string;
  starkPrivateKey: string;
  starkPublicKey: string;
  vaultId: string;
}

const EMPTY_ACCOUNT: ExtendedAccountState = {
  apiKey: '',
  starkPrivateKey: '',
  starkPublicKey: '',
  vaultId: '',
};

function readEnvAccount(): Partial<ExtendedAccountState> {
  return {
    apiKey: process.env.NEXT_PUBLIC_EXTENDED_API_KEY ?? '',
    starkPrivateKey: process.env.NEXT_PUBLIC_EXTENDED_STARK_PRIVATE_KEY ?? '',
    starkPublicKey: process.env.NEXT_PUBLIC_EXTENDED_STARK_PUBLIC_KEY ?? '',
    vaultId: process.env.NEXT_PUBLIC_EXTENDED_VAULT_ID ?? '',
  };
}

export function useExtended() {
  const adapter = useMemo(() => new ExtendedAdapter(), []);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('BTC-USD');
  const [orderbook, setOrderbook] = useState<Orderbook | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  const [account, setAccount] = useState<ExtendedAccountState>(EMPTY_ACCOUNT);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<ExtendedOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<ExtendedOrder[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [lastPlacedOrder, setLastPlacedOrder] = useState<PlacedOrder | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isConnected = useMemo(
    () => account.apiKey.length > 0,
    [account.apiKey],
  );
  const canTrade = useMemo(
    () =>
      account.apiKey.length > 0 &&
      account.starkPrivateKey.length > 0 &&
      account.starkPublicKey.length > 0 &&
      account.vaultId.length > 0,
    [account],
  );

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

  const applyCredentials = useCallback(
    (creds: ExtendedAccountCredentials) => {
      adapter.connect(creds);
    },
    [adapter],
  );

  const refreshAccount = useCallback(async () => {
    if (!adapter.isConnected) return;
    setAccountLoading(true);
    setAccountError(null);
    try {
      const [bal, pos, open, history] = await Promise.allSettled([
        adapter.getBalance(),
        adapter.getPositions(),
        adapter.getOpenOrders(),
        adapter.getOrderHistory(),
      ]);
      if (bal.status === 'fulfilled') setBalance(bal.value);
      if (pos.status === 'fulfilled') setPositions(pos.value);
      if (open.status === 'fulfilled') setOpenOrders(open.value);
      if (history.status === 'fulfilled') setOrderHistory(history.value.slice(0, 20));
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Failed to load account data.');
    } finally {
      setAccountLoading(false);
    }
  }, [adapter]);

  const connect = useCallback(
    (state: ExtendedAccountState) => {
      setAccount(state);
      setAccountError(null);
      setBalance(null);
      setPositions([]);
      setOpenOrders([]);
      setOrderHistory([]);
      adapter.connect({
        apiKey: state.apiKey,
        starkPrivateKey: state.starkPrivateKey || undefined,
        starkPublicKey: state.starkPublicKey || undefined,
        vaultId: state.vaultId ? Number(state.vaultId) : undefined,
      });
      void refreshAccount();
    },
    [adapter, refreshAccount],
  );

  const disconnect = useCallback(() => {
    adapter.disconnect();
    setAccount(EMPTY_ACCOUNT);
    setBalance(null);
    setPositions([]);
    setOpenOrders([]);
    setOrderHistory([]);
  }, [adapter]);

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

  // Seed from env (convenience for the hackathon demo) without auto-connecting.
  useEffect(() => {
    const env = readEnvAccount();
    if (env.apiKey || env.starkPrivateKey || env.starkPublicKey || env.vaultId) {
      setAccount({
        apiKey: env.apiKey ?? '',
        starkPrivateKey: env.starkPrivateKey ?? '',
        starkPublicKey: env.starkPublicKey ?? '',
        vaultId: env.vaultId ?? '',
      });
    }
  }, []);

  // Load markets once.
  useEffect(() => {
    void refreshMarkets();
  }, [refreshMarkets]);

  // Poll orderbook for the selected market.
  useEffect(() => {
    void refreshOrderbook();
    const t = setInterval(refreshOrderbook, 5000);
    return () => clearInterval(t);
  }, [refreshOrderbook]);

  // Poll account data while connected.
  const accountConnectedRef = useRef(isConnected);
  accountConnectedRef.current = isConnected;
  useEffect(() => {
    if (!isConnected) return;
    const t = setInterval(refreshAccount, 10000);
    return () => clearInterval(t);
  }, [isConnected, refreshAccount]);

  return {
    adapter,
    markets,
    selectedMarket,
    setSelectedMarket,
    market,
    orderbook,
    marketsLoading,
    marketsError,
    account,
    setAccount,
    isConnected,
    canTrade,
    balance,
    positions,
    openOrders,
    orderHistory,
    accountLoading,
    accountError,
    connect,
    disconnect,
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
