/**
 * @file keeperService.ts
 * @description Decentralized Keeper Liquidation Watchdog (Whitepaper Section 14)
 * Discovers active on-chain positions from events/contracts, verifies solvency invariants, and executes automated ZK liquidations.
 */

import { zkProverService } from './zkProverService';
import { pragmaOracleService } from './pragmaOracleService';
import { perpsService, PerpPosition } from './perpsService';
import { starknetPerpsDispatcher } from './starknetPerpsDispatcher';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  calcFundingCentsPerInterval,
  isLiquidatable,
  usdToCents,
  tokensToSats,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';

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
  private trackedCommitments: Set<string> = new Set();

  /**
   * Register known on-chain commitments to the keeper discovery index
   */
  trackCommitment(commitment: string): void {
    if (commitment && commitment.startsWith('0x')) {
      this.trackedCommitments.add(commitment);
    }
  }

  /**
   * Scan active on-chain positions directly from Starknet
   * Invariant: Discovers position state from on-chain PEL contract.
   */
  async scanOnChainPositions(knownPositions: PerpPosition[] = []): Promise<LiquidationCandidate[]> {
    const candidates: LiquidationCandidate[] = [];

    // Track all incoming positions
    for (const p of knownPositions) {
      this.trackCommitment(p.zkCommitment);
    }

    for (const pos of knownPositions) {
      try {
        // Query on-chain position state to verify it is genuinely active on Starknet
        const onChain = await starknetPerpsDispatcher.getPositionOnChain(pos.zkCommitment);
        if (!onChain.isOpen) {
          continue; // Skip closed / non-active positions
        }

        const pair = pos.marketId === 'BTC-PERP' ? 'BTC/USD' : pos.marketId === 'ETH-PERP' ? 'ETH/USD' : 'STRK/USD';
        const feed = await pragmaOracleService.getMarketPrice(pair as any);
        const currentPrice = feed.priceUsd;

        const quantitySats    = tokensToSats(pos.sizeTokens);
        const entryPriceCents = usdToCents(pos.entryPrice);
        const currentPriceCents = usdToCents(currentPrice);
        const marginCents     = usdToCents(pos.marginUsd);

        const market = perpsService.getMarket(pos.marketId);
        const maintBps = BigInt(Math.floor((market?.maintenanceMarginPct || 0.02) * 10000));

        const pnlCents = calcPnlCents(pos.side, quantitySats, entryPriceCents, currentPriceCents);
        const fundingCents = calcFundingCentsPerInterval(quantitySats, currentPriceCents, 12n, 1n);
        const equityCents = calcEquityCents(marginCents, pnlCents, fundingCents, 0n);
        const maintMarginCents = calcMaintMarginCents(quantitySats, currentPriceCents, maintBps);

        const eligible = isLiquidatable(
          marginCents,
          pnlCents,
          fundingCents,
          0n,
          quantitySats,
          currentPriceCents,
          maintBps
        );

        if (eligible) {
          const fact = zkProverService.buildFact(
            'LIQUIDATE',
            pos.marketId,
            pos.zkCommitment,
            pos.nullifier,
            marginCents,
            currentPriceCents
          );

          candidates.push({
            position: pos,
            equityUsd: Number(equityCents) / 100,
            maintenanceMarginUsd: Number(maintMarginCents) / 100,
            isLiquidatable: true,
            factHash: fact.factHash,
            bountyEstimatedUsd: Number((pos.marginUsd * 0.02).toFixed(2)), // 2% protocol keeper bounty
          });
        }
      } catch {
        // Continue scan
      }
    }

    return candidates;
  }

  /**
   * Scan a set of positions against live Pragma Oracle prices
   */
  async scanPositionsForLiquidation(positions: PerpPosition[]): Promise<LiquidationCandidate[]> {
    return this.scanOnChainPositions(positions);
  }

  /**
   * Execute on-chain liquidation transaction
   */
  async executeLiquidation(
    candidate: LiquidationCandidate,
    keeperRecipient: string,
    signerAccount?: any
  ): Promise<{ txHash: string; explorerUrl: string }> {
    const call = starknetPerpsDispatcher.buildLiquidatePositionCall(
      candidate.position.marketId,
      candidate.position.zkCommitment,
      candidate.position.nullifier,
      candidate.factHash,
      keeperRecipient
    );

    const executionRes = await starknetPerpsDispatcher.executeOnChain(signerAccount, call);

    return {
      txHash: executionRes.transactionHash,
      explorerUrl: executionRes.explorerUrl,
    };
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
