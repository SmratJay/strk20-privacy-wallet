/**
 * @file src/extended/adapter.ts
 * @description High-level adapter for the Extended Exchange integration.
 *
 * This is the single modular surface the Dapp talks to. It wraps the REST client and the
 * settlement/onboarding signing so the UI never touches crypto or HTTP details. It is
 * deliberately kept behind a clean interface so private collateral / STRK20 bridging can be
 * layered on later without changing the UI.
 */

import { ExtendedClient } from './client';
import { getExtendedEnvironment, type ExtendedEnvironment } from './config';
import { buildOrderRequest, generateNonce } from './settlement';
import type {
  AccountInfo,
  Balance,
  ExtendedOrder,
  Leverage,
  Market,
  Orderbook,
  PlacedOrder,
  Position,
} from './types';

export interface ExtendedAccountCredentials {
  apiKey: string;
  starkPrivateKey?: string;
  starkPublicKey?: string;
  vaultId?: number;
}

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

export class ExtendedAdapter {
  private env: ExtendedEnvironment;
  private client: ExtendedClient;
  private credentials: ExtendedAccountCredentials | null = null;

  constructor(env?: ExtendedEnvironment) {
    this.env = env ?? getExtendedEnvironment();
    this.client = new ExtendedClient({ env: this.env });
  }

  get environment(): ExtendedEnvironment {
    return this.env;
  }

  /** Attach trading credentials (API key for reads; keys + vault for writes). */
  connect(credentials: ExtendedAccountCredentials): void {
    this.credentials = credentials;
    this.client.setApiKey(credentials.apiKey);
  }

  disconnect(): void {
    this.credentials = null;
    this.client.setApiKey(null);
  }

  get isConnected(): boolean {
    return this.credentials !== null;
  }

  /** True when reads (balance/positions/orders) are possible. */
  get canRead(): boolean {
    return Boolean(this.credentials?.apiKey);
  }

  /** True when writes (place/cancel orders) are possible. */
  get canTrade(): boolean {
    const c = this.credentials;
    return Boolean(c?.apiKey && c?.starkPrivateKey && c?.starkPublicKey && c?.vaultId !== undefined);
  }

  private requireRead(): ExtendedAccountCredentials {
    if (!this.canRead) {
      throw new Error('No Extended API key. Connect your Extended account to read balances and positions.');
    }
    return this.credentials!;
  }

  private requireTrade(): ExtendedAccountCredentials {
    if (!this.canTrade) {
      throw new Error(
        'Extended trading is not configured. Provide an API key, Stark private/public key, and vault id.',
      );
    }
    return this.credentials!;
  }

  // ─── Public market data ─────────────────────────────────────────────────────────

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

  async getMarkPrice(name: string): Promise<string> {
    const market = await this.client.getMarket(name);
    return market.marketStats.markPrice;
  }

  // ─── Private read ───────────────────────────────────────────────────────────────

  getAccountInfo(): Promise<AccountInfo> {
    this.requireRead();
    return this.client.getAccountInfo();
  }

  getBalance(): Promise<Balance> {
    this.requireRead();
    return this.client.getBalance();
  }

  getPositions(): Promise<Position[]> {
    this.requireRead();
    return this.client.getPositions();
  }

  getOpenOrders(): Promise<ExtendedOrder[]> {
    this.requireRead();
    return this.client.getOpenOrders();
  }

  getOrderHistory(): Promise<ExtendedOrder[]> {
    this.requireRead();
    return this.client.getOrderHistory();
  }

  getLeverage(market: string): Promise<Leverage> {
    this.requireRead();
    return this.client.getLeverage(market);
  }

  // ─── Private write ──────────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    const creds = this.requireTrade();
    const market = await this.getMarket(params.market);
    if (market.type !== 'PERPETUAL') {
      throw new Error(`Market ${params.market} is not a perpetual market.`);
    }

    const body = buildOrderRequest({
      market,
      side: params.side,
      qty: params.qty,
      price: params.price,
      type: params.type ?? 'LIMIT',
      timeInForce: params.timeInForce ?? 'GTT',
      vaultId: creds.vaultId!,
      privateKey: creds.starkPrivateKey!,
      publicKey: creds.starkPublicKey!,
      reduceOnly: params.reduceOnly,
      postOnly: params.postOnly,
      domain: this.env.starknetDomain,
    });

    return this.client.placeOrder(body);
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

  cancelOrder(id: number): Promise<unknown> {
    this.requireTrade();
    return this.client.cancelOrder(id);
  }

  updateLeverage(market: string, leverage: string): Promise<Leverage> {
    this.requireTrade();
    return this.client.updateLeverage(market, leverage);
  }

  /** Generate a fresh order nonce (used for idempotency bookkeeping). */
  newNonce(): number {
    return generateNonce();
  }
}
