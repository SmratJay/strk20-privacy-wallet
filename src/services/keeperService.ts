/**
 * @file src/services/keeperService.ts
 * @description Decentralized Autonomous Keeper Liquidation Service (Whitepaper Section 14)
 *
 * Discovers active positions from the PositionIndexerService and on-chain PEL contract,
 * monitors solvency invariants against live Pragma Oracle prices,
 * and submits Groth16 zk-SNARK liquidation transactions autonomously.
 */

import { pelCircuitService } from './pelCircuitService';
import { pragmaOracleService } from './pragmaOracleService';
import { positionIndexerService } from './positionIndexerService';
import { starknetPerpsDispatcher } from './starknetPerpsDispatcher';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  isLiquidatable,
  usdToCents,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';
import { findWitnessByCommitment } from '../protocol/witnessStore';

export interface LiquidationCandidate {
  marketId: string;
  commitment: string;
  nullifier: string;
  marginCents: bigint;
  equityCents: bigint;
  maintenanceMarginCents: bigint;
  isLiquidatable: boolean;
  calldata?: (bigint | string)[];
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

    const keeperRecipient = process.env.KEEPER_ADDRESS || process.env.NEXT_PUBLIC_KEEPER_ADDRESS || '0x01';
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

        // 2. Load position witness for mathematical solvency evaluation
        const witness = findWitnessByCommitment(pos.currentCommitment);
        if (!witness) {
          continue;
        }

        const pnlCents = calcPnlCents(witness.side, witness.quantitySats, witness.entryPriceCents, oraclePriceCents);
        const equityCents = calcEquityCents(witness.marginCents, pnlCents, witness.fundingCents || 0n, witness.feesCents || 0n);
        const maintMarginCents = calcMaintMarginCents(witness.quantitySats, oraclePriceCents, maintBps);

        const liquidatable = isLiquidatable(equityCents, maintMarginCents);
        if (!liquidatable) {
          // Healthy position: reject from liquidation queue
          continue;
        }

        // Build valid LIQUIDATE proof via Groth16 circuit
        const nonceVal = typeof witness.nonce === 'bigint' ? witness.nonce : BigInt(witness.nonce.startsWith('0x') ? witness.nonce : '0x' + witness.nonce);
        const ownerSecretVal = typeof witness.ownerSecret === 'bigint' ? witness.ownerSecret : BigInt(witness.ownerSecret.startsWith('0x') ? witness.ownerSecret : '0x' + witness.ownerSecret);
        const keeperVal = BigInt(keeperRecipient.startsWith('0x') ? keeperRecipient : '0x' + keeperRecipient);

        const liqProof = await pelCircuitService.generateLiquidateProof({
          side: witness.side === 'LONG' ? 0n : 1n,
          quantitySats: witness.quantitySats,
          entryPriceCents: witness.entryPriceCents,
          marginCents: witness.marginCents,
          fundingCents: witness.fundingCents || 0n,
          feesCents: witness.feesCents || 0n,
          nonce: nonceVal,
          ownerSecret: ownerSecretVal,
          markPriceCents: oraclePriceCents,
          keeper: keeperVal,
        });

        candidates.push({
          marketId: pos.marketId,
          commitment: pos.currentCommitment,
          nullifier: '0x' + liqProof.nullifier.toString(16),
          marginCents,
          equityCents,
          maintenanceMarginCents: maintMarginCents,
          isLiquidatable: true,
          calldata: liqProof.calldata,
          bountyEstimatedCents: (marginCents * 200n) / 10000n, // 2% bounty
        });
      } catch (err: any) {
        this.lastError = err.message || 'Position scan error';
      }
    }

    return candidates;
  }

  /**
   * Execute an on-chain liquidation transaction with Groth16 proof calldata.
   */
  async executeLiquidation(
    candidate: LiquidationCandidate,
    keeperRecipient: string,
    signerAccount?: any
  ): Promise<LiquidationExecutionResult> {
    const idempotencyKey = candidate.commitment.toLowerCase();
    this.inFlightTransactions.add(idempotencyKey);

    try {
      // Build & Execute Core.liquidate_position Call with Groth16 calldata
      const call = starknetPerpsDispatcher.buildLiquidatePositionCall(
        keeperRecipient,
        candidate.marketId as 'BTC-PERP',
        candidate.calldata || [5n, candidate.commitment, candidate.nullifier, 0x4254432d50455250n, this.lastOraclePriceCents, keeperRecipient]
      );

      const executionRes = await starknetPerpsDispatcher.executeOnChain(signerAccount, call);

      // Strict Fail-Closed Finality Assertion
      const onChainRecord = await starknetPerpsDispatcher.getPositionOnChain(candidate.commitment);
      if (onChainRecord.isOpen) {
        this.inFlightTransactions.delete(idempotencyKey);
        this.lastError = 'FINALITY_UNCONFIRMED: Position remains open on-chain after transaction broadcast';
        return {
          success: false,
          commitment: candidate.commitment,
          txHash: executionRes.transactionHash,
          explorerUrl: executionRes.explorerUrl,
          error: this.lastError,
        };
      }

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

  start(intervalMs: number = 10000, signerAccount?: any) {
    if (this.isRunning) return;
    this.isRunning = true;
    const keeperRecipient = process.env.KEEPER_ADDRESS || process.env.NEXT_PUBLIC_KEEPER_ADDRESS || '0x01';

    this.intervalId = setInterval(async () => {
      try {
        const candidates = await this.scanActivePositions();
        for (const candidate of candidates) {
          await this.executeLiquidation(candidate, keeperRecipient, signerAccount);
        }
      } catch (err: any) {
        this.lastError = err.message || 'Keeper loop error';
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  getHealthStatus(): KeeperHealthStatus {
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
