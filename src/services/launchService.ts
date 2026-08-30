/**
 * @file src/services/launchService.ts
 * @description ORRANGE LAUNCHPAD V2 on-chain reads + PUBLIC execution against the canonical
 * BondingCurve V2. All reads go straight to Starknet RPC (never local mocks); settlement
 * math is on-chain only. Public trades use plain ERC20 calls; private trades live in
 * privateLaunchService. Sepolia only.
 */
import { RpcProvider, hash, num, CallData, shortString } from 'starknet';
import { getNetworkConfig, NetworkId } from '@/config/networks';
import {
  LaunchTokenEntry,
  getLaunchNetwork,
  isTokenLive,
  LAUNCH_METADATA_REF,
  DEFAULT_PARAMS,
  LaunchCurveParams,
} from '@/config/launch';
import { parseTokenAmount } from '@/utils/formatters';

const ONE = 10n ** 18n;

export type ExploreSortMode = 'newest' | 'trending' | 'recent' | 'graduation' | 'graduated';

export interface CurveState {
  virtualBase: bigint;
  virtualToken: bigint;
  baseReserve: bigint; // real STRK in the curve
  tokenReserve: bigint; // real tokens sold outstanding (circulating)
  graduationTarget: bigint;
  graduated: boolean;
  feeBps: bigint;
  creatorFeeBps: bigint;
  protocolFeeBps: bigint;
  maxTradeBps: bigint;
  /** price = baseReserveTotal / tokenReserveTotal as (base, token) */
  priceBase: bigint;
  priceToken: bigint;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator?: string;
  metadataUri?: string;
}

export interface MarketMetrics {
  price: number; // STRK per token
  /** USD is intentionally not inferred on Sepolia; launchpad values stay STRK-denominated. */
  priceUsd: null;
  marketCap: number; // STRK price * circulating supply
  liquidity: number; // real base reserves
  volume: number; // accumulated base volume
  graduationPct: number; // 0..100
  graduated: boolean;
  holders: number | null; // unknown for MVP (no indexer) -> null
}

export interface TokenSnapshot {
  entry: LaunchTokenEntry;
  metadata: TokenMetadata | null;
  curve: CurveState | null;
  metrics: MarketMetrics | null;
  live: boolean;
  /** Truthful migration state from the GraduationRouter (null when unknown). */
  migrated: boolean | null;
}

export interface TradeEvent {
  block: number;
  txHash: string;
  side: 'BUY' | 'SELL';
  trader: string;
  recipient: string;
  /** Gross input (STRK for BUY, tokens for SELL). */
  input: bigint;
  /** Net output (tokens for BUY, STRK for SELL). */
  output: bigint;
  fee: bigint;
  baseAfter: bigint;
  tokenAfter: bigint;
  /** True when this curve trade was executed through the private executor lane. */
  private: boolean;
  /** Price ratio (totalBase, totalToken) after this trade — exact, no float. */
  priceBase: bigint;
  priceToken: bigint;
}

export interface PrivateStats {
  tradeCount: bigint;
  volumeBase: bigint;
}

export interface PricePoint {
  block: number;
  /** price = totalBase / totalToken as a float for charting. */
  price: number;
  base: bigint;
  token: bigint;
}

export interface RawCurveEventLike {
  keys?: string[];
  data?: (string | number)[];
  block_number?: string | number;
}

/** Exact price (totalBase / totalToken) reconstructed from post-trade reserve state. */
export function computePriceFromReserves(
  virtualBase: bigint,
  virtualToken: bigint,
  baseAfter: bigint,
  tokenAfter: bigint,
): number | null {
  const totalBase = virtualBase + baseAfter;
  const totalToken = virtualToken - tokenAfter;
  if (totalToken <= 0n) return null;
  return Number(totalBase) / Number(totalToken);
}

/**
 * Pure price-history replay from raw curve Buy/Sell events. Every V2 event carries the
 * post-trade reserve state (data[5]=base_after, data[6]=token_after), so the price at each
 * trade is exact — no float reconstruction, no assumptions. Returns oldest → newest, capped
 * to the most recent `limit` points.
 */
