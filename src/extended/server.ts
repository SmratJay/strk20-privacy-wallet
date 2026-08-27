/**
 * @file src/extended/server.ts
 * @description Server-side Extended client. This module is ONLY imported by Next.js API
 * routes (`src/app/api/extended/*`); it is never bundled into the client.
 *
 * It reads trading credentials from the SERVER environment (EXTENDED_*) and signs orders
 * with the Stark L2 private key server-side, so no private key or API credential ever
 * reaches the browser bundle.
 */

import { ExtendedClient } from './client';
import { getExtendedEnvironment } from './config';
import { buildOrderRequest } from './settlement';
import type { PlaceOrderParams } from './adapter';
import type {
  Balance,
  ExtendedAccountSnapshot,
  ExtendedOrder,
  ExtendedStatus,
  PlacedOrder,
  Position,
} from './types';

export interface ServerCredentials {
  apiKey: string | null;
  starkPrivateKey: string | null;
  starkPublicKey: string | null;
  vaultId: number | null;
}

/** Read Extended trading credentials from the server environment. */
export function getServerCredentials(): ServerCredentials {
  const apiKey = process.env.EXTENDED_API_KEY?.trim() || null;
  const starkPrivateKey = process.env.EXTENDED_STARK_PRIVATE_KEY?.trim() || null;
  const starkPublicKey = process.env.EXTENDED_STARK_PUBLIC_KEY?.trim() || null;
  const vaultRaw = process.env.EXTENDED_VAULT_ID?.trim();
  const vaultId = vaultRaw && /^\d+$/.test(vaultRaw) ? Number(vaultRaw) : null;
  return { apiKey, starkPrivateKey, starkPublicKey, vaultId };
}

export class ExtendedServerClient {
  private env = getExtendedEnvironment();
  private client: ExtendedClient;
  private creds: ServerCredentials;

  constructor(creds: ServerCredentials = getServerCredentials()) {
    this.creds = creds;
    this.client = new ExtendedClient({
      env: this.env,
      apiKey: creds.apiKey ?? undefined,
    });
  }

  get configured(): ExtendedStatus {
    return {
      read: Boolean(this.creds.apiKey),
      trade: Boolean(
        this.creds.apiKey &&
          this.creds.starkPrivateKey &&
          this.creds.starkPublicKey &&
          this.creds.vaultId !== null,
      ),
    };
  }

  // ─── Private read (API key) ────────────────────────────────────────────────────

  getBalance(): Promise<Balance> {
    return this.client.getBalance();
  }

  getPositions(): Promise<Position[]> {
    return this.client.getPositions();
  }

  getOpenOrders(): Promise<ExtendedOrder[]> {
    return this.client.getOpenOrders();
  }

  getOrderHistory(): Promise<ExtendedOrder[]> {
    return this.client.getOrderHistory();
  }

  async getAccountSnapshot(): Promise<ExtendedAccountSnapshot> {
    const [balance, positions, openOrders, history] = await Promise.allSettled([
      this.getBalance(),
      this.getPositions(),
      this.getOpenOrders(),
      this.getOrderHistory(),
    ]);
    return {
      balance: balance.status === 'fulfilled' ? balance.value : null,
      positions: positions.status === 'fulfilled' ? positions.value : [],
      openOrders: openOrders.status === 'fulfilled' ? openOrders.value : [],
      history: history.status === 'fulfilled' ? history.value.slice(0, 20) : [],
    };
  }

  // ─── Private write (API key + Stark signature) ─────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    const { apiKey, starkPrivateKey, starkPublicKey, vaultId } = this.creds;
    if (!apiKey || !starkPrivateKey || !starkPublicKey || vaultId === null) {
      throw new Error('Extended trading credentials are not configured on the server.');
    }

    const market = await this.client.getMarket(params.market);
    if (market.type !== 'PERPETUAL') {
      throw new Error(`Market ${params.market} is not a perpetual market.`);
    }

    // Order fee = max(maker, taker) from the live fee schedule (matches the official SDK).
    const fees = await this.client.getFees(params.market);
    const fee = String(
      Math.max(Number(fees[0]?.makerFeeRate ?? 0), Number(fees[0]?.takerFeeRate ?? 0)),
    );

    // Domain is fetched live (matches the official SDK's GET /info/starknet).
    const liveDomain = await this.client.getStarknetDomain();
    const domain = { ...this.env.starknetDomain, ...liveDomain };

    const body = buildOrderRequest({
      market,
      side: params.side,
      qty: params.qty,
      price: params.price,
      type: params.type ?? 'LIMIT',
      timeInForce: params.timeInForce ?? 'GTT',
      vaultId,
      privateKey: starkPrivateKey,
      publicKey: starkPublicKey,
      takerFee: fee,
      reduceOnly: params.reduceOnly,
      postOnly: params.postOnly,
      domain,
    });

    return this.client.placeOrder(body);
  }

  cancelOrder(id: number): Promise<unknown> {
    return this.client.cancelOrder(id);
  }
}