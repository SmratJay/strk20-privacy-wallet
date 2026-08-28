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
} from '@/config/launch';
import { parseTokenAmount } from '@/utils/formatters';

const ONE = 10n ** 18n;

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

/** Decode a felt short string (or already-string) to a JS string. */
function feltToString(v: any): string {
  if (typeof v === 'string') {
    if (/^0x[0-9a-f]+$/i.test(v)) {
      try {
        const bytes = BigInt(v)
          .toString(16)
          .padStart(Math.ceil(BigInt(v).toString(16).length / 2) * 2, '0');
        let out = '';
        for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16));
        const cleaned = out.replace(/\x00/g, '');
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

/** Public buy: approve the BASE asset for the curve, then call buy(). */
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
    { contractAddress: baseAsset, entrypoint: 'approve', calldata: [curve, amount.toString()] },
    { contractAddress: curve, entrypoint: 'buy', calldata: [amount.toString(), recipient] },
  ];
  const res = await walletAccount.execute(calls);
  return { transactionHash: res.transaction_hash ?? res.transactionHash ?? res.hash };
}

/** Public sell: approve the MEMECOIN for the curve, then call sell(). */
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
    { contractAddress: token, entrypoint: 'approve', calldata: [curve, amount.toString()] },
    { contractAddress: curve, entrypoint: 'sell', calldata: [amount.toString(), recipient] },
  ];
  const res = await walletAccount.execute(calls);
  return { transactionHash: res.transaction_hash ?? res.transactionHash ?? res.hash };
}

export { parseTokenAmount, providerFor, hash, num }; // re-exported for tests

/** Public ERC20 balance of `address` for `token` on the active network. */
export async function getTokenBalance(
  networkId: NetworkId,
  token: string,
  address: string,
): Promise<bigint | null> {
  if (!token || !address) return null;
  try {
    const provider = providerFor(networkId);
    const res = await callView(provider, token, 'balanceOf', [address]);
    return toBig(res);
  } catch {
    return null;
  }
}