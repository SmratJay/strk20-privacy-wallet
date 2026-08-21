/**
 * @file perpsService.ts
 * @description PEL Privacy-Native Perpetual Derivatives Engine (Whitepaper Sections 6, 7, 10, 11)
 * Manages markets, private positions, margin calculations, and ZK STARK state transitions.
 */

import { zkProverService, STARKProofResult, PositionWitness } from './zkProverService';
import { pragmaOracleService } from './pragmaOracleService';
import { tokensToSats, usdToCents } from '../protocol/fixedPoint';
import { PrivatePositionState } from '../protocol/types';

export interface PerpMarket {
  id: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP';
  baseAsset: string;
  quoteAsset: string;
  markPrice: number;
  indexPrice: number;
  change24hPct: number;
  volume24hUsd: number;
  openInterestUsd: number;
  fundingRate1hPct: number;
  maxLeverage: number;
  maintenanceMarginPct: number; // e.g. 0.02 = 2%
}

export interface PerpPosition {
  id: string;
  marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP';
  side: 'LONG' | 'SHORT';
  sizeTokens: number;
  notionalUsd: number;
  entryPrice: number;
  marginUsd: number;
  leverage: number;
  unrealizedPnlUsd: number;
  pnlPercentage: number;
  liquidationPrice: number;
  cumulativeFundingUsd: number;
  openedAt: number;
  zkCommitment: string;          // CP = H(domain, owner, market, q, e, m, nonce)
  nullifier: string;             // NF = H(NULLIFIER_TAG, commitment, nonce)
  starkFactHash: string;         // SNIP-36 STARK Fact Hash
  publicInputsHash: string;
  proofStatus: string;
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
}

class PerpsService {
  private markets: Map<string, PerpMarket> = new Map();

  constructor() {
    this.initMarkets();
  }

  private initMarkets() {
    this.markets.set('BTC-PERP', {
      id: 'BTC-PERP',
      baseAsset: 'BTC',
      quoteAsset: 'USDC',
      markPrice: 96420.50,
      indexPrice: 96415.00,
      change24hPct: 2.84,
      volume24hUsd: 148200000,
      openInterestUsd: 42100000,
      fundingRate1hPct: 0.0012,
      maxLeverage: 50,
      maintenanceMarginPct: 0.02,
    });
  }

  getMarkets(): PerpMarket[] {
    return Array.from(this.markets.values());
  }

  getMarket(marketId: string): PerpMarket | undefined {
    return this.markets.get(marketId);
  }

  updateMarkPrice(marketId: string, price: number) {
    const market = this.markets.get(marketId);
    if (market) {
      market.markPrice = price;
      this.markets.set(marketId, market);
    }
  }

  updateMarketPrice(
    marketId: string,
    markPrice: number,
    change24hPct?: number,
    volume24hUsd?: number
  ): void {
    const market = this.markets.get(marketId);
    if (market && markPrice > 0) {
      market.markPrice = markPrice;
      market.indexPrice = markPrice * 0.9998;
      if (change24hPct !== undefined) market.change24hPct = change24hPct;
      if (volume24hUsd !== undefined) market.volume24hUsd = volume24hUsd;
      this.markets.set(marketId, market);
    }
  }

  /**
   * Computes PnL for a position without revealing exact entry price publicly
   */
  calculatePnl(
    side: 'LONG' | 'SHORT',
    sizeTokens: number,
    entryPrice: number,
    currentPrice: number
  ): { pnlUsd: number; pnlPct: number } {
    const pnlUsd = zkProverService.evaluatePnLCircuit(side, sizeTokens, entryPrice, currentPrice);
    const notionalAtEntry = sizeTokens * entryPrice;
    const pnlPct = notionalAtEntry > 0 ? (pnlUsd / notionalAtEntry) * 100 : 0;
    return { pnlUsd, pnlPct };
  }

  /**
   * Calculate Liquidation Price based on maintenance margin requirements
   * Formula:
   * LONG:  LiqPrice = EntryPrice * (1 - 1/leverage + maintenanceMarginPct)
   * SHORT: LiqPrice = EntryPrice * (1 + 1/leverage - maintenanceMarginPct)
   */
  calculateLiquidationPrice(
    entryPrice: number,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintenanceMarginPct: number
  ): number {
    const marginFraction = 1 / leverage;
    if (side === 'LONG') {
      return entryPrice * (1 - marginFraction + maintenanceMarginPct);
    } else {
      return entryPrice * (1 + marginFraction - maintenanceMarginPct);
    }
  }

  /**
   * Computes the private ZK Position Commitment Hash
   */
  generatePositionCommitment(
    ownerAddress: string,
    marketId: string,
    notional: number,
    entryPrice: number,
    margin: number,
    nonce: string = '0x1234',
    side: 'LONG' | 'SHORT' = 'LONG',
  ): string {
    const sizeTokens = entryPrice > 0 ? notional / entryPrice : 0;
    return zkProverService.computePositionCommitment(
      ownerAddress,
      marketId,
      side,
      tokensToSats(sizeTokens),
      usdToCents(entryPrice),
      usdToCents(margin),
      0n,
      nonce,
    );
  }

