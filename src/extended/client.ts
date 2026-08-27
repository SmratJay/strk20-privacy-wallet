/**
 * @file src/extended/client.ts
 * @description Low-level REST client for the Extended Exchange API.
 *
 * Adds the required `User-Agent` and `X-Api-Key` headers and normalises the `{status, data,
 * error}` response envelope into typed results (throwing on API errors). Read-only
 * endpoints need no key; write endpoints require the API key and are signed separately.
 */

import { getExtendedEnvironment, type ExtendedEnvironment } from './config';
import type {
  ApiResponse,
  AccountInfo,
  Balance,
  ExtendedOrder,
  Leverage,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
} from './types';

export class ExtendedApiError extends Error {
  code: number | string;
  statusCode: number;
  constructor(message: string, code: number | string = 'GENERAL', statusCode = 0) {
    super(message);
    this.name = 'ExtendedApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export class ExtendedClient {
  private env: ExtendedEnvironment;
  private apiKey: string | null;

  constructor(opts?: { apiKey?: string; env?: ExtendedEnvironment }) {
    this.env = opts?.env ?? getExtendedEnvironment();
    this.apiKey = opts?.apiKey ?? null;
  }

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'orrange/0.1',
    };
    if (this.apiKey) headers['X-Api-Key'] = this.apiKey;

    const res = await fetch(`${this.env.apiBaseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    let json: ApiResponse<T> | null = null;
    try {
      json = (await res.json()) as ApiResponse<T>;
    } catch {
      // Non-JSON response.
    }

    if (!res.ok || (json && (json.status === 'ERROR' || json.status === 'error'))) {
      const code = json?.error?.code ?? res.status;
      const message = json?.error?.message ?? `Extended API error (HTTP ${res.status})`;
      throw new ExtendedApiError(message, code, res.status);
    }

    return json?.data as T;
  }

  // ─── Public market data (no auth) ──────────────────────────────────────────────

  getMarkets(markets?: string[]): Promise<Market[]> {
    const query = markets && markets.length > 0
      ? '?' + markets.map((m) => `market=${encodeURIComponent(m)}`).join('&')
      : '';
    return this.request<Market[]>(`/info/markets${query}`);
  }

  getMarket(market: string): Promise<Market> {
    return this.request<Market[]>(`/info/markets?market=${encodeURIComponent(market)}`).then(
      (list) => {
        if (!list || list.length === 0) throw new ExtendedApiError(`Market not found: ${market}`, 'MarketNotFound', 404);
        return list[0];
      },
    );
  }

  getOrderbook(market: string): Promise<Orderbook> {
    return this.request<Orderbook>(`/info/markets/${encodeURIComponent(market)}/orderbook`);
  }

  getMarketStats(market: string): Promise<Market['marketStats']> {
    return this.request<Market['marketStats']>(`/info/markets/${encodeURIComponent(market)}/stats`);
  }

  // ─── Private read-only (API key) ───────────────────────────────────────────────

  getAccountInfo(): Promise<AccountInfo> {
    return this.request<AccountInfo>('/user/account/info');
  }

  getBalance(): Promise<Balance> {
    return this.request<Balance>('/user/balance');
  }

  getPositions(): Promise<Position[]> {
    return this.request<Position[]>('/user/positions');
  }

  getOpenOrders(): Promise<ExtendedOrder[]> {
    return this.request<ExtendedOrder[]>('/user/orders');
  }

  getOrderHistory(): Promise<ExtendedOrder[]> {
    return this.request<ExtendedOrder[]>('/user/orders/history');
  }

  getLeverage(market: string): Promise<Leverage> {
    return this.request<Leverage>(`/user/leverage?market=${encodeURIComponent(market)}`);
  }

  // ─── Private write (API key + Stark signature in body) ─────────────────────────

  placeOrder(body: Record<string, unknown>): Promise<PlacedOrder> {
    return this.request<PlacedOrder>('/user/order', { method: 'POST', body });
  }

  cancelOrder(id: number): Promise<unknown> {
    return this.request<unknown>(`/user/order/${id}`, { method: 'DELETE' });
  }

  updateLeverage(market: string, leverage: string): Promise<Leverage> {
    return this.request<Leverage>('/user/leverage', { method: 'PATCH', body: { market, leverage } });
  }
}