export function replayPricePoints(
  events: RawCurveEventLike[],
  virtualBase: bigint,
  virtualToken: bigint,
  limit = 120,
): PricePoint[] {
  const points: PricePoint[] = [];
  for (const e of events) {
    const baseAfter = BigInt(e.data?.[5] ?? 0);
    const tokenAfter = BigInt(e.data?.[6] ?? 0);
    const totalBase = virtualBase + baseAfter;
    const totalToken = virtualToken - tokenAfter;
    if (totalToken <= 0n) continue;
    points.push({
      block: Number(BigInt(e.block_number ?? 0)),
      price: Number(totalBase) / Number(totalToken),
      base: totalBase,
      token: totalToken,
    });
  }
  return points.slice(Math.max(0, points.length - limit));
}

function providerFor(networkId: NetworkId): RpcProvider {
  const cfg = getNetworkConfig(networkId);
  return new RpcProvider({ nodeUrl: cfg.rpcUrls[0] });
}

/** Read a view returning [low, high] u256 or single felt. */
function toBig(res: any, index = 0): bigint {
  if (res === undefined) return 0n;
  const arr = Array.isArray(res) ? res : [res];
  if (typeof arr[index] === 'bigint') return arr[index];
  const v = arr[index];
  if (v && typeof v.low !== 'undefined') return BigInt(v.low) + (BigInt(v.high ?? 0) << 128n);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.includes('low')) return BigInt(v.low) + (BigInt(v.high ?? 0) << 128n);
  }
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

async function callView(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: (string | bigint)[] = [],
): Promise<any> {
  return provider.callContract({
    contractAddress,
    entrypoint,
    calldata: calldata.map((c) => num.toHex(typeof c === 'bigint' ? c : c)),
  });
}

async function readCurveState(provider: RpcProvider, curve: string): Promise<CurveState | null> {
  try {
    const [vb, vt] = await callView(provider, curve, 'get_virtual_reserves');
    const [br, tr] = await callView(provider, curve, 'get_real_reserves');
    const gt = await callView(provider, curve, 'get_graduation_target');
    const graduated = await callView(provider, curve, 'is_graduated');
    const fee = await callView(provider, curve, 'get_fee_bps');
    const creatorFee = await callView(provider, curve, 'get_creator_fee_bps');
    const protocolFee = await callView(provider, curve, 'get_protocol_fee_bps');
    const maxTrade = await callView(provider, curve, 'get_max_trade_bps');
    const [pb, pt] = await callView(provider, curve, 'get_price');
    return {
      virtualBase: toBig(vb),
      virtualToken: toBig(vt),
      baseReserve: toBig(br),
      tokenReserve: toBig(tr),
      graduationTarget: toBig(gt),
      graduated: Boolean(toBig(graduated)),
      feeBps: toBig(fee),
      creatorFeeBps: toBig(creatorFee),
      protocolFeeBps: toBig(protocolFee),
      maxTradeBps: toBig(maxTrade),
      priceBase: toBig(pb),
      priceToken: toBig(pt),
    };
  } catch (e) {
    console.warn('[launch] readCurveState failed', e);
    return null;
  }
}

async function readTokenMetadata(
  provider: RpcProvider,
  token: string,
  totalSupplyRaw?: string,
): Promise<TokenMetadata | null> {
  try {
    const name = await callView(provider, token, 'name');
    const symbol = await callView(provider, token, 'symbol');
    const decimals = await callView(provider, token, 'decimals');
    const supply = totalSupplyRaw
      ? BigInt(totalSupplyRaw)
      : toBig(await callView(provider, token, 'total_supply'));
    return {
      name: decodeShortString(name),
      symbol: decodeShortString(symbol),
      decimals: Number(toBig(decimals)),
      totalSupply: supply,
    };
  } catch (e) {
    console.warn('[launch] readTokenMetadata failed', e);
    return null;
  }
}

