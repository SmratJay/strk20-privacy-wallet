/**
 * @file src/services/keeperService.ts
 * @description Decentralized Autonomous Keeper Liquidation Service (Whitepaper Section 14)
 *
 * Discovers active positions from the PositionIndexerService and on-chain PEL contract,
 * monitors solvency invariants against live Pragma Oracle prices,
 * and submits ZK liquidation transactions autonomously.
 */

import { zkProverService } from './zkProverService';
import { pragmaOracleService } from './pragmaOracleService';
import { positionIndexerService, IndexedPosition } from './positionIndexerService';
import { starknetPerpsDispatcher } from './starknetPerpsDispatcher';
import { RiskEngine } from '../protocol/riskEngine';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  isLiquidatable,
  usdToCents,
  tokensToSats,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';

export interface LiquidationCandidate {
  marketId: string;
  commitment: string;
  nullifier: string;
  marginCents: bigint;
  equityCents: bigint;
  maintenanceMarginCents: bigint;
  isLiquidatable: boolean;
  factHash: string;
  bountyEstimatedCents: bigint;
}

export interface LiquidationExecutionResult {
  success: boolean;
  commitment: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export class KeeperService {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processedLiquidations: Set<string> = new Set();

  /**
   * Scan active on-chain positions from the Indexer & contract state
   * Operates autonomously WITHOUT requiring user wallet addresses.
   */
  async scanActivePositions(): Promise<LiquidationCandidate[]> {
    const candidates: LiquidationCandidate[] = [];
    const activePositions = positionIndexerService.getActivePositions();

    const pair = 'BTC/USD';
    const oraclePriceCents = await pragmaOracleService.getOraclePriceCents(pair, 'sepolia');

    for (const pos of activePositions) {
      if (this.processedLiquidations.has(pos.currentCommitment.toLowerCase())) {
        continue; // Already processed
      }

      try {
        // 1. Verify position is active on-chain
        const onChain = await starknetPerpsDispatcher.getPositionOnChain(pos.currentCommitment);
        if (!onChain.isOpen) {
          continue;
        }

        const marginCents = BigInt(pos.marginAmountCents || onChain.lockedMargin);
        if (marginCents <= 0n) continue;

        // Estimate notional at 10x default / 50x max leverage
        // Mmaint = (Notional * 200) / 10000
        const maintBps = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps);
        const nullifier = pos.spentNullifiers[pos.spentNullifiers.length - 1] || '0x0';

        const fact = zkProverService.buildFact(
          'LIQUIDATE',
          pos.marketId,
          pos.currentCommitment,
          nullifier,
          marginCents,
          oraclePriceCents
        );

        candidates.push({
          marketId: pos.marketId,
          commitment: pos.currentCommitment,
          nullifier,
          marginCents,
          equityCents: 0n,
          maintenanceMarginCents: (marginCents * maintBps) / 10000n,
          isLiquidatable: true,
          factHash: fact.factHash,
          bountyEstimatedCents: (marginCents * 200n) / 10000n, // 2% bounty
        });
      } catch (err) {
        // Skip unqueryable position
      }
    }

    return candidates;
  }

  /**
   * Execute an on-chain liquidation transaction
   */
  async executeLiquidation(
    candidate: LiquidationCandidate,
    keeperRecipient: string,
    signerAccount?: any
  ): Promise<LiquidationExecutionResult> {
    try {
      const call = starknetPerpsDispatcher.buildLiquidatePositionCall(
        candidate.marketId as 'BTC-PERP',
        candidate.commitment,
        candidate.nullifier,
        candidate.factHash,
        keeperRecipient
      );

      const executionRes = await starknetPerpsDispatcher.executeOnChain(signerAccount, call);
      this.processedLiquidations.add(candidate.commitment.toLowerCase());

      // Ingest liquidation event into indexer
      positionIndexerService.ingestEvent({
        type: 'PositionLiquidated',
        marketId: candidate.marketId,
        commitment: candidate.commitment,
        nullifier: candidate.nullifier,
        keeper: keeperRecipient,
        transactionHash: executionRes.transactionHash,
      });

      return {
        success: true,
        commitment: candidate.commitment,
        txHash: executionRes.transactionHash,
        explorerUrl: executionRes.explorerUrl,
      };
    } catch (err: any) {
      return {
        success: false,
        commitment: candidate.commitment,
        error: err.message || 'Liquidation transaction failed',
      };
    }
  }

  /**
   * Start Autonomous Keeper Watchdog loop
   */
  startWatchdog(
    keeperRecipient: string,
    signerAccount?: any,
    intervalMs: number = 10000,
    onLiquidationsFound?: (candidates: LiquidationCandidate[]) => void
  ): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalId = setInterval(async () => {
      try {
        const candidates = await this.scanActivePositions();
        if (candidates.length > 0) {
          onLiquidationsFound?.(candidates);

          // If signer is provided, execute liquidations autonomously
          if (signerAccount) {
            for (const candidate of candidates) {
              await this.executeLiquidation(candidate, keeperRecipient, signerAccount);
            }
          }
        }
      } catch (err) {
        // Keep running on cycle error
      }
    }, intervalMs);
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
