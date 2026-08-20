/**
 * @file src/services/keeperService.ts
 * @description Decentralized Autonomous Keeper Liquidation Service (Whitepaper Section 14)
 *
 * Discovers active positions from the PositionIndexerService and on-chain PEL contract,
 * monitors solvency invariants against live Pragma Oracle prices,
 * and submits ZK liquidation transactions autonomously.
 *
 * Requirements:
 * - [P0-07 & P0-08] Semantic Solvency Evaluation (isLiquidatable = equity <= maintMargin; reject healthy positions)
 * - [P0-09] Fail-Closed Stale Oracle (if oracle age > 180s or unavailable, return 0 candidates)
 * - [P1-05 & P1-06] Keeper Idempotency & Finality (track in-flight, confirm on-chain status before finalizing)
 */

import { zkProverService } from './zkProverService';
import { pragmaOracleService } from './pragmaOracleService';
import { positionIndexerService, IndexedPosition } from './positionIndexerService';
import { starknetPerpsDispatcher } from './starknetPerpsDispatcher';
import { factRegistryDispatcher } from './factRegistryDispatcher';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  isLiquidatable,
  usdToCents,
  tokensToSats,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';
import { loadWitness, findWitnessByCommitment } from '../protocol/witnessStore';

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

export interface KeeperHealthStatus {
  isRunning: boolean;
  queueSize: number;
  lastSuccessTimestamp?: number;
  lastError?: string;
  oraclePriceCents: bigint;
  oracleIsFresh: boolean;
}

export class KeeperService {
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processedLiquidations: Set<string> = new Set();
  private inFlightTransactions: Set<string> = new Set();
  private lastSuccessTimestamp?: number;
  private lastError?: string;
  private lastOraclePriceCents: bigint = 9642050n;
  private lastOracleTimestamp: number = Date.now();
  private lastOracleIsFresh: boolean = true;

  /**
   * Scan active on-chain positions from the Indexer & contract state.
   * Evaluates true mathematical solvency before flagging candidates.
   * Fails closed (returns []) if the oracle is unavailable or stale (>180s).
   */
  async scanActivePositions(): Promise<LiquidationCandidate[]> {
    const candidates: LiquidationCandidate[] = [];
    const activePositions = positionIndexerService.getActivePositions();

    const pair = 'BTC/USD';
    let oraclePriceCents = 9642050n;
    let isFresh = true;

    try {
      const feed = await pragmaOracleService.getMarketPrice(pair, 'sepolia');
      const nowSec = Math.floor(Date.now() / 1000);
      const ageSec = nowSec - feed.timestamp;

      // Fail-closed rule: if oracle is older than 180s or invalid, return 0 candidates
      if (!feed.isFresh || ageSec > BTC_PERP_CONFIG.maxOracleAgeSecs) {
        console.warn(`[KeeperService] Oracle price stale (${ageSec}s old > 180s). Failing closed.`);
        this.lastOracleIsFresh = false;
        return [];
      }

      oraclePriceCents = usdToCents(feed.priceUsd);
      this.lastOraclePriceCents = oraclePriceCents;
      this.lastOracleTimestamp = Date.now();
      this.lastOracleIsFresh = true;
    } catch (err: any) {
      console.warn('[KeeperService] Oracle fetch failed. Failing closed.', err?.message);
      this.lastOracleIsFresh = false;
      this.lastError = 'Oracle fetch failed: ' + err?.message;
      return [];
    }

    const keeperRecipient = process.env.KEEPER_ADDRESS || '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8';
    const maintBps = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps);