/**
 * Decode a felt short string to a JS string.
 *
 * `callContract` returns a `felt252` view result as a 1-element array (e.g.
 * `['0x5354524b465457']`), so unwrap that first, then decode the felt whether it arrived as
 * a bigint, a hex string, or a plain string. Null bytes terminate the string.
 */
export function decodeShortString(v: any): string {
  const unwrapped = Array.isArray(v) ? (v.length > 0 ? v[0] : '') : v;
  if (unwrapped === null || unwrapped === undefined) return '';
  const fromHex = (hex: string): string => {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (byte === 0) break;
      out += String.fromCharCode(byte);
    }
    return out;
  };
  if (typeof unwrapped === 'bigint' || typeof unwrapped === 'number') {
    try {
      const hex = unwrapped
        .toString(16)
        .padStart(Math.ceil(unwrapped.toString(16).length / 2) * 2, '0');
      const cleaned = fromHex(hex);
      return cleaned || unwrapped.toString();
    } catch {
      return String(unwrapped);
    }
  }
  if (typeof unwrapped === 'string') {
    if (/^0x[0-9a-f]+$/i.test(unwrapped)) {
      try {
        const hex = BigInt(unwrapped)
          .toString(16)
          .padStart(Math.ceil(BigInt(unwrapped).toString(16).length / 2) * 2, '0');
        const cleaned = fromHex(hex);
        return cleaned || unwrapped;
      } catch {
        return unwrapped;
      }
    }
    return unwrapped;
  }
  return String(unwrapped ?? '');
}

/**
 * On-chain quote for a buy. Returns token output in the smallest unit.
 * baseAmount is in the smallest unit (18 dp). An oversized order reverts on-chain with
 * MAX_TRADE_EXCEEDED — the caller should surface that to the user.
 */
export async function quoteBuy(
  networkId: NetworkId,
  curve: string,
  baseAmount: bigint,
): Promise<bigint | null> {
  if (!curve || baseAmount <= 0n) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, curve, 'quote_buy', [baseAmount]);
    return toBig(res);
  } catch {
    return null;
  }
}

/** On-chain quote for a sell. tokenAmount is in the smallest unit. */
export async function quoteSell(
  networkId: NetworkId,
  curve: string,
  tokenAmount: bigint,
): Promise<bigint | null> {
  if (!curve || tokenAmount <= 0n) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, curve, 'quote_sell', [tokenAmount]);
    return toBig(res);
  } catch {
    return null;
  }
}

export function computeMetrics(
  curve: CurveState,
  metadata: TokenMetadata | null,
  networkId: NetworkId,
  cumulativeVolumeBase: bigint = 0n,
): MarketMetrics {
  const price = curve.priceToken > 0n ? Number(curve.priceBase) / Number(curve.priceToken) : 0;
  // circulating supply is on-chain in smallest units — normalize by token decimals so the
  // market cap is STRK price × human-readable token count (never price × raw 1e18 supply).
  const decimals = metadata?.decimals ?? 18;
  const circulatingRaw = curve.tokenReserve > 0n ? curve.tokenReserve : (metadata?.totalSupply ?? 0n);
  const circulatingHuman = Number(circulatingRaw) / 10 ** decimals;
  const marketCap = price * circulatingHuman;
  // liquidity is the real STRK reserve currently held by the curve.
  const liquidity = Number(curve.baseReserve) / Number(ONE);
  // volume is CUMULATIVE traded base volume from on-chain Buy/Sell events — never the
  // current reserve. Passed in separately (base smallest units).
  const volume = Number(cumulativeVolumeBase) / Number(ONE);
  const graduationPct =
    curve.graduationTarget > 0n
      ? Math.min(100, (Number(curve.baseReserve) / Number(curve.graduationTarget)) * 100)
      : 0;
  return {
    price,
    priceUsd: null,
    marketCap,
    liquidity,
    volume,
    graduationPct,
    graduated: curve.graduated,
    holders: null,
  };
}

/** Max single-trade token output enforced by the curve (for UI warnings). */
export function maxTradeTokenOut(curve: CurveState): bigint {
  if (!curve || curve.maxTradeBps <= 0n) return 0n;
  return (curve.virtualToken * curve.maxTradeBps) / 10000n;
}

