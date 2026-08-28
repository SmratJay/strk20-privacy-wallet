/**
 * @file src/extended/adapter.ts
 * @description Client-facing adapter for the Extended Exchange integration.
 *
 * This is the single modular surface the Dapp talks to.
 *   - Public market data (markets, orderbook, candles, trades) is fetched directly
 *     from Extended's public REST API.
 *   - Private account reads, signed orders and withdrawals go through the app's own
 *     server routes (`/api/extended/*`) so API keys and Stark private keys never reach
 *     the browser.
 *
 * A natively onboarded Starknet wallet is tied to a server-side session token
 * (stored in localStorage). The token is sent with every private request; the server
 * derives the L2 key and signs writes server-side.
 */

import { ExtendedClient } from './client';
import { getExtendedEnvironment, type ExtendedEnvironment } from './config';
import type {
  Candle,
  CandleType,
  Deposit,
  ExtendedAccountSnapshot,
  ExtendedOrder,
  ExtendedStatus,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
  PublicTrade,
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

export interface ExtendedStatusResult {
  read: boolean;
  trade: boolean;
  /** True when a stale/expired session token was detected server-side. */
  sessionExpired?: boolean;
  session?: {
    wallet: string;
    read: boolean;
    trade: boolean;
    accountId?: number | null;
    vaultId?: number | null;
  } | null;
}

export interface WalletDeploymentResult {
  deployed: boolean;
  classHash?: string;
  unknown?: boolean;
  rpcError?: string;
}

const SESSION_STORAGE_KEY = 'extended_session_token';
const SESSION_WALLET_KEY = 'extended_session_wallet';

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
  private _sessionToken: string | null;

  constructor(env?: ExtendedEnvironment) {
    this.env = env ?? getExtendedEnvironment();
    this.client = new ExtendedClient({ env: this.env });
    if (typeof localStorage !== 'undefined') {
      this._sessionToken = localStorage.getItem(SESSION_STORAGE_KEY);
    } else {
      this._sessionToken = null;
    }
  }

  get environment(): ExtendedEnvironment {
    return this.env;
  }

  /** The current server-side session token (or null). */
  get sessionToken(): string | null {
    return this._sessionToken;
  }

  /** The wallet address that owns the current server-side session, if any. */
  get sessionWallet(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SESSION_WALLET_KEY);
  }

  /** True when a server-side session token is stored locally. */
  get hasStoredSession(): boolean {
    return Boolean(this._sessionToken);
  }

  setSession(session: { token: string; wallet: string } | null): void {
    this._sessionToken = session?.token ?? null;
    if (typeof localStorage === 'undefined') return;
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, session.token);
      localStorage.setItem(SESSION_WALLET_KEY, session.wallet);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(SESSION_WALLET_KEY);
    }
  }

  clearSession(): void {
    this.setSession(null);
  }

  private async privateRequest<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this._sessionToken) headers['X-Extended-Session'] = this._sessionToken;
    const res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as T;
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

  getCandles(market: string, type: CandleType = 'trades', interval = '1m', limit = 400): Promise<Candle[]> {
    return this.client.getCandles(market, type, interval, limit);
  }

  getTrades(market: string): Promise<PublicTrade[]> {
    return this.client.getTrades(market);
  }

  // ─── Auth / private state (via server routes; no secrets client-side) ──────────

  /** Whether the server has Extended credentials configured (read / trade). */
  async getStatus(): Promise<ExtendedStatusResult> {
    const res = await fetch('/api/extended/status', {
      cache: 'no-store',
      headers: this.sessionToken ? { 'X-Extended-Session': this.sessionToken } : undefined,
    });
    if (!res.ok) throw new Error(await readError(res));
    const result = (await res.json()) as ExtendedStatusResult;
    // A stale token server-side means the local session is no longer valid — clear it so
    // the app re-enters the "Connect to Extended" flow instead of a broken silent state.
    if (result.sessionExpired) this.clearSession();
    return result;
  }

  /** Whether the connected Starknet wallet is deployed on Mainnet (server-side RPC). */
  async checkWalletDeployment(address: string): Promise<WalletDeploymentResult> {
    const res = await fetch(
      `/api/extended/wallet/status?address=${encodeURIComponent(address)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as WalletDeploymentResult;
  }

  /** Balance / positions / open orders / history from the active account. */
  async getAccountSnapshot(): Promise<ExtendedAccountSnapshot> {
    return this.privateRequest<ExtendedAccountSnapshot>('/api/extended/account');
  }

  /** Account info (accountId / l2Vault / bridge address) for the active account. */
  async getAccountInfo(): Promise<{ accountId: number; l2Vault: number; bridgeStarknetAddress: string }> {
    return this.privateRequest<{ accountId: number; l2Vault: number; bridgeStarknetAddress: string }>(
      '/api/extended/account/info',
    );
  }

  /** Deposit history for the active account. */
  async getDeposits(): Promise<Deposit[]> {
    return this.privateRequest<Deposit[]>('/api/extended/deposits');
  }

  /** Place a real signed order (signed server-side). */
  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    return this.privateRequest<PlacedOrder>('/api/extended/order', { method: 'POST', body: params });
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
    await this.privateRequest(`/api/extended/order?id=${id}`, { method: 'DELETE' });
  }

  /** Set leverage for a market (signed server-side). */
  async setLeverage(market: string, leverage: string): Promise<unknown> {
    return this.privateRequest('/api/extended/leverage', { method: 'PATCH', body: { market, leverage } });
  }

  /** Create a Starknet withdrawal (signed server-side with the session L2 key). */
  async withdraw(params: { amount: string; asset?: string }): Promise<{ id: number }> {
    return this.privateRequest<{ id: number }>('/api/extended/withdraw', { method: 'POST', body: params });
  }

  // ─── Native Starknet wallet onboarding ─────────────────────────────────────────

  /**
   * Natively onboard a connected Starknet wallet to Extended. The wallet signs SNIP-12
   * "AccountCreation" + "AccountRegistration" typed data in the browser; the signatures
   * are sent to our server which derives the L2 key server-side and registers with
   * `/auth/register`. The L2 private key never leaves the server.
   */
  async onboardStarknet(params: {
    wallet: string;
    accountCreationSig: { r: string; s: string };
    accountRegistrationSig: { r: string; s: string };
    time?: string;
    referralCode?: string | null;
  }): Promise<{ token: string; status: string; wallet: string; accountId?: number; vaultId?: number }> {
    const res = await fetch('/api/extended/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(await readError(res));
    const result = (await res.json()) as { token: string; status: string; wallet: string; accountId?: number; vaultId?: number };
    if (result.token) this.setSession({ token: result.token, wallet: result.wallet });
    return result;
  }
}