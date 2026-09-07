import { NearIntentClient } from './client';
import { NEAR_INTENT_ROUTES, NEAR_INTENT_STRK_ASSET_ID, NEAR_INTENT_SOURCE_TOKEN, type NearIntentRoute } from './routes';

export interface RegistryToken {
  assetId: string;
  blockchain: string;
  symbol: string;
  decimals: number;
  contractAddress?: string;
}

/** Route keys use the registry asset ID on Solana, so duplicate tickers cannot select another mint. */
export function routesFromTokens(payload: unknown): NearIntentRoute[] {
  if (!Array.isArray(payload)) throw new Error('The destination registry returned an invalid response.');
  const tokens = payload.filter((t): t is RegistryToken => t && typeof t.assetId === 'string'
    && typeof t.blockchain === 'string' && typeof t.symbol === 'string' && t.symbol.length > 0
    && (t.contractAddress === undefined || typeof t.contractAddress === 'string')
    && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36);
  if (!tokens.some(t => t.blockchain === 'starknet' && t.assetId === NEAR_INTENT_STRK_ASSET_ID && t.decimals === 18)) {
    return [];
  }
  const result: NearIntentRoute[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token.assetId)) continue;
    seen.add(token.assetId);
    const base = NEAR_INTENT_ROUTES.find(r => r.destinationAssetId === token.assetId && token.blockchain === 'base');
    if (base && token.decimals === base.destinationToken.decimals) {
      result.push({ ...base, destinationToken: { ...base.destinationToken, decimals: token.decimals, address: token.contractAddress } });
    } else if (token.blockchain === 'sol') {
      result.push({
        id: `starknet-strk-to-solana-${token.assetId}`,
        name: `STRK (Starknet) → ${token.symbol} (Solana)`,
        sourceChain: 'starknet', sourceAsset: 'strk', sourceToken: NEAR_INTENT_SOURCE_TOKEN,
        originAssetId: NEAR_INTENT_STRK_ASSET_ID,
        destinationChain: 'solana', destinationAsset: token.assetId,
        destinationAssetId: token.assetId, destinationAddressKind: 'solana',
        destinationToken: { symbol: token.symbol, name: token.symbol, decimals: token.decimals, icon: '', address: token.contractAddress },
      });
    }
  }
  const priority = (r: NearIntentRoute) => r.destinationChain === 'base' ? 0 : r.destinationToken.symbol === 'USDC' ? 1 : r.destinationToken.symbol === 'SOL' ? 2 : 3;
  return result.sort((a, b) => priority(a) - priority(b) || a.destinationToken.symbol.localeCompare(b.destinationToken.symbol));
}

let cached: { routes: NearIntentRoute[]; until: number } | null = null;
let pending: Promise<NearIntentRoute[]> | null = null;

/** Five-minute public registry cache; never substitute demo destinations after an API failure. */
export async function loadNearIntentRoutes(force = false): Promise<NearIntentRoute[]> {
  if (!force && cached && cached.until > Date.now()) return cached.routes;
  if (pending) return pending;
  pending = new NearIntentClient().getTokens().then(payload => {
    const routes = routesFromTokens(payload);
    cached = { routes, until: Date.now() + 300_000 };
    return routes;
  }).finally(() => { pending = null; });
  return pending;
}