/** Max compliant STRK buy for a given curve state (what the UI should cap the input at). */
export function maxTradeBaseIn(curve: CurveState): bigint {
  if (!curve) return 0n;
  const capTokens = maxTradeTokenOut(curve);
  if (capTokens <= 0n) return 0n;
  // Invert the curve math: find the gross base input whose token output is <= capTokens.
  // Safe upper bound: price a buy of capTokens tokens directly is non-trivial, so use a
  // conservative estimate from the current price ratio.
  const price = curve.priceToken > 0n ? Number(curve.priceBase) / Number(curve.priceToken) : 0;
  if (price <= 0) return 0n;
  const feeFactor = 1 - (Number(curve.creatorFeeBps) + Number(curve.protocolFeeBps)) / 10000;
  const est = BigInt(Math.floor((Number(capTokens) * price) / Math.max(feeFactor, 0.01)));
  return est > 0n ? est : 0n;
}

/**
 * Cumulative traded volume (base-denominated) for a curve, derived from its on-chain
 * `Buy`/`Sell` events:
 *   Buy  { trader, recipient, base_amount, token_out, fee, base_after, token_after } → + data[2]
 *   Sell { trader, recipient, token_amount, base_out, fee, base_after, token_after } → + data[3]+data[4]
 * This is real traded volume, not current liquidity. Events are scanned from the network's
 * configured `eventScanStartBlock` with continuation pagination. Returns null when event
 * scanning is unavailable.
 */
export async function readCumulativeVolume(
  networkId: NetworkId,
  curve: string,
): Promise<bigint | null> {
  const net = getLaunchNetwork(networkId);
  const start = net.eventScanStartBlock;
  if (!curve || !start) return null;
  try {
    const provider = providerFor(networkId);
    const buySel = hash.getSelectorFromName('Buy');
    const sellSel = hash.getSelectorFromName('Sell');
    let total = 0n;
    let cont: string | undefined;
    for (let page = 0; page < 10; page++) {
      const filter: any = {
        from_block: { block_number: start },
        address: curve,
        keys: [[buySel, sellSel]],
        chunk_size: 1000,
      };
      if (cont) filter.continuation_token = cont;
      const res = await provider.getEvents(filter);
      for (const e of res.events ?? []) {
        if (e.keys?.[0] === buySel) total += BigInt(e.data?.[2] ?? 0);
        else if (e.keys?.[0] === sellSel) total += BigInt(e.data?.[3] ?? 0) + BigInt(e.data?.[4] ?? 0);
      }
      if (!res.continuation_token) break;
      cont = res.continuation_token;
    }
    return total;
  } catch (e) {
    console.warn('[launch] readCumulativeVolume failed', e);
    return null;
  }
}

/**
 * Private-execution stats from the executor (no identity): cumulative private trade count
 * and cumulative private base volume. Returns null when unavailable.
 */
export async function readPrivateStats(
  networkId: NetworkId,
  executor: string,
): Promise<PrivateStats | null> {
  if (!executor) return null;
  try {
    const provider = providerFor(networkId);
    const [count, volume] = await Promise.all([
      callView(provider, executor, 'get_private_trade_count'),
      callView(provider, executor, 'get_private_volume_base'),
    ]);
    return { tradeCount: toBig(count), volumeBase: toBig(volume) };
  } catch (e) {
    console.warn('[launch] readPrivateStats failed', e);
    return null;
  }
}

/** Truthful migration state: has this curve's graduation reserves moved to the liquidity
 * manager? Reads GraduationRouter.is_migrated(curve). Null when the router is not configured. */
export async function readMigratedState(
  networkId: NetworkId,
  curve: string,
): Promise<boolean | null> {
  const net = getLaunchNetwork(networkId);
  if (!net.router || !curve) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, net.router, 'is_migrated', [curve]);
    return Boolean(toBig(res));
  } catch {
    return null;
  }
}

