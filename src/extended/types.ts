/**
 * @file src/extended/types.ts
 * @description Typed shapes for the Extended Exchange REST API (public + private).
 *
 * Field names mirror the official API response/request schemas exactly. Amounts are
 * decimal strings; IDs/timestamps are numbers. See https://api.docs.extended.exchange/.
 */

export type MarketStatus = 'ACTIVE' | 'REDUCE_ONLY' | 'DELISTED' | 'PRELISTED' | 'DISABLED';
export type MarketType = 'PERPETUAL' | 'SPOT';
export type OrderSide = 'BUY' | 'SELL';
export type PositionSide = 'LONG' | 'SHORT';
export type OrderType = 'LIMIT' | 'MARKET' | 'CONDITIONAL' | 'TPSL' | 'TWAP';
export type TimeInForce = 'GTT' | 'IOC';

export interface MarketStats {
  dailyVolume: string;
  dailyVolumeBase: string;
  dailyPriceChange: string;
  dailyPriceChangePercentage: string;
  dailyLow: string;
  dailyHigh: string;
  lastPrice: string;
  askPrice: string;
  bidPrice: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingRate: number;
  openInterest: string;
  openInterestBase: string;
}

export interface TradingConfig {
  minOrderSize: string;
  minOrderSizeChange: string;
  minPriceChange: string;
  maxMarketOrderValue: string;
  maxLimitOrderValue: string;
  maxPositionValue: string;
  maxLeverage: string;
  maxNumOrders: string;
  openInterestLimit: string;
  limitPriceCap: string;
  limitPriceFloor: string;
  hourlyFundingRateCap: string;
}

export interface L2Config {
  type: 'STARKX';
  collateralId: string;
  collateralResolution: number;
  syntheticId: string;
  syntheticResolution: number;
}

export interface Market {
  name: string;
  type: MarketType;
  assetName: string;
  assetPrecision: number;
  collateralAssetName: string;
  collateralAssetPrecision: number;
  active: boolean;
  status: MarketStatus;
  isRfq: boolean;
  isOffHours: boolean;
  marketStats: MarketStats;
  tradingConfig: TradingConfig;
  l2Config: L2Config;
}

export interface OrderbookLevel {
  qty: string;
  price: string;
}

export interface Orderbook {
  market: string;
  bid: OrderbookLevel[];
  ask: OrderbookLevel[];
}

export interface Balance {
  collateralName: string;
  balance: string;
  equity: string;
  availableForTrade: string;
  availableForWithdrawal: string;
  unrealisedPnl: string;
  withdrawableUnrealisedPnl: string;
  initialMargin: string;
  marginRatio: string;
  exposure: string;
  leverage: string;
}

export interface Position {
  id: number;
  accountId: number;
  market: string;
  side: PositionSide;
  leverage: string;
  size: string;
  value: string;
  openPrice: string;
  markPrice: string;
  liquidationPrice: string;
  margin: string;
  unrealisedPnl: string;
  realisedPnl: string;
  paidFundingFee: string;
  tpTriggerPrice?: string;
  tpLimitPrice?: string;
  slTriggerPrice?: string;
  slLimitPrice?: string;
  maxPositionSize: string;
  adl: string;
  createdTime: number;
  updatedTime: number;
}

export type OrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'UNTRIGGERED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'TRIGGERED';

export interface ExtendedOrder {
  id: number;
  externalId: string;
  accountId: number;
  market: string;
  status: OrderStatus;
  statusReason?: string;
  type: OrderType;
  side: OrderSide;
  price?: string;
  averagePrice?: string;
  qty: string;
  filledQty?: string;
  payedFee?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  createdTime: number;
  updatedTime: number;
  timeInForce: TimeInForce;
  expireTime: number;
}

export interface AccountInfo {
  status: string;
  l2Key: string;
  l2Vault: number;
  accountId: number;
  description?: string;
  bridgeStarknetAddress: string;
}

