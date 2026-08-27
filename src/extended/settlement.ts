/**
 * @file src/extended/settlement.ts
 * @description Builds and signs Extended order settlements (StarkEx "Order" message).
 *
 * This is a TypeScript port of the official SDK's `order_object.py` /
 * `order_object_settlement.py`. The signed message hash is verified against the official
 * Rust reference vector (see src/__tests__/extendedSettlement.test.ts).
 */

import type { ExtendedStarknetDomain } from './crypto';
import { orderMessageHash, starkSign } from './crypto';
import { addDec, mulDec, mulDecInt, roundToInt } from './amount';
import type { Market, OrderSide, TimeInForce } from './types';

/** Settlement expiration buffer, in days (matches the official SDK). */
const SETTLEMENT_EXPIRATION_BUFFER_DAYS = 14;

export interface OrderSettlementInput {
  market: Market;
  side: OrderSide;
  qty: string;
  price: string;
  takerFee?: string;
  builderFee?: string;
  vaultId: number;
  privateKey: string; // 0x hex
  publicKey: string; // 0x hex
  nonce: number;
  expireTimeMs: number;
  domain: ExtendedStarknetDomain;
}

export interface OrderSettlementResult {
  orderHash: bigint;
  settlement: {
    signature: { r: string; s: string };
    starkKey: string;
    collateralPosition: string;
  };
  /** Signed Stark quantities (for debugging). */
  baseAmount: bigint;
  quoteAmount: bigint;
  feeAmount: bigint;
  syntheticQty: string;
}

/** Compute the settlement expiration timestamp (epoch seconds) for a given order expiry. */
export function settlementExpiration(expireTimeMs: number): bigint {
  const bufferedMs =
    BigInt(expireTimeMs) + BigInt(SETTLEMENT_EXPIRATION_BUFFER_DAYS) * 86_400_000n;
  const seconds = (bufferedMs + 999n) / 1000n; // ceil to seconds
  return seconds;
}

/** Generate a random nonce in [1, 2^31] (matching the SDK's `generate_nonce`). */
export function generateNonce(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0xffffffff);
  }
  return (buf[0] % 2_147_483_647) + 1;
}

/** Build and sign an order settlement. */
export function buildOrderSettlement(input: OrderSettlementInput): OrderSettlementResult {
  const { market, side, qty, price, vaultId, privateKey, publicKey, nonce, expireTimeMs, domain } =
    input;
  const isBuy = side === 'BUY';
  const takerFee = input.takerFee ?? '0.0005';
  const builderFee = input.builderFee ?? '0';

  const { syntheticResolution, collateralResolution, syntheticId, collateralId } = market.l2Config;

  // Human-readable notional (collateral value).
  const notional = mulDec(qty, price);

  // Stark quantities (rounded: BUY up, SELL down; fees always up).
  const baseAmount = roundToInt(mulDecInt(qty, syntheticResolution), isBuy ? 'UP' : 'DOWN');
  const quoteAmount = roundToInt(
    mulDecInt(notional, collateralResolution),
    isBuy ? 'UP' : 'DOWN',
  );
  const feeAmount = roundToInt(
    mulDecInt(mulDec(addDec(takerFee, builderFee), notional), collateralResolution),
    'UP',
  );

  // Sign: a BUY pays collateral (negative quote); a SELL pays synthetic (negative base).
  const signedBase = isBuy ? baseAmount : -baseAmount;
  const signedQuote = isBuy ? -quoteAmount : quoteAmount;

  const expiration = settlementExpiration(expireTimeMs);

  const orderHash = orderMessageHash(
    {
      positionId: vaultId,
      baseAssetId: syntheticId,
      baseAmount: signedBase,
      quoteAssetId: collateralId,
      quoteAmount: signedQuote,
      feeAssetId: collateralId,
      feeAmount,
      expiration,
      salt: BigInt(nonce),
    },
    publicKey,
    domain,
  );

  const { r, s } = starkSign(orderHash, privateKey);

  return {
    orderHash,
    settlement: {
      signature: { r, s },
      starkKey: publicKey,
      collateralPosition: String(vaultId),
    },
    baseAmount: signedBase,
    quoteAmount: signedQuote,
    feeAmount,
    syntheticQty: qty,
  };
}

export interface OrderRequestParams {
  market: Market;
  side: OrderSide;
  qty: string;
  price: string;
  type: 'LIMIT' | 'MARKET';
  timeInForce: TimeInForce;
  vaultId: number;
  privateKey: string;
  publicKey: string;
  takerFee?: string;
  nonce?: number;
  expireTimeMs?: number;
  externalId?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  domain: ExtendedStarknetDomain;
}

/** Build the complete `POST /api/v1/user/order` request body (signed). */
export function buildOrderRequest(params: OrderRequestParams): Record<string, unknown> {
  const nonce = params.nonce ?? generateNonce();
  const expireTimeMs = params.expireTimeMs ?? Date.now() + 60 * 60 * 1000; // default 1h
  const takerFee = params.takerFee ?? '0.0005';

  const settlement = buildOrderSettlement({
    market: params.market,
    side: params.side,
    qty: params.qty,
    price: params.price,
    takerFee,
    vaultId: params.vaultId,
    privateKey: params.privateKey,
    publicKey: params.publicKey,
    nonce,
    expireTimeMs,
    domain: params.domain,
  });

  const externalId =
    params.externalId ??
    '0x' + settlement.orderHash.toString(16).padStart(64, '0');

  return {
    id: externalId,
    market: params.market.name,
    type: params.type,
    side: params.side,
    qty: params.qty,
    price: params.price,
    timeInForce: params.timeInForce,
    expiryEpochMillis: expireTimeMs,
    fee: takerFee,
    nonce: String(nonce),
    settlement: settlement.settlement,
    reduceOnly: params.reduceOnly ?? false,
    postOnly: params.postOnly ?? false,
    selfTradeProtectionLevel: 'ACCOUNT',
  };
}
