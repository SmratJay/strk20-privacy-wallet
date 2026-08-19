/**
 * @file keeperService.ts
 * @description Decentralized Keeper Liquidation Watchdog (Whitepaper Section 14)
 * Monitors private positions, verifies solvency invariants, and executes automated ZK liquidations.
 */

import { zkProverService } from './zkProverService';
import { pragmaOracleService } from './pragmaOracleService';
import { perpsService, PerpPosition } from './perpsService';
import { starknetPerpsDispatcher } from './starknetPerpsDispatcher';

export interface LiquidationCandidate {
  position: PerpPosition;
  equityUsd: number;
  maintenanceMarginUsd: number;
  isLiquidatable: boolean;
  factHash: string;
  bountyEstimatedUsd: number;
}

class KeeperService {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  /**
   * Scan a set of positions against live Pragma Oracle prices
   */
  async scanPositionsForLiquidation(positions: PerpPosition[]): Promise<LiquidationCandidate[]> {
    const candidates: LiquidationCandidate[] = [];

    for (const pos of positions) {
      if (pos.status !== 'OPEN') continue;

      try {
        const pair = pos.marketId === 'BTC-PERP' ? 'BTC/USD' : pos.marketId === 'ETH-PERP' ? 'ETH/USD' : 'STRK/USD';
        const feed = await pragmaOracleService.getMarketPrice(pair as any);
        const currentPrice = feed.priceUsd;

        const pnlUsd = zkProverService.evaluatePnLCircuit(pos.side, pos.sizeTokens, pos.entryPrice, currentPrice);
        const fundingUsd = zkProverService.evaluateFundingCircuit(pos.sizeTokens, currentPrice, 0.0012, 1);

        const market = perpsService.getMarket(pos.marketId);
        const maintPct = market?.maintenanceMarginPct || 0.02;

        const { isLiquidatable, factHash } = zkProverService.evaluateLiquidationCircuit(
          pos.marginUsd,
          pnlUsd,
          fundingUsd,
          0,
          pos.sizeTokens,
          currentPrice,
          maintPct
        );

        const equityUsd = pos.marginUsd + pnlUsd - fundingUsd;
        const maintenanceMarginUsd = pos.sizeTokens * currentPrice * maintPct;

        if (isLiquidatable) {
          candidates.push({
            position: pos,
            equityUsd: Number(equityUsd.toFixed(2)),
            maintenanceMarginUsd: Number(maintenanceMarginUsd.toFixed(2)),
            isLiquidatable: true,
            factHash,
            bountyEstimatedUsd: Number((maintenanceMarginUsd * 0.05).toFixed(2)), // 5% keeper bounty
          });
        }
      } catch {
        // Continue scan
      }
    }

    return candidates;
  }

  /**
   * Start Keeper Watchdog loop
   */
  startWatchdog(
    walletAddress: string,
    onLiquidationsFound?: (candidates: LiquidationCandidate[]) => void
  ): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalId = setInterval(async () => {
      const positions = perpsService.getPositions(walletAddress);
      const candidates = await this.scanPositionsForLiquidation(positions);
      if (candidates.length > 0 && onLiquidationsFound) {
        onLiquidationsFound(candidates);
      }
    }, 10000); // Check every 10s
  }

  /**
   * Stop Keeper Watchdog
   */
  stopWatchdog(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }
}

export const keeperService = new KeeperService();
