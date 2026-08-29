/**
 * @file src/services/launchService.ts
 * @description UMBRA LAUNCH on-chain reads + PUBLIC execution against the canonical
 * BondingCurve. All reads go straight to Starknet RPC (never local mocks); settlement
 * math is on-chain only. Public trades use plain ERC20 calls; private trades live in
 * privateLaunchService.
 */
import { RpcProvider, hash, num } from 'starknet';
import { getNetworkConfig, NetworkId } from '@/config/networks';
import {
  LaunchTokenEntry,
  getLaunchNetwork,
  isTokenLive,
  LAUNCH_METADATA_REF,
} from '@/config/launch';
import { parseTokenAmount } from '@/utils/formatters';

const ONE = 10n ** 18n;

export type ExploreSortMode = 'newest' | 'trending' | 'graduation';

export interface CurveState {
  virtualBase: bigint;
  virtualToken: bigint;
  baseReserve: bigint; // real STRK in the curve
  tokenReserve: bigint; // real tokens sold outstanding (circulating)
  graduationTarget: bigint;
  graduated: boolean;
  feeBps: bigint;
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
  priceUsd: number; // price * baseUsd
  marketCap: number; // price * circulating supply
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
    // struct tuple destructuring
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
    const [pb, pt] = await callView(provider, curve, 'get_price');
    return {
      virtualBase: toBig(vb),
      virtualToken: toBig(vt),
      baseReserve: toBig(br),
      tokenReserve: toBig(tr),
      graduationTarget: toBig(gt),
      graduated: Boolean(toBig(graduated)),
      feeBps: toBig(fee),
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
      name: feltToString(name),
      symbol: feltToString(symbol),
      decimals: Number(toBig(decimals)),
      totalSupply: supply,
    };
  } catch (e) {
    console.warn('[launch] readTokenMetadata failed', e);
    return null;
  }
}

/** Decode a felt short string to a JS string. Accepts a numeric felt (bigint) returned by
 * the RPC or an already-hex/plain string. Null bytes terminate the string. */
function feltToString(v: any): string {
  const fromHex = (hex: string): string => {
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (byte === 0) break;
      out += String.fromCharCode(byte);
    }
    return out;
  };
  if (typeof v === 'bigint' || typeof v === 'number') {
    try {
      const hex = v
        .toString(16)
        .padStart(Math.ceil(v.toString(16).length / 2) * 2, '0');
      const cleaned = fromHex(hex);
      return cleaned || v.toString();
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'string') {
    if (/^0x[0-9a-f]+$/i.test(v)) {
      try {
        const hex = BigInt(v)
          .toString(16)
          .padStart(Math.ceil(BigInt(v).toString(16).length / 2) * 2, '0');
        const cleaned = fromHex(hex);
        return cleaned || v;
      } catch {
        return v;
      }
    }
    return v;
  }
  return String(v ?? '');
}

/**
 * On-chain quote for a buy. Returns token output in the smallest unit.
 * baseAmount is in the smallest unit (18 dp).
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

export function baseUsdFor(networkId: NetworkId): number {
  // STRK ~ $0.35 placeholder; real feed is out of MVP scope. Kept explicit so it is never
  // confused with on-chain truth.
  return networkId === 'mainnet' ? 0.35 : 0.001;
}

export function computeMetrics(
  curve: CurveState,
  metadata: TokenMetadata | null,
  networkId: NetworkId,
): MarketMetrics {
  const price = curve.priceToken > 0n ? Number(curve.priceBase) / Number(curve.priceToken) : 0;
  const priceUsd = price * baseUsdFor(networkId);
  const circulating = curve.tokenReserve > 0n ? curve.tokenReserve : (metadata?.totalSupply ?? 0n);
  const marketCap = price * Number(circulating);
  const liquidity = Number(curve.baseReserve) / Number(ONE);
  const volume = Number(curve.baseReserve) / Number(ONE);
  const graduationPct =
    curve.graduationTarget > 0n
      ? Math.min(100, (Number(curve.baseReserve) / Number(curve.graduationTarget)) * 100)
      : 0;
  return {
    price,
    priceUsd,
    marketCap,
    liquidity,
    volume,
    graduationPct,
    graduated: curve.graduated,
    holders: null,
  };
}

export async function loadTokenSnapshot(
  networkId: NetworkId,
  entry: LaunchTokenEntry,
): Promise<TokenSnapshot> {
  if (!isTokenLive(entry)) {
    return { entry, metadata: null, curve: null, metrics: null, live: false };
  }
  const provider = providerFor(networkId);
  const [metadata, curve] = await Promise.all([
    readTokenMetadata(provider, entry.token, entry.totalSupply),
    readCurveState(provider, entry.curve),
  ]);
  const metrics = metadata && curve ? computeMetrics(curve, metadata, networkId) : null;
  return { entry, metadata, curve, metrics, live: true };
}

/** Resolve the token list: factory-read when configured, else the seeded registry. */
export async function listTokens(networkId: NetworkId): Promise<LaunchTokenEntry[]> {
  const net = getLaunchNetwork(networkId);
  if (net.factory) {
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
          params: DEFAULT_PARAMS_FROM_NET,
          metadataUri: feltToString(md) || undefined,
          creator,
        });
      }
      if (out.length) return out;
    } catch (e) {
      console.warn('[launch] factory list failed, falling back to registry', e);
    }
  }
  return net.registry;
}

const DEFAULT_PARAMS_FROM_NET = {
  virtualBase: '15000000000000000000',
  virtualToken: '1073000000000000000000000000',
  graduationTarget: '50000000000000000000',
  feeBps: '100',
};

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

/** Sort snapshots for Explore: newest (factory id desc), trending (real reserves desc),
 * or graduation (lowest remaining progress first). All keys derive from on-chain state. */
export function sortSnapshots(
  snapshots: TokenSnapshot[],
  mode: ExploreSortMode,
): TokenSnapshot[] {
  const arr = [...snapshots];
  if (mode === 'trending') {
    return arr.sort((a, b) => {
      const ra = a.curve?.baseReserve ?? 0n;
      const rb = b.curve?.baseReserve ?? 0n;
      return ra === rb ? 0 : ra > rb ? -1 : 1;
    });
  }
  if (mode === 'graduation') {
    return arr.sort((a, b) => {
      const pa = a.metrics?.graduationPct ?? 0;
      const pb = b.metrics?.graduationPct ?? 0;
      return pa - pb;
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
  const asStr = feltToString(feltOrString);
  return asStr === LAUNCH_METADATA_REF;
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

export { parseTokenAmount, providerFor, hash, num }; // re-exported for tests

/** Public ERC20 balance of `address` for `token` on the active network. The UMBRA
 * memecoin exposes its entrypoint as `balance_of` (snake_case, per its Cairo interface). */
export async function getTokenBalance(
  networkId: NetworkId,
  token: string,
  address: string,
): Promise<bigint | null> {
  if (!token || !address) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, token, 'balance_of', [address]);
    return toBig(res);
  } catch {
    return null;
  }
}