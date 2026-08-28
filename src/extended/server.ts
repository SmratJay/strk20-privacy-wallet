/**
 * @file src/extended/server.ts
 * @description Server-side Extended client. This module is ONLY imported by Next.js API
 * routes (`src/app/api/extended/*`); it is never bundled into the client.
 *
 * It authenticates in one of two modes:
 *   - Env-credential mode: reads EXTENDED_API_KEY / EXTENDED_STARK_PRIVATE_KEY /
 *     EXTENDED_STARK_PUBLIC_KEY / EXTENDED_VAULT_ID from the server environment
 *     (provisioned via the Extended API-management page).
 *   - Session mode: a natively onboarded Starknet wallet session (L2 key derived
 *     server-side + Extended auth cookies) — see src/extended/session.ts.
 *
 * Orders and withdrawals are always signed with the Stark L2 key server-side, so no
 * private key or API credential ever reaches the browser bundle.
 */

import type { NextRequest } from 'next/server';
import { ExtendedClient } from './client';
import { getExtendedEnvironment } from './config';
import { buildOrderRequest } from './settlement';
import { buildWithdrawalRequest } from './withdrawal';
import { getExtendedSession } from './session';
import type { PlaceOrderParams } from './adapter';
import type { ExtendedSession } from './session';
import type {
  Balance,
  Deposit,
  ExtendedAccountSnapshot,
  ExtendedOrder,
  ExtendedStatus,
  PlacedOrder,
  Position,
  Leverage,
} from './types';

export interface ServerCredentials {
  apiKey: string | null;
  starkPrivateKey: string | null;
  starkPublicKey: string | null;
  vaultId: number | null;
  accountId: number | null;
  cookies: string[];
}

/** Read Extended trading credentials from the server environment. */
export function getServerCredentials(): ServerCredentials {
  const apiKey = process.env.EXTENDED_API_KEY?.trim() || null;
  const starkPrivateKey = process.env.EXTENDED_STARK_PRIVATE_KEY?.trim() || null;
  const starkPublicKey = process.env.EXTENDED_STARK_PUBLIC_KEY?.trim() || null;
  const vaultRaw = process.env.EXTENDED_VAULT_ID?.trim();
  const vaultId = vaultRaw && /^\d+$/.test(vaultRaw) ? Number(vaultRaw) : null;
  const accountRaw = process.env.EXTENDED_ACCOUNT_ID?.trim();
  const accountId = accountRaw && /^\d+$/.test(accountRaw) ? Number(accountRaw) : null;
  return { apiKey, starkPrivateKey, starkPublicKey, vaultId, accountId, cookies: [] };
}

/** Resolve server credentials from a natively onboarded session. */
export function credentialsFromSession(session: ExtendedSession | null | undefined): ServerCredentials | null {
  if (!session) return null;
  const l2 = session.l2Key;
  if (!l2?.privateKey || !l2?.publicKey) return null;
  return {
    apiKey: null, // session auth uses cookies, not the API key
    starkPrivateKey: l2.privateKey,
    starkPublicKey: l2.publicKey,
    vaultId: session.vaultId ?? null,
    accountId: session.accountId ?? null,
    cookies: session.cookies ?? [],
  };
}

/** Session header name sent by the client adapter. */
export const SESSION_HEADER = 'x-extended-session';

/** Resolve the active session for an incoming request (or null). */
export function sessionFromRequest(req: NextRequest): ExtendedSession | null {
  const token = req.headers.get(SESSION_HEADER);
  if (!token) return null;
  return getExtendedSession(token);
}

/** Build the server client for a request: session-first, env-credentials fallback. */
export function serverClientForRequest(req: NextRequest): ExtendedServerClient {
  const session = sessionFromRequest(req);
  if (session) {
    const creds = credentialsFromSession(session);
    if (creds) return new ExtendedServerClient(creds);
  }
  return new ExtendedServerClient(getServerCredentials());
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
      cookies: creds.cookies,
    });
  }

  get configured(): ExtendedStatus {
    const sessionMode = this.creds.cookies.length > 0 && Boolean(this.creds.starkPrivateKey);
    const apiMode = Boolean(this.creds.apiKey);
    return {
      read: sessionMode || apiMode,
      trade: (sessionMode || apiMode) && Boolean(
        this.creds.starkPrivateKey &&
        this.creds.starkPublicKey &&
        this.creds.vaultId !== null,
      ),
    };
  }

  get isSessionMode(): boolean {
    return this.creds.cookies.length > 0;
  }

  get vaultId(): number | null {
    return this.creds.vaultId;
  }

  get accountId(): number | null {
    return this.creds.accountId;
  }

  // ─── Private read ────────────────────────────────────────────────────────────

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

  getDeposits(): Promise<Deposit[]> {
    return this.client.getDeposits();
  }

  getAccountInfo(): Promise<{ accountId: number; l2Vault: number; bridgeStarknetAddress: string; l2Key: string }> {
    return this.client.getAccountInfo();
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

  // ─── Private write (API key or session cookies + Stark signature) ─────────────

  async placeOrder(params: PlaceOrderParams): Promise<PlacedOrder> {
    const { apiKey, starkPrivateKey, starkPublicKey, vaultId } = this.creds;
    if (!starkPrivateKey || !starkPublicKey || vaultId === null) {
      throw new Error('Extended trading credentials are not configured on the server.');
    }
    if (!this.isSessionMode && !apiKey) {
      throw new Error('Extended API key is not configured on the server.');
    }

    const market = await this.client.getMarket(params.market);
    if (market.type !== 'PERPETUAL' && market.type !== 'SPOT') {
      throw new Error(`Market ${params.market} is not tradable.`);
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

  /** Set leverage for a market. */
  updateLeverage(market: string, leverage: string): Promise<Leverage> {
    return this.client.updateLeverage(market, leverage);
  }

  /** Read the current leverage for a market. */
  getLeverage(market: string): Promise<Leverage> {
    return this.client.getLeverage(market);
  }

  /** Create a Starknet withdrawal, signed with the L2 key server-side. */
  async createWithdrawal(params: { amount: string; asset?: string }): Promise<{ id: number }> {
    const { starkPrivateKey, starkPublicKey, vaultId, accountId } = this.creds;
    if (!starkPrivateKey || !starkPublicKey || vaultId === null) {
      throw new Error('Extended trading credentials are not configured on the server.');
    }
    const domain = await this.client.getStarknetDomain();
    const body = buildWithdrawalRequest({
      amount: params.amount,
      asset: params.asset ?? 'USD',
      vaultId,
      privateKey: starkPrivateKey,
      publicKey: starkPublicKey,
      accountId: accountId ?? vaultId,
      domain: { ...this.env.starknetDomain, ...domain },
      expirationSeconds: undefined,
      salt: undefined,
      recipient: undefined,
    });
    return this.client.createWithdrawal(body);
  }
}