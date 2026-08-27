/**
 * @file src/services/pragmaOracleService.ts
 * @description Canonical On-Chain Pragma/OracleAdapter Price Feed Integration (Audit Section 3 & P0-01)
 *
 * Enforces:
 * - Direct on-chain read from OracleAdapter.cairo on Starknet Sepolia
 * - Exact canonical integer price normalization (cents <-> USD)
 * - Strict fail-closed semantics: If oracle query fails or age > 180s, returns isFresh=false
 * - Zero fallback to unverified off-chain APIs for settlement / risk decisions
 */

import { RpcProvider, Contract } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';
import { BTC_PERP_CONFIG } from '../protocol/types';

export interface OracleMarketFeed {
  pairId: string;
  priceUsd: number;
  priceCents: bigint;
  timestamp: number;
  decimals: number;
  numSources: number;
  isFresh: boolean;
  oraclePublisher: string;
  sourceLabel: string;
}

export type PragmaMarketFeed = OracleMarketFeed; // Backwards compatibility alias

class PragmaOracleService {
  private provider: RpcProvider;
  private cache: Record<string, OracleMarketFeed> = {};
  private lastFetchedAt: number = 0;

  constructor(rpcUrl: string = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia') {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
  }

  /**
   * Fetch canonical market price directly from on-chain OracleAdapter
   */
  async getMarketPrice(
    pair: 'BTC/USD' | 'ETH/USD' | 'STRK/USD' = 'BTC/USD',
    network: 'mainnet' | 'sepolia' = 'sepolia'
  ): Promise<OracleMarketFeed> {
    const now = Date.now();
    const config = PERPS_DEPLOYMENTS[network === 'mainnet' ? 'sepolia' : network];
    const oracleAddress = config.oracleAdapterAddress;

    // Fast 750ms in-memory cache to prevent RPC spam
    if (this.cache[pair] && now - this.lastFetchedAt < 750) {
      return this.cache[pair];
    }

    try {
      // 1. Call on-chain OracleAdapter.get_market_price('BTC-PERP')
      const marketIdFelt = '0x4254432d50455250'; // 'BTC-PERP' in hex
      const callResult = await this.provider.callContract({
        contractAddress: oracleAddress,
        entrypoint: 'get_market_price',
        calldata: [marketIdFelt],
      });

      if (callResult && callResult.length >= 3) {
        const rawPrice = BigInt(callResult[0]); // price in cents
        const rawTimestamp = Number(BigInt(callResult[1]));
        const rawIsValid = BigInt(callResult[2]) !== 0n;

        const nowSec = Math.floor(now / 1000);
        const ageSec = nowSec - rawTimestamp;
        const isFresh = rawIsValid && rawPrice > 0n && ageSec >= 0 && ageSec <= BTC_PERP_CONFIG.maxOracleAgeSecs;

        const priceUsd = Number(rawPrice) / 100;
        const feed: OracleMarketFeed = {
          pairId: 'BTC/USD',
          priceUsd,
          priceCents: rawPrice,
          timestamp: rawTimestamp,
          decimals: 2,
          numSources: 1, // On-chain Pragma OracleAdapter
          isFresh,
          oraclePublisher: oracleAddress,
          sourceLabel: 'Pragma / OracleAdapter (Starknet Sepolia)',
        };

        this.cache[pair] = feed;
        this.lastFetchedAt = now;
        return feed;
      }
    } catch (err: any) {
      // In devnet / local tests where RPC might not be live, check fallback environment or fail closed
      console.warn('[PragmaOracleService] On-chain oracle read failed:', err?.message || err);
    }

    // Fail closed if on-chain query failed or returned empty
    const staleFeed: OracleMarketFeed = {
      pairId: pair,
      priceUsd: 0,
      priceCents: 0n,
      timestamp: 0,
      decimals: 2,
      numSources: 0,
      isFresh: false,
      oraclePublisher: oracleAddress,
      sourceLabel: 'Oracle Unavailable (Failed Closed)',
    };
    return staleFeed;
  }

  /**
   * Get price in integer cents (USD * 100) as BigInt for canonical protocol math
   */
  async getOraclePriceCents(
    pair: 'BTC/USD' | 'ETH/USD' | 'STRK/USD' = 'BTC/USD',
    network: 'mainnet' | 'sepolia' = 'sepolia'
  ): Promise<bigint> {
    const feed = await this.getMarketPrice(pair, network);
    if (!feed.isFresh) {
      throw new Error('ORACLE_UNAVAILABLE: On-chain price feed is stale or unreachable.');
    }
    return feed.priceCents;
  }
}

export const pragmaOracleService = new PragmaOracleService();
export const oraclePriceService = pragmaOracleService;
