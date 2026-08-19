/**
 * @file src/services/positionIndexerService.ts
 * @description Event-Driven Position Indexer & State Commitment Graph (Whitepaper Section 14)
 *
 * Discovers and reconstructs active on-chain position commitments from Starknet events
 * WITHOUT requiring user wallet addresses or exposing private witnesses.
 *
 * Reconstructs the active commitment graph:
 *   C0 (OPEN) -> C1 (UPDATE) -> C2 (FUND) -> [CLOSED | LIQUIDATED]
 */

import { RpcProvider, hash, num } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';
import { normalizeNetworkId } from '../config/networks';

export interface IndexedPosition {
  marketId: string;
  currentCommitment: string;
  initialCommitment: string;
  marginAmountCents: bigint;
  lockedAtMs: number;
  lastUpdatedMs: number;
  spentNullifiers: string[];
  commitmentHistory: string[];
  status: 'ACTIVE' | 'CLOSED' | 'LIQUIDATED';
}

export type PerpsEventType =
  | 'PositionOpened'
  | 'PositionUpdated'
  | 'PositionFunded'
  | 'PositionClosed'
  | 'PositionLiquidated';

export interface RawPerpsEvent {
  type: PerpsEventType;
  marketId: string;
  commitment: string;
  oldCommitment?: string;
  newCommitment?: string;
  nullifier?: string;
  oldNullifier?: string;
  finalNullifier?: string;
  amountCents?: bigint;
  fundingAmountCents?: bigint;
  isLongPays?: boolean;
  keeper?: string;
  blockNumber?: number;
  transactionHash?: string;
}

export class PositionIndexerService {
  private activeCommitments: Map<string, IndexedPosition> = new Map();
  private spentNullifiers: Set<string> = new Set();
  private commitmentToHead: Map<string, string> = new Map(); // maps past commitments to active head
  private lastIndexedBlock: number = 0;

  /**
   * Ingest a single parsed on-chain Starknet event into the index
   */
  ingestEvent(event: RawPerpsEvent): void {
    const now = Date.now();

    switch (event.type) {
      case 'PositionOpened': {
        const commitment = event.commitment;
        if (!commitment) return;

        const nullifier = event.nullifier || '0x0';
        if (nullifier !== '0x0') {
          this.spentNullifiers.add(nullifier.toLowerCase());
        }

        const position: IndexedPosition = {
          marketId: event.marketId || 'BTC-PERP',
          currentCommitment: commitment,
          initialCommitment: commitment,
          marginAmountCents: event.amountCents || 0n,
          lockedAtMs: now,
          lastUpdatedMs: now,
          spentNullifiers: [nullifier],
          commitmentHistory: [commitment],
          status: 'ACTIVE',
        };

        this.activeCommitments.set(commitment, position);
        this.commitmentToHead.set(commitment, commitment);
        break;
      }

      case 'PositionUpdated': {
        const oldCommitment = event.oldCommitment;
        const newCommitment = event.newCommitment;
        if (!oldCommitment || !newCommitment) return;

        const oldNullifier = event.oldNullifier || '0x0';
        if (oldNullifier !== '0x0') {
          this.spentNullifiers.add(oldNullifier.toLowerCase());
        }

        const existing = this.activeCommitments.get(oldCommitment);
        if (existing) {
          this.activeCommitments.delete(oldCommitment);

          const updatedPosition: IndexedPosition = {
            ...existing,
            currentCommitment: newCommitment,
            lastUpdatedMs: now,
            spentNullifiers: [...existing.spentNullifiers, oldNullifier],
            commitmentHistory: [...existing.commitmentHistory, newCommitment],
            status: 'ACTIVE',
          };

          this.activeCommitments.set(newCommitment, updatedPosition);

          // Update lookup mappings
          for (const c of updatedPosition.commitmentHistory) {
            this.commitmentToHead.set(c, newCommitment);
          }
        }
        break;
      }

      case 'PositionFunded': {
        const commitment = event.commitment;
        const newCommitment = event.newCommitment;
        if (!commitment || !newCommitment) return;

        const oldNullifier = event.oldNullifier || '0x0';
        if (oldNullifier !== '0x0') {
          this.spentNullifiers.add(oldNullifier.toLowerCase());
        }

        const existing = this.activeCommitments.get(commitment);
        if (existing) {
          this.activeCommitments.delete(commitment);

          const fundedPosition: IndexedPosition = {
            ...existing,
            currentCommitment: newCommitment,
            lastUpdatedMs: now,
            spentNullifiers: [...existing.spentNullifiers, oldNullifier],
            commitmentHistory: [...existing.commitmentHistory, newCommitment],
            status: 'ACTIVE',
          };

          this.activeCommitments.set(newCommitment, fundedPosition);

          for (const c of fundedPosition.commitmentHistory) {
            this.commitmentToHead.set(c, newCommitment);
          }
        }
        break;
      }

      case 'PositionClosed': {
        const commitment = event.commitment;
        if (!commitment) return;

        const finalNullifier = event.finalNullifier || '0x0';
        if (finalNullifier !== '0x0') {
          this.spentNullifiers.add(finalNullifier.toLowerCase());
        }

        const existing = this.activeCommitments.get(commitment);
        if (existing) {
          existing.status = 'CLOSED';
          existing.lastUpdatedMs = now;
          this.activeCommitments.delete(commitment);
        }
        break;
      }

      case 'PositionLiquidated': {
        const commitment = event.commitment;
        if (!commitment) return;

        const nullifier = event.nullifier || '0x0';
        if (nullifier !== '0x0') {
          this.spentNullifiers.add(nullifier.toLowerCase());
        }

        const existing = this.activeCommitments.get(commitment);
        if (existing) {
          existing.status = 'LIQUIDATED';
          existing.lastUpdatedMs = now;
          this.activeCommitments.delete(commitment);
        }
        break;
      }
    }
  }

  /**
   * Get all currently active on-chain positions
   */
  getActivePositions(): IndexedPosition[] {
    return Array.from(this.activeCommitments.values()).filter((p) => p.status === 'ACTIVE');
  }

  /**
   * Get list of active commitment strings for keeper discovery
   */
  getActiveCommitments(): string[] {
    return Array.from(this.activeCommitments.keys());
  }

  /**
   * Check if a nullifier is spent according to the index
   */
  isSpentNullifier(nullifier: string): boolean {
    return this.spentNullifiers.has(nullifier.toLowerCase());
  }

  /**
   * Reconstruct the full commitment lineage graph for a given commitment
   */
  getCommitmentLineage(commitment: string): string[] {
    const head = this.commitmentToHead.get(commitment);
    if (!head) return [commitment];
    const pos = this.activeCommitments.get(head);
    return pos ? pos.commitmentHistory : [commitment];
  }

  /**
   * Clear the index (for testing)
   */
  clear(): void {
    this.activeCommitments.clear();
    this.spentNullifiers.clear();
    this.commitmentToHead.clear();
    this.lastIndexedBlock = 0;
  }
}

export const positionIndexerService = new PositionIndexerService();