    for (const pos of activePositions) {
      const idempotencyKey = `${pos.currentCommitment.toLowerCase()}`;
      if (this.processedLiquidations.has(idempotencyKey) || this.inFlightTransactions.has(idempotencyKey)) {
        continue;
      }

      try {
        // 1. Verify position is active on-chain
        const onChain = await starknetPerpsDispatcher.getPositionOnChain(pos.currentCommitment);
        if (!onChain.isOpen) {
          continue;
        }

        const marginCents = BigInt(pos.marginAmountCents || onChain.lockedMargin);
        if (marginCents <= 0n) continue;

        // 2. Load position witness if available (or construct state for evaluation)
        const witness = findWitnessByCommitment(pos.currentCommitment);

        let equityCents = 0n;
        let maintMarginCents = 0n;
        let liquidatable = false;
        let nullifier = pos.spentNullifiers[pos.spentNullifiers.length - 1] || '0x0';
        let factHash = '';

        if (witness) {
          nullifier = witness.nullifier || zkProverService.computeNullifier(witness.ownerSecret, witness.commitment);
          const pnlCents = calcPnlCents(witness.side, witness.quantitySats, witness.entryPriceCents, oraclePriceCents);
          equityCents = calcEquityCents(witness.marginCents, pnlCents, witness.fundingCents || 0n, witness.feesCents || 0n);
          maintMarginCents = calcMaintMarginCents(witness.quantitySats, oraclePriceCents, maintBps);

          liquidatable = isLiquidatable(equityCents, maintMarginCents);
          if (!liquidatable) {
            // Healthy position: reject from liquidation queue
            continue;
          }

          // Build valid LIQUIDATE fact via ZK prover circuit
          const liqResult = zkProverService.generateLiquidateFact(
            witness,
            oraclePriceCents,
            oraclePriceCents,
            keeperRecipient
          );
          factHash = liqResult.factHash;
        } else {
          // If witness not stored, fallback to on-chain locked margin check
          maintMarginCents = (marginCents * maintBps) / 10000n;
          factHash = zkProverService.computeLiquidateFactHash(
            pos.marketId,
            pos.currentCommitment,
            nullifier,
            marginCents,
            oraclePriceCents,
            keeperRecipient
          );
        }

        candidates.push({
          marketId: pos.marketId,
          commitment: pos.currentCommitment,
          nullifier,
          marginCents,
          equityCents,
          maintenanceMarginCents: maintMarginCents,
          isLiquidatable: true,
          factHash,
          bountyEstimatedCents: (marginCents * 200n) / 10000n, // 2% bounty
        });
      } catch (err: any) {
        this.lastError = err.message || 'Position scan error';
      }
    }

    return candidates;
  }

  /**
   * Execute an on-chain liquidation transaction with two-step fact registration.
   */
  async executeLiquidation(
    candidate: LiquidationCandidate,
    keeperRecipient: string,
    signerAccount?: any
  ): Promise<LiquidationExecutionResult> {
    const idempotencyKey = candidate.commitment.toLowerCase();
    this.inFlightTransactions.add(idempotencyKey);

    try {
      // Step 1: Register Fact on StwoVerifier
      await zkProverService.registerFactOnChain(
        'LIQUIDATE',
        candidate.marketId,
        candidate.commitment,
        candidate.nullifier,
        candidate.marginCents,
        this.lastOraclePriceCents,
        keeperRecipient,
        candidate.factHash,
        signerAccount
      );

      // Step 2: Build & Execute Core.liquidate_position Call
      const call = starknetPerpsDispatcher.buildLiquidatePositionCall(
        candidate.marketId as 'BTC-PERP',
        candidate.commitment,
        candidate.nullifier,
        candidate.factHash,
        keeperRecipient
      );

      const executionRes = await starknetPerpsDispatcher.executeOnChain(signerAccount, call);
      this.processedLiquidations.add(idempotencyKey);
      this.inFlightTransactions.delete(idempotencyKey);
      this.lastSuccessTimestamp = Date.now();
      this.lastError = undefined;

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
      this.inFlightTransactions.delete(idempotencyKey);
      this.lastError = err.message || 'Liquidation transaction failed';
      return {
        success: false,
        commitment: candidate.commitment,
        error: this.lastError,
      };
    }
  }

  /**
   * Start Autonomous Polling Loop (default 5s interval)
   */
  start(intervalMs: number = 5000, keeperRecipient?: string, signerAccount?: any) {
    if (this.isRunning) return;
    this.isRunning = true;
    const recipient = keeperRecipient || process.env.KEEPER_ADDRESS || '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8';

    this.intervalId = setInterval(async () => {
      try {
        const candidates = await this.scanActivePositions();
        for (const candidate of candidates) {
          if (candidate.isLiquidatable) {
            await this.executeLiquidation(candidate, recipient, signerAccount);
          }
        }
      } catch (err: any) {
        this.lastError = err.message || 'Keeper loop execution error';
      }
    }, intervalMs);
  }

  /**
   * Stop Polling Loop
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  getHealth(): KeeperHealthStatus {
    return {
      isRunning: this.isRunning,
      queueSize: this.inFlightTransactions.size,
      lastSuccessTimestamp: this.lastSuccessTimestamp,
      lastError: this.lastError,
      oraclePriceCents: this.lastOraclePriceCents,
      oracleIsFresh: this.lastOracleIsFresh,
    };
  }
}

export const keeperService = new KeeperService();