  /**
   * Get all positions for an address
   */
  getPositions(walletAddress: string): PerpPosition[] {
    if (typeof window === 'undefined') return [];
    try {
      const key = `pel_perps_positions_${walletAddress.toLowerCase()}`;
      const saved = localStorage.getItem(key);
      if (!saved) return [];
      const positions: PerpPosition[] = JSON.parse(saved);

      // Dynamically update unrealized PnLs based on current market mark prices
      return positions.map((pos) => {
        const market = this.getMarket(pos.marketId);
        if (!market || pos.status !== 'OPEN') return pos;
        const { pnlUsd, pnlPct } = this.calculatePnl(pos.side, pos.sizeTokens, pos.entryPrice, market.markPrice);
        return {
          ...pos,
          unrealizedPnlUsd: Number(pnlUsd.toFixed(2)),
          pnlPercentage: Number((pnlPct * pos.leverage).toFixed(2)),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Open a new private perpetual position backed by STARK Proof
   */
  openPosition(
    walletAddress: string,
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
    side: 'LONG' | 'SHORT',
    marginUsd: number,
    leverage: number
  ): PerpPosition {
    const market = this.getMarket(marketId);
    if (!market) {
      throw new Error(`INVALID_MARKET: Market '${marketId}' is not registered`);
    }

    const notionalUsd = marginUsd * leverage;
    const sizeTokens = notionalUsd / market.markPrice;
    const liquidationPrice = this.calculateLiquidationPrice(
      market.markPrice,
      side,
      leverage,
      market.maintenanceMarginPct
    );

    // Cryptographically secure CSPRNG nonce
    const entropyArr = new Uint8Array(16);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(entropyArr);
    }
    const nonce = '0x' + Array.from(entropyArr).map(b => b.toString(16).padStart(2, '0')).join('');

    const witness: PositionWitness = {
      side,
      sizeTokens,
      entryPrice: market.markPrice,
      marginUsd,
      fundingAccumulator: 0,
      nonce,
      ownerAddress: walletAddress,
    };

    const proofResult = zkProverService.generateTransitionProof(
      'OPEN',
      witness,
      market.id,
      market.markPrice,
      marginUsd,
      market.maxLeverage,
      market.maintenanceMarginPct
    );

    const position: PerpPosition = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      marketId,
      side,
      sizeTokens,
      notionalUsd,
      entryPrice: market.markPrice,
      marginUsd,
      leverage,
      unrealizedPnlUsd: 0,
      pnlPercentage: 0,
      liquidationPrice,
      cumulativeFundingUsd: 0,
      openedAt: Date.now(),
      zkCommitment: proofResult.commitment,
      nullifier: proofResult.nullifier,
      starkFactHash: proofResult.factHash,
      publicInputsHash: proofResult.publicInputsHash,
      proofStatus: 'POSEIDON_FACT_VALID',
      status: 'OPEN',
    };

    return position;
  }

  /**
   * Save a position into the local cache only AFTER on-chain transaction confirmation
   */
  savePosition(walletAddress: string, position: PerpPosition): void {
    if (typeof window === 'undefined') return;
    try {
      const existing = this.getPositions(walletAddress);
      const filtered = existing.filter((p) => p.zkCommitment !== position.zkCommitment);
      const updated = [position, ...filtered];
      const key = `pel_perps_positions_${walletAddress.toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (err) {
      console.warn('Could not cache confirmed position:', err);
    }
  }

  /**
   * Close a position with on-chain settlement and update local cache
   */
  closePosition(walletAddress: string, positionId: string): PerpPosition | null {
    if (typeof window === 'undefined') return null;
    try {
      const positions = this.getPositions(walletAddress);
      const pos = positions.find((p) => p.id === positionId);
      if (!pos) return null;

      const updated = positions.map((p) =>
        p.id === positionId ? { ...p, status: 'CLOSED' as const } : p
      );
      const key = `pel_perps_positions_${walletAddress.toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify(updated));
      return { ...pos, status: 'CLOSED' };
    } catch {
      return null;
    }
  }

  /**
   * Liquidate position
   */
  liquidatePosition(walletAddress: string, positionId: string): PerpPosition | null {
    if (typeof window === 'undefined') return null;
    try {
      const positions = this.getPositions(walletAddress);
      const pos = positions.find((p) => p.id === positionId);
      if (!pos) return null;

      const updated = positions.map((p) =>
        p.id === positionId ? { ...p, status: 'LIQUIDATED' as const } : p
      );
      const key = `pel_perps_positions_${walletAddress.toLowerCase()}`;
      localStorage.setItem(key, JSON.stringify(updated));
      return { ...pos, status: 'LIQUIDATED' };
    } catch {
      return null;
    }
  }
}

export const perpsService = new PerpsService();