/**
 * STRK20 pool protocol fee per `apply_actions` call (in base units) — the pool pulls this
 * from the caller in STRK on EVERY shield/unshield/private-trade tx, IN ADDITION to the
 * deposit/withdraw amount. The UI must account for it or a shield at the user's full public
 * balance reverts with "Insufficient ERC20 balance". Null when unreadable.
 */
export async function readStrk20PoolFee(networkId: NetworkId): Promise<bigint | null> {
  const net = getLaunchNetwork(networkId);
  if (!net.poolAddress) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, net.poolAddress, 'get_fee_amount');
    return toBig(res);
  } catch (e) {
    console.warn('[launch] readStrk20PoolFee failed', e);
    return null;
  }
}

/**
 * Reconstruct the curve price series from its real Buy/Sell events. Every V2 event carries
 * the post-trade reserve state (base_after/token_after), so the price at each trade is exact
 * — no float reconstruction, no assumptions. Returns the most recent `limit` points
 * (oldest → newest). Blocks are read for the x-axis.
 */
export async function readPriceHistory(
  networkId: NetworkId,
  curve: string,
  limit = 120,
): Promise<PricePoint[]> {
  const net = getLaunchNetwork(networkId);
  const start = net.eventScanStartBlock;
  if (!curve || !start) return [];
  try {
    const provider = providerFor(networkId);
    const state = await readCurveState(provider, curve);
    if (!state) return [];
    const buySel = hash.getSelectorFromName('Buy');
    const sellSel = hash.getSelectorFromName('Sell');
    const events: any[] = [];
    let cont: string | undefined;
    for (let page = 0; page < 10 && events.length <= limit * 2; page++) {
      const filter: any = {
        from_block: { block_number: start },
        address: curve,
        keys: [[buySel, sellSel]],
        chunk_size: 1000,
      };
      if (cont) filter.continuation_token = cont;
      const res = await provider.getEvents(filter);
      events.push(...(res.events ?? []));
      if (!res.continuation_token) break;
      cont = res.continuation_token;
    }
    // Oldest → newest, then keep the most recent `limit` points.
    return replayPricePoints(events, state.virtualBase, state.virtualToken, limit);
  } catch (e) {
    console.warn('[launch] readPriceHistory failed', e);
    return [];
  }
}

/**
 * Recent real trades for a curve, newest first. A trade whose `trader` is the private
 * executor address was executed through the shielded lane (labeled `private: true`) — this
 * exposes private execution without linking to any user identity.
 */
export async function readRecentTrades(
  networkId: NetworkId,
  curve: string,
  executor: string,
  limit = 20,
): Promise<TradeEvent[]> {
  const net = getLaunchNetwork(networkId);
  const start = net.eventScanStartBlock;
  if (!curve || !start) return [];
  try {
    const provider = providerFor(networkId);
    const state = await readCurveState(provider, curve);
    if (!state) return [];
    const buySel = hash.getSelectorFromName('Buy');
    const sellSel = hash.getSelectorFromName('Sell');
    const executorNorm = normalizeAddress(executor);
    const events: any[] = [];
    let cont: string | undefined;
    for (let page = 0; page < 8 && events.length <= limit * 3; page++) {
      const filter: any = {
        from_block: { block_number: start },
        address: curve,
        keys: [[buySel, sellSel]],
        chunk_size: 1000,
      };
      if (cont) filter.continuation_token = cont;
      const res = await provider.getEvents(filter);
      events.push(...(res.events ?? []));
      if (!res.continuation_token) break;
      cont = res.continuation_token;
    }
    const trades: TradeEvent[] = [];
    for (const e of events) {
      const trader = num.toHex(BigInt(e.data?.[0] ?? 0));
      const recipient = num.toHex(BigInt(e.data?.[1] ?? 0));
      const isBuy = e.keys?.[0] === buySel;
      const baseAfter = BigInt(e.data?.[5] ?? 0);
      const tokenAfter = BigInt(e.data?.[6] ?? 0);
      trades.push({
        block: Number(BigInt(e.block_number ?? 0)),
        txHash: e.transaction_hash ?? '',
        side: isBuy ? 'BUY' : 'SELL',
        trader,
        recipient,
        input: BigInt(e.data?.[2] ?? 0),
        output: BigInt(e.data?.[3] ?? 0),
        fee: BigInt(e.data?.[4] ?? 0),
        baseAfter,
        tokenAfter,
        private: normalizeAddress(trader) === executorNorm,
        priceBase: state.virtualBase + baseAfter,
        priceToken: state.virtualToken - tokenAfter,
      });
    }
    trades.reverse(); // newest first
    return trades.slice(0, limit);
  } catch (e) {
    console.warn('[launch] readRecentTrades failed', e);
    return [];
  }
}