export interface ApiResponse<T> {
  status: 'OK' | 'ERROR' | 'ok' | 'error';
  data: T;
  error?: { code: number | string; message: string };
  pagination?: { cursor: number; count: number };
}

export interface PlacedOrder {
  id: number;
  externalId: string;
}

export interface Leverage {
  market: string;
  leverage: string;
}

export interface Fees {
  market: string;
  makerFeeRate: string;
  takerFeeRate: string;
  builderFeeRate: string;
}

export interface StarknetDomainInfo {
  name: string;
  version: string;
  chainId: string;
  revision: number;
}

/** Server-side auth/status report (never carries secrets). */
export interface ExtendedStatus {
  read: boolean;
  trade: boolean;
}

/** Snapshot returned by the server account route. */
export interface ExtendedAccountSnapshot {
  balance: Balance | null;
  positions: Position[];
  openOrders: ExtendedOrder[];
  history: ExtendedOrder[];
}

// ─── Public market data (candles / trades / assets) ──────────────────────────────

/** OHLCV candle as returned by GET /info/candles/{market}/trades. */
export interface Candle {
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  T: number;
}

export type CandleType = 'trades' | 'mark-prices' | 'index-prices';

/** Public trade as returned by GET /info/markets/{market}/trades. */
export interface PublicTrade {
  i: number;
  m: string;
  S: OrderSide;
  tT: 'TRADE' | 'LIQUIDATION' | 'DELEVERAGE';
  T: number;
  p: string;
  q: string;
}

export interface AssetInfo {
  id: number;
  name: string;
  symbol: string;
  description?: string;
  precision: number;
  isActive: boolean;
  isCollateral: boolean;
  type: MarketType;
  canBeUsedAsCollateral?: boolean;
  starkexId: string;
  starkexResolution: number;
  l1Id?: string;
  l1Resolution?: number;
  riskFactors?: { upperBound: string; riskFactor: string }[];
  availableForTradeFactors?: { upperBound: string; riskFactor: string }[];
}

// ─── Deposits / withdrawals / transfers ──────────────────────────────────────────

export type DepositStatus = 'CREATED' | 'PROCESSED' | 'REJECTED' | 'PENDING' | 'SUCCESS' | 'FAILED';

export interface Deposit {
  id?: number;
  amount: string;
  assetId?: number;
  asset?: string;
  status: DepositStatus | string;
  timestamp?: number;
  transactionHash?: string;
}

export interface Withdrawal {
  id: number;
  status: string;
  amount: string;
  asset: string;
  recipient?: string;
  createdAt?: number;
  transactionHash?: string;
}

// ─── WebSocket stream messages ───────────────────────────────────────────────────

export interface OrderbookLevelWS {
  p: string;
  q: string;
  c?: string;
}

export interface OrderbookStreamMessage {
  ts: number;
  type: 'SNAPSHOT' | 'DELTA';
  data: { m: string; t?: 'SNAPSHOT' | 'DELTA'; b: OrderbookLevelWS[]; a: OrderbookLevelWS[] };
  seq: number;
}

export interface TradesStreamMessage {
  ts: number;
  data: PublicTrade[];
  seq: number;
}

export interface MarkPriceStreamMessage {
  ts: number;
  data: { m: string; p: string; T: number };
  seq: number;
}

export interface CandleStreamMessage {
  ts: number;
  data: Candle;
  seq: number;
}

/** On-chain deposit execution requirements for the connected wallet. */
export interface DepositCalldata {
  /** ERC-20 approve(spender=depositContract, amount) call. */
  approve: { contractAddress: string; calldata: string[]; entrypoint: string };
  /** Core perpetuals deposit(position_id, quantized_amount, salt) call. */
  deposit: { contractAddress: string; calldata: string[]; entrypoint: string };
  /** Raw Starknet units (quantized amount). */
  quantizedAmount: string;
  /** Human amount. */
  amount: string;
  salt: string;
  positionId: string;
}
