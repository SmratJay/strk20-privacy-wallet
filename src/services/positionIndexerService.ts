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

import { RpcProvider, hash } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';

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
  private isPolling: boolean = false;
  private pollIntervalId: NodeJS.Timeout | null = null;

  // Cached event selectors
  private selectors = {
    PositionOpened: hash.getSelectorFromName('PositionOpened'),
    PositionUpdated: hash.getSelectorFromName('PositionUpdated'),
    PositionFunded: hash.getSelectorFromName('PositionFunded'),
    PositionClosed: hash.getSelectorFromName('PositionClosed'),
    PositionLiquidated: hash.getSelectorFromName('PositionLiquidated'),
  };

  /**
   * Decode raw Starknet event keys and data into a typed RawPerpsEvent
   */
  decodeStarknetEvent(eventObj: { keys: string[]; data: string[]; block_number?: number; transaction_hash?: string }): RawPerpsEvent | null {
    if (!eventObj.keys || eventObj.keys.length === 0) return null;
    const selector = eventObj.keys[0];
    const data = eventObj.data || [];

    if (selector === this.selectors.PositionOpened) {
      // Data: [collateral_owner, commitment, market_id, margin_amount, timestamp]
      return {
        type: 'PositionOpened',
        marketId: this.feltToString(data[2] || '0x0'),
        commitment: data[1] || '0x0',
        amountCents: data[3] ? BigInt(data[3]) : 0n,
        blockNumber: eventObj.block_number,
        transactionHash: eventObj.transaction_hash,
      };
    }

    if (selector === this.selectors.PositionUpdated) {
      // Data: [old_commitment, old_nullifier, new_commitment, timestamp]
      return {
        type: 'PositionUpdated',
        marketId: 'BTC-PERP',
        commitment: data[2] || '0x0',
        oldCommitment: data[0] || '0x0',
        oldNullifier: data[1] || '0x0',
        newCommitment: data[2] || '0x0',
        blockNumber: eventObj.block_number,
        transactionHash: eventObj.transaction_hash,
      };
    }

    if (selector === this.selectors.PositionFunded) {
      // Data: [commitment, old_nullifier, new_commitment, funding_amount, is_long_pays, timestamp]
      return {
        type: 'PositionFunded',
        marketId: 'BTC-PERP',
        commitment: data[0] || '0x0',
        oldNullifier: data[1] || '0x0',
        newCommitment: data[2] || '0x0',
        fundingAmountCents: data[3] ? BigInt(data[3]) : 0n,
        isLongPays: data[4] === '0x1' || data[4] === '1',
        blockNumber: eventObj.block_number,
        transactionHash: eventObj.transaction_hash,
      };
    }

    if (selector === this.selectors.PositionClosed) {
      // Data: [commitment, nullifier, payout_amount, timestamp]
      return {
        type: 'PositionClosed',
        marketId: 'BTC-PERP',
        commitment: data[0] || '0x0',
        finalNullifier: data[1] || '0x0',
        amountCents: data[2] ? BigInt(data[2]) : 0n,
        blockNumber: eventObj.block_number,
        transactionHash: eventObj.transaction_hash,
      };
    }

    if (selector === this.selectors.PositionLiquidated) {
      // Data: [commitment, nullifier, keeper, timestamp]
      return {
        type: 'PositionLiquidated',
        marketId: 'BTC-PERP',
        commitment: data[0] || '0x0',
        nullifier: data[1] || '0x0',
        keeper: data[2],
        blockNumber: eventObj.block_number,
        transactionHash: eventObj.transaction_hash,
      };
    }

    return null;
  }

  private feltToString(feltHex: string): string {
    try {
      const hex = feltHex.startsWith('0x') ? feltHex.slice(2) : feltHex;
      return Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '') || 'BTC-PERP';
    } catch {
      return 'BTC-PERP';
    }
  }

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
   * Poll Starknet RPC for PELPerpsCore contract events and decode them
   */
  async pollEventsFromRpc(
    rpcUrl: string = process.env.NEXT_PUBLIC_STARKNET_RPC_URL || 'https://api.cartridge.gg/x/starknet/sepolia',
    network: 'sepolia' = 'sepolia'
  ): Promise<number> {
    try {
      const provider = new RpcProvider({ nodeUrl: rpcUrl });
      const config = PERPS_DEPLOYMENTS[network];
      const currentBlock = await provider.getBlockNumber();

      if (this.lastIndexedBlock === 0) {
        this.lastIndexedBlock = Math.max(0, currentBlock - 50); // initial 50-block lookback
      }

      if (this.lastIndexedBlock >= currentBlock) {
        return 0;
      }

      const eventResponse = await provider.getEvents({
        address: config.pelCoreAddress,
        from_block: { block_number: this.lastIndexedBlock + 1 },
        to_block: { block_number: currentBlock },
        chunk_size: 50,
      });

      let ingestedCount = 0;
      for (const rawEvent of eventResponse.events) {
        const parsed = this.decodeStarknetEvent(rawEvent as any);
        if (parsed) {
          this.ingestEvent(parsed);
          ingestedCount++;
        }
      }

      this.lastIndexedBlock = currentBlock;
      return ingestedCount;
    } catch {
      return 0;
    }
  }

  /**
   * Start polling loop for new chain events
   */
  startPolling(
    intervalMs: number = 10000,
    rpcUrl?: string,
    network: 'sepolia' = 'sepolia'
  ): void {
    if (this.isPolling) return;
    this.isPolling = true;

    this.pollIntervalId = setInterval(async () => {
      await this.pollEventsFromRpc(rpcUrl, network);
    }, intervalMs);
  }

  /**
   * Stop polling loop
   */
  stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.isPolling = false;
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

  getLastIndexedBlock(): number {
    return this.lastIndexedBlock;
  }

  setLastIndexedBlock(block: number): void {
    this.lastIndexedBlock = block;
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