export async function loadTokenSnapshot(
  networkId: NetworkId,
  entry: LaunchTokenEntry,
): Promise<TokenSnapshot> {
  if (!isTokenLive(entry)) {
    return { entry, metadata: null, curve: null, metrics: null, live: false, migrated: null };
  }
  const provider = providerFor(networkId);
  const [metadata, curve, volume, migrated] = await Promise.all([
    readTokenMetadata(provider, entry.token, entry.totalSupply),
    readCurveState(provider, entry.curve),
    readCumulativeVolume(networkId, entry.curve),
    readMigratedState(networkId, entry.curve),
  ]);
  const metrics = metadata && curve ? computeMetrics(curve, metadata, networkId, volume ?? 0n) : null;
  return { entry, metadata, curve, metrics, live: true, migrated };
}

/** Resolve the token list from the live factory (no seeded registry in V2). */
export async function listTokens(networkId: NetworkId): Promise<LaunchTokenEntry[]> {
  const net = getLaunchNetwork(networkId);
  if (!net.factory) return [];
  try {
    const provider = providerFor(networkId);
    const countRes = await callView(provider, net.factory, 'get_token_count');
    const count = Number(toBig(countRes));
    const out: LaunchTokenEntry[] = [];
    for (let i = 0; i < count && i < 50; i++) {
      const [token, curve, executor] = await Promise.all([
        callView(provider, net.factory, 'get_token', [BigInt(i)]),
        callView(provider, net.factory, 'get_curve', [BigInt(i)]),
        callView(provider, net.factory, 'get_executor', [BigInt(i)]),
      ]);
      const meta = await readTokenMetadata(provider, num.toHex(toBig(token)));
      const md = await callView(provider, net.factory, 'get_metadata', [toBig(token)]);
      let creator: string | undefined;
      try {
        const c = await callView(provider, net.factory, 'get_creator', [toBig(token)]);
        creator = num.toHex(toBig(c));
      } catch {
        creator = undefined;
      }
      out.push({
        id: String(i),
        symbol: meta?.symbol ?? `TOKEN${i}`,
        name: meta?.name ?? `Token ${i}`,
        emoji: '🪙',
        token: num.toHex(toBig(token)),
        curve: num.toHex(toBig(curve)),
        executor: num.toHex(toBig(executor)),
        totalSupply: meta?.totalSupply?.toString() ?? '',
        params: await readCurveParams(networkId, num.toHex(toBig(curve))),
        metadataUri: decodeShortString(md) || undefined,
        creator,
      });
    }
    return out;
  } catch (e) {
    console.warn('[launch] factory list failed', e);
    return [];
  }
}

