/**
 * @file src/extended/client.ts
 * @description Low-level REST client for the Extended Exchange API.
 *
 * Adds the required `User-Agent` and `X-Api-Key` headers and normalises the `{status, data,
 * error}` response envelope into typed results (throwing on API errors). Read-only
 * endpoints need no key; write endpoints require the API key and are signed separately.
 */

import { getExtendedEnvironment, streamUrl, type ExtendedEnvironment } from './config';
import type {
  ApiResponse,
  AccountInfo,
  AssetInfo,
  Balance,
  Candle,
  CandleType,
  Deposit,
  ExtendedOrder,
  Fees,
  Leverage,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
  PublicTrade,
  StarknetDomainInfo,
  Withdrawal,
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
  private cookies: string[];

  constructor(opts?: { apiKey?: string; env?: ExtendedEnvironment; cookies?: string[] }) {
    this.env = opts?.env ?? getExtendedEnvironment();
    this.apiKey = opts?.apiKey ?? null;
    this.cookies = opts?.cookies ?? [];
  }

  setApiKey(apiKey: string | null): void {
    this.apiKey = apiKey;
  }

  setCookies(cookies: string[]): void {
    this.cookies = cookies;
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'orrange/0.1',
    };
    if (this.apiKey) headers['X-Api-Key'] = this.apiKey;
    if (this.cookies.length > 0) headers['Cookie'] = this.cookies.join('; ');

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

  /** Current SNIP-12 StarkNet domain (fetched live, matches the official SDK). */
  getStarknetDomain(): Promise<StarknetDomainInfo> {
    return this.request<StarknetDomainInfo>('/info/starknet');
  }

  /** All registered assets (collateral + spot/perpetual), including StarkEx ids. */
  getAssets(): Promise<AssetInfo[]> {
    return this.request<AssetInfo[]>('/info/assets');
  }

  /** Public settings — includes the on-chain deposit contract address. */
  getSettings(): Promise<{ starknetContractAddress?: string }> {
    return this.request<{ starknetContractAddress?: string }>('/info/settings');
  }

  /** OHLCV candle history for a market. interval: 1m/5m/15m/1h/4h/1d; limit ≤ 10_000. */
  getCandles(market: string, candleType: CandleType = 'trades', interval = '1m', limit = 500): Promise<Candle[]> {
    return this.request<Candle[]>(
      `/info/candles/${encodeURIComponent(market)}/${candleType}?interval=${encodeURIComponent(interval)}&limit=${limit}`,
    );
  }

  /** Latest public trades for a market. */
  getTrades(market: string): Promise<PublicTrade[]> {
    return this.request<PublicTrade[]>(`/info/markets/${encodeURIComponent(market)}/trades`);
  }

  /** Build a public WebSocket stream URL (orderbooks/{m}, publicTrades/{m}, …). */
  streamUrl(path: string): string {
    return streamUrl(path, this.env);
  }

  // ─── Private read-only (API key) ───────────────────────────────────────────────

  getFees(market: string): Promise<Fees[]> {
    return this.request<Fees[]>(`/user/fees?market=${encodeURIComponent(market)}`);
  }

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

  /** Deposit / withdrawal / transfer history for the account. */
  getDeposits(): Promise<Deposit[]> {
    return this.request<Deposit[]>('/user/deposits');
  }

  /** Withdraw (Starknet) — signed server-side; body includes the settlement signature. */
  createWithdrawal(body: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>('/user/withdrawal', { method: 'POST', body });
  }

  /** Transfer between sub-accounts — signed server-side. */
  createTransfer(body: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>('/user/transfer', { method: 'POST', body });
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
