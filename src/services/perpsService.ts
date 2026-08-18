/**
 * @file perpsService.ts
 * @description PEL Privacy-Native Perpetual Derivatives Engine (Sections 7 & 13.3)
 * Manages markets, private positions, margin calculations, and ZK state commitments.
 */

import { hash } from 'starknet';

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
  zkCommitment: string; // CP = H(domain, owner, market, q, e, m, nonce)
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
}

const DEFAULT_MARKETS: PerpMarket[] = [
  {
    id: 'BTC-PERP',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    markPrice: 96420.50,
    indexPrice: 96415.00,
    change24hPct: 2.85,
    volume24hUsd: 142500000,
    openInterestUsd: 85200000,
    fundingRate1hPct: 0.0012,
    maxLeverage: 50,
    maintenanceMarginPct: 0.02,
  },
  {
    id: 'ETH-PERP',
    baseAsset: 'ETH',
    quoteAsset: 'USD',
    markPrice: 3418.75,
    indexPrice: 3416.50,
    change24hPct: -1.20,
    volume24hUsd: 89400000,
    openInterestUsd: 41200000,
    fundingRate1hPct: 0.0008,
    maxLeverage: 50,
    maintenanceMarginPct: 0.025,
  },
  {
    id: 'STRK-PERP',
    baseAsset: 'STRK',
    quoteAsset: 'USD',
    markPrice: 0.584,
    indexPrice: 0.583,
    change24hPct: 8.45,
    volume24hUsd: 32100000,
    openInterestUsd: 12400000,
    fundingRate1hPct: 0.0018,
    maxLeverage: 25,
    maintenanceMarginPct: 0.04,
  },
];

class PerpsService {
  private markets: PerpMarket[] = DEFAULT_MARKETS;

  getMarkets(): PerpMarket[] {
    return this.markets;
  }

  getMarket(id: string): PerpMarket | undefined {
    return this.markets.find((m) => m.id === id);
  }

  /**
   * Calculate Liquidation Price according to Section 7.1 & A.6:
   * Et = m + PnL - F - fees <= Mmaint
   */
  calculateLiquidationPrice(
    entryPrice: number,
    side: 'LONG' | 'SHORT',
    leverage: number,
    maintenanceMarginPct: number
  ): number {
    const marginFraction = 1 / leverage;
    if (side === 'LONG') {
      // Long: LiqPrice = EntryPrice * (1 - marginFraction + maintenanceMarginPct)
      return entryPrice * (1 - marginFraction + maintenanceMarginPct);
    } else {
      // Short: LiqPrice = EntryPrice * (1 + marginFraction - maintenanceMarginPct)
      return entryPrice * (1 + marginFraction - maintenanceMarginPct);
    }
  }

  /**
   * Calculate PnL (Section 7.1):
   * Long: q * (Pt - e)
   * Short: q * (e - Pt)
   */
  calculatePnl(
    side: 'LONG' | 'SHORT',
    sizeTokens: number,
    entryPrice: number,
    currentPrice: number
  ): { pnlUsd: number; pnlPct: number } {
    let pnlUsd = 0;
    if (side === 'LONG') {
      pnlUsd = sizeTokens * (currentPrice - entryPrice);
    } else {
      pnlUsd = sizeTokens * (entryPrice - currentPrice);
    }
    const initialMargin = (sizeTokens * entryPrice);
    const pnlPct = initialMargin > 0 ? (pnlUsd / initialMargin) * 100 : 0;
    return { pnlUsd, pnlPct };
  }

  /**
   * Generate ZK State Commitment for Position (Section 7.3):
   * CP = Poseidon(POSITION_TAG, ownerAddress, marketId, notional, entry, margin, nonce)
   */
  generatePositionCommitment(
    ownerAddress: string,
    marketId: string,
    notional: number,
    entryPrice: number,
    margin: number
  ): string {
    const POSITION_TAG = '0x504f534954494f4e5f5441473a5631'; // POSITION_TAG:V1
    const ownerHex = ownerAddress.startsWith('0x') ? ownerAddress : '0x' + ownerAddress;
    const marketHex = '0x' + Buffer.from(marketId).toString('hex');
    const notionalHex = '0x' + Math.floor(notional * 100).toString(16);
    const entryHex = '0x' + Math.floor(entryPrice * 100).toString(16);
    const marginHex = '0x' + Math.floor(margin * 100).toString(16);
    const nonceHex = '0x' + Date.now().toString(16);

    return hash.computePoseidonHashOnElements([
      POSITION_TAG,
      ownerHex,
      marketHex,
      notionalHex,
      entryHex,
      marginHex,
      nonceHex,
    ]);
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
   * Open a new private perpetual position
   */
  openPosition(
    walletAddress: string,
    marketId: 'BTC-PERP' | 'ETH-PERP' | 'STRK-PERP',
    side: 'LONG' | 'SHORT',
    marginUsd: number,
    leverage: number
  ): PerpPosition {
    const market = this.getMarket(marketId) || DEFAULT_MARKETS[0];
    const notionalUsd = marginUsd * leverage;
    const sizeTokens = notionalUsd / market.markPrice;
    const liquidationPrice = this.calculateLiquidationPrice(
      market.markPrice,
      side,
      leverage,
      market.maintenanceMarginPct
    );
    const zkCommitment = this.generatePositionCommitment(
      walletAddress,
      marketId,
      notionalUsd,
      market.markPrice,
      marginUsd
    );

    const newPosition: PerpPosition = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      marketId,
      side,
      sizeTokens: Number(sizeTokens.toFixed(6)),
      notionalUsd: Number(notionalUsd.toFixed(2)),
      entryPrice: market.markPrice,
      marginUsd: Number(marginUsd.toFixed(2)),
      leverage,
      unrealizedPnlUsd: 0,
      pnlPercentage: 0,
      liquidationPrice: Number(liquidationPrice.toFixed(2)),
      cumulativeFundingUsd: 0,
      openedAt: Date.now(),
      zkCommitment,
      status: 'OPEN',
    };

    if (typeof window !== 'undefined') {
      const current = this.getPositions(walletAddress);
      const updated = [newPosition, ...current];
      localStorage.setItem(`pel_perps_positions_${walletAddress.toLowerCase()}`, JSON.stringify(updated));
    }

    return newPosition;
  }

  /**
   * Close a position
   */
  closePosition(walletAddress: string, positionId: string): PerpPosition | null {
    if (typeof window === 'undefined') return null;
    const key = `pel_perps_positions_${walletAddress.toLowerCase()}`;
    const current = this.getPositions(walletAddress);
    const targetIdx = current.findIndex((p) => p.id === positionId);
    if (targetIdx === -1) return null;

    current[targetIdx].status = 'CLOSED';
    localStorage.setItem(key, JSON.stringify(current));
    return current[targetIdx];
  }
}

export const perpsService = new PerpsService();