/** Read the real curve params for a token entry (fee split + max trade from the curve). */
async function readCurveParams(networkId: NetworkId, curve: string): Promise<LaunchCurveParams> {
  if (!curve) return { ...DEFAULT_PARAMS };
  try {
    const provider = providerFor(networkId);
    const [vb, vt] = await callView(provider, curve, 'get_virtual_reserves');
    const [gt] = await callView(provider, curve, 'get_graduation_target');
    const [fee] = await callView(provider, curve, 'get_fee_bps');
    const [cf] = await callView(provider, curve, 'get_creator_fee_bps');
    const [pf] = await callView(provider, curve, 'get_protocol_fee_bps');
    const [mt] = await callView(provider, curve, 'get_max_trade_bps');
    return {
      virtualBase: toBig(vb).toString(),
      virtualToken: toBig(vt).toString(),
      graduationTarget: toBig(gt).toString(),
      feeBps: toBig(fee).toString(),
      creatorFeeBps: toBig(cf).toString(),
      protocolFeeBps: toBig(pf).toString(),
      maxTradeBps: toBig(mt).toString(),
    };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

/** Normalize an address/felt to lowercase hex for comparison. */
export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  try {
    return num.toHex(addr).toLowerCase();
  } catch {
    return addr.toLowerCase();
  }
}

/** Split a u256 into its [low, high] felt strings for flat calldata. CallData.compile
 * without an ABI treats a bigint as a single felt252, so u256 values MUST be split
 * manually or every following parameter misaligns on-chain. */
export function splitU256(value: bigint): [string, string] {
  const LOW_MASK = (1n << 128n) - 1n;
  return [(value & LOW_MASK).toString(), (value >> 128n).toString()];
}

/**
 * Pure resolver: match a token entry by factory id, symbol (case-insensitive), or the real
 * token contract address. Used by the Explore → token page navigation so every card links
 * to the actual deployed curve addresses.
 */
export function matchTokenEntry(list: LaunchTokenEntry[], key: string): LaunchTokenEntry | null {
  if (!key || list.length === 0) return null;
  const idKey = key.toLowerCase();
  const addrKey = normalizeAddress(key);
  return (
    list.find(
      (e) =>
        String(e.id).toLowerCase() === idKey ||
        e.symbol.toLowerCase() === idKey ||
        e.token.toLowerCase() === idKey ||
        normalizeAddress(e.token) === addrKey,
    ) ?? null
  );
}

/** Resolve a token entry from the live factory list by id, symbol, or address. */
export async function findTokenEntry(
  networkId: NetworkId,
  idOrSymbolOrAddress: string,
): Promise<LaunchTokenEntry | null> {
  const list = await listTokens(networkId);
  return matchTokenEntry(list, idOrSymbolOrAddress);
}

/** Sort snapshots for Explore. Every sort key derives from live V2 state or real events. */
export function sortSnapshots(
  snapshots: TokenSnapshot[],
  mode: ExploreSortMode,
): TokenSnapshot[] {
  const arr = [...snapshots];
  if (mode === 'trending') {
    return arr.sort((a, b) => {
      return (b.metrics?.volume ?? 0) - (a.metrics?.volume ?? 0);
    });
  }
  if (mode === 'graduated') return arr.filter((s) => s.metrics?.graduated === true);
  if (mode === 'graduation') {
    return arr.sort((a, b) => {
      const pa = a.metrics?.graduationPct ?? 0;
      const pb = b.metrics?.graduationPct ?? 0;
      return pb - pa;
    });
  }
  // newest: highest factory id first (id = creation order)
  return arr.sort((a, b) => Number(b.entry.id) - Number(a.entry.id));
}

/** Pure search filter over name/symbol. */
export function filterSnapshots(snapshots: TokenSnapshot[], query: string): TokenSnapshot[] {
  const q = query.trim().toLowerCase();
  if (!q) return snapshots;
  return snapshots.filter(
    (s) =>
      s.entry.name.toLowerCase().includes(q) ||
      s.entry.symbol.toLowerCase().includes(q),
  );
}

/** On-chain metadata reference this app stamps on every launched token. */
export function launchMetadataRef(): string {
  return LAUNCH_METADATA_REF;
}

/** True when a factory-issued metadata felt points at the ORRANGE launch metadata store. */
export function decodeMetadataRef(feltOrString: any): boolean {
  if (!feltOrString) return false;
  const asStr = decodeShortString(feltOrString);
  return asStr === LAUNCH_METADATA_REF;
}

/** Resolve the token created by a confirmed V2 factory transaction from its receipt event.
 * This avoids the race-prone "latest token" fallback when multiple users launch together. */
export function resolveCreatedTokenFromReceipt(receipt: any): string | null {
  const selector = hash.getSelectorFromName('TokenCreated');
  const events = receipt?.events ?? receipt?.transaction?.events ?? [];
  for (const event of events) {
    const keys = event?.keys ?? [];
    if (!keys.length || normalizeAddress(String(keys[0])) !== normalizeAddress(selector)) continue;
    const data = event?.data ?? [];
    // TokenCreated(id, creator, token, curve, executor, ...)
    const tokenRaw = data[2];
    if (tokenRaw === undefined) continue;
    const token = normalizeAddress(num.toHex(BigInt(tokenRaw)));
    if (token && token !== '0x0') return token;
  }
  return null;
}

/** Public buy: approve the BASE asset for the curve, then call buy(). The ERC20 approve
 * amount is a u256, so it must be split [low, high] in calldata. */
export async function executePublicBuy(
  walletAccount: any,
  baseAsset: string,
  curve: string,
  amountStr: string,
  recipient: string,
  decimals = 18,
): Promise<{ transactionHash: string }> {
  const amount = parseTokenAmount(amountStr, decimals);
  const calls = [
    { contractAddress: baseAsset, entrypoint: 'approve', calldata: [curve, ...splitU256(amount)] },
    { contractAddress: curve, entrypoint: 'buy', calldata: [amount.toString(), recipient] },
  ];
  const res = await walletAccount.execute(calls);
  return { transactionHash: res.transaction_hash ?? res.transactionHash ?? res.hash };
}

/** Public sell: approve the MEMECOIN for the curve, then call sell(). The ERC20 approve
 * amount is a u256, so it must be split [low, high] in calldata. */
export async function executePublicSell(
  walletAccount: any,
  token: string,
  curve: string,
  amountStr: string,
  recipient: string,
  decimals = 18,
): Promise<{ transactionHash: string }> {
  const amount = parseTokenAmount(amountStr, decimals);
  const calls = [
    { contractAddress: token, entrypoint: 'approve', calldata: [curve, ...splitU256(amount)] },
    { contractAddress: curve, entrypoint: 'sell', calldata: [amount.toString(), recipient] },
  ];
  const res = await walletAccount.execute(calls);
  return { transactionHash: res.transaction_hash ?? res.transactionHash ?? res.hash };
}

/** Public ERC20 balance of `address` for `token` on the active network. The UMBRA
 * memecoin exposes `balance_of` (snake_case); the canonical STRK token also accepts
 * `balanceOf`. Tries both so either deployed ABI reads correctly. Returns null only when
 * every read failed (UI must show "—", never a fabricated 0). */
export async function getTokenBalance(
  networkId: NetworkId,
  token: string,
  address: string,
): Promise<bigint | null> {
  if (!token || !address) return null;
  try {
    const provider = providerFor(networkId);
    for (const ep of ['balance_of', 'balanceOf']) {
      try {
        const res = await callView(provider, token, ep, [address]);
        return toBig(res);
      } catch {
        // entrypoint not on this ABI — try the other
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the V2 `create_memecoin` calldata (flat). The u256 total_supply is split into
 * [low, high]; the V2 fee-split + max-trade params follow the graduation target.
 */
export function buildCreateCalldata(opts: {
  name: string;
  symbol: string;
  decimals: number;
  metadataUri: string;
  totalSupply: string;
  virtualBase: string;
  virtualToken: string;
  graduationTarget: string;
  feeBps: string;
  creatorFeeBps: string;
  protocolFeeBps: string;
  maxTradeBps: string;
}): string[] {
  return CallData.compile([
    shortString.encodeShortString(opts.name),
    shortString.encodeShortString(opts.symbol),
    opts.decimals,
    shortString.encodeShortString(opts.metadataUri),
    ...splitU256(BigInt(opts.totalSupply)),
    BigInt(opts.virtualBase).toString(),
    BigInt(opts.virtualToken).toString(),
    BigInt(opts.graduationTarget).toString(),
    Number(opts.feeBps),
    Number(opts.creatorFeeBps),
    Number(opts.protocolFeeBps),
    Number(opts.maxTradeBps),
  ]);
}

export { parseTokenAmount, providerFor, hash, num }; // re-exported for tests
