/**
 * @file src/extended/adapter.ts
 * @description Client-facing adapter for the Extended Exchange integration.
 *
 * This is the single modular surface the Dapp talks to.
 *   - Public market data is fetched directly from Extended's public REST API.
 *   - Private account reads and signed orders go through the app's own server routes
 *     (`/api/extended/*`) so API keys and Stark private keys never reach the browser.
 *
 * It is deliberately kept behind a clean interface so private collateral / STRK20 bridging
 * can be layered on later without changing the UI.
 */

import { ExtendedClient } from './client';
import { getExtendedEnvironment, type ExtendedEnvironment } from './config';
import type {
  ExtendedAccountSnapshot,
  ExtendedStatus,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
} from './types';

export interface PlaceOrderParams {
  market: string;
  side: 'BUY' | 'SELL';
  qty: string;
  price: string;
  type?: 'LIMIT' | 'MARKET';
  timeInForce?: 'GTT' | 'IOC';
  reduceOnly?: boolean;
  postOnly?: boolean;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}

export class ExtendedAdapter {
  private env: ExtendedEnvironment;
  private client: ExtendedClient;

  constructor(env?: ExtendedEnvironment) {
    this.env = env ?? getExtendedEnvironment();
    this.client = new ExtendedClient({ env: this.env });
  }

  get environment(): ExtendedEnvironment {
    return this.env;
  }

  // ─── Public market data (no auth, direct) ──────────────────────────────────────

  getMarkets(): Promise<Market[]> {
    return this.client.getMarkets();
  }

  async getPerpetualMarkets(): Promise<Market[]> {
    const markets = await this.client.getMarkets();
    return markets.filter((m) => m.type === 'PERPETUAL' && m.active);
  }

  getMarket(name: string): Promise<Market> {
    return this.client.getMarket(name);
  }

  getOrderbook(name: string): Promise<Orderbook> {
    return this.client.getOrderbook(name);
  }

  // ─── Auth / private state (via server routes; no secrets client-side) ──────────

  /** Whether the server has Extended credentials configured (read / trade). */
  async getStatus(): Promise<ExtendedStatus> {
    const res = await fetch('/api/extended/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as ExtendedStatus;
  }

  /** Balance / positions / open orders / history from the server-configured account. */
  async getAccountSnapshot(): Promise<ExtendedAccountSnapshot> {
    const res = await fetch('/api/extended/account', { cache: 'no-store' });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as ExtendedAccountSnapshot;
  }

  /** Place a real signed order (signed server-side). */
  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    const res = await fetch('/api/extended/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as PlacedOrder;
  }

  async placeMarketOrder(params: Omit<PlaceOrderParams, 'type' | 'timeInForce'>): Promise<PlacedOrder> {
    return this.placeOrder({ ...params, type: 'MARKET', timeInForce: 'IOC' });
  }

  /** Close or reduce a position via a reduce-only market order on the opposite side. */
  async closePosition(position: Position, size?: string): Promise<PlacedOrder> {
    const market = await this.getMarket(position.market);
    const side = position.side === 'LONG' ? 'SELL' : 'BUY';
    const qty = size ?? position.size;
    const mark = market.marketStats.markPrice;
    return this.placeMarketOrder({
      market: position.market,
      side,
      qty,
      price: mark,
      reduceOnly: true,
    });
  }

  async cancelOrder(id: number): Promise<void> {
    const res = await fetch(`/api/extended/order?id=${id}`, { method: 'DELETE', cache: 'no-store' });
    if (!res.ok) throw new Error(await readError(res));
  }
}