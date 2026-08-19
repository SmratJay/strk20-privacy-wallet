/**
 * @file tests/indexerAndKeeper.test.ts
 * @description Event Indexer & Autonomous Keeper Tests (Phases 5 & 6)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { positionIndexerService, RawPerpsEvent } from '../src/services/positionIndexerService';
import { keeperService } from '../src/services/keeperService';
import { zkProverService } from '../src/services/zkProverService';

describe('PEL Event Indexer & Autonomous Keeper Subsystem', () => {
  beforeEach(() => {
    positionIndexerService.clear();
  });

  it('indexes PositionOpened event and records active commitment', () => {
    const openEvent: RawPerpsEvent = {
      type: 'PositionOpened',
      marketId: 'BTC-PERP',
      commitment: '0x0111111111111111111111111111111111111111111111111111111111111111',
      nullifier: '0x0222222222222222222222222222222222222222222222222222222222222222',
      amountCents: 100_000n, // $1000 margin
      blockNumber: 12345,
    };

    positionIndexerService.ingestEvent(openEvent);

    const active = positionIndexerService.getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].currentCommitment).toBe(openEvent.commitment);
    expect(active[0].marginAmountCents).toBe(100_000n);
    expect(positionIndexerService.isSpentNullifier(openEvent.nullifier!)).toBe(true);
  });

  it('reconstructs commitment transition graph (C0 -> C1 -> C2)', () => {
    const C0 = '0x0111111111111111111111111111111111111111111111111111111111111111';
    const C1 = '0x0222222222222222222222222222222222222222222222222222222222222222';
    const C2 = '0x0333333333333333333333333333333333333333333333333333333333333333';

    // 1. OPEN C0
    positionIndexerService.ingestEvent({
      type: 'PositionOpened',
      marketId: 'BTC-PERP',
      commitment: C0,
      nullifier: '0x0aaa',
      amountCents: 100_000n,
    });

    // 2. UPDATE C0 -> C1
    positionIndexerService.ingestEvent({
      type: 'PositionUpdated',
      marketId: 'BTC-PERP',
      oldCommitment: C0,
      oldNullifier: '0x0aaa',
      newCommitment: C1,
      commitment: C1,
    });

    // 3. FUND C1 -> C2
    positionIndexerService.ingestEvent({
      type: 'PositionFunded',
      marketId: 'BTC-PERP',
      commitment: C1,
      oldNullifier: '0x0bbb',
      newCommitment: C2,
      fundingAmountCents: 120n,
      isLongPays: true,
    });

    // Active commitment should only be C2
    const active = positionIndexerService.getActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].currentCommitment).toBe(C2);

    // Lineage graph should be C0 -> C1 -> C2
    const lineage = positionIndexerService.getCommitmentLineage(C0);
    expect(lineage).toEqual([C0, C1, C2]);
  });

  it('marks position closed and removes from active index on PositionClosed', () => {
    const C0 = '0x0111111111111111111111111111111111111111111111111111111111111111';
    positionIndexerService.ingestEvent({
      type: 'PositionOpened',
      marketId: 'BTC-PERP',
      commitment: C0,
      nullifier: '0x0aaa',
      amountCents: 50_000n,
    });

    expect(positionIndexerService.getActivePositions().length).toBe(1);

    positionIndexerService.ingestEvent({
      type: 'PositionClosed',
      marketId: 'BTC-PERP',
      commitment: C0,
      finalNullifier: '0x0final',
      amountCents: 60_000n,
    });

    expect(positionIndexerService.getActivePositions().length).toBe(0);
    expect(positionIndexerService.isSpentNullifier('0x0final')).toBe(true);
  });

  it('marks position liquidated on PositionLiquidated', () => {
    const C0 = '0x0111111111111111111111111111111111111111111111111111111111111111';
    positionIndexerService.ingestEvent({
      type: 'PositionOpened',
      marketId: 'BTC-PERP',
      commitment: C0,
      nullifier: '0x0aaa',
      amountCents: 50_000n,
    });

    positionIndexerService.ingestEvent({
      type: 'PositionLiquidated',
      marketId: 'BTC-PERP',
      commitment: C0,
      nullifier: '0x0liq',
      keeper: '0xkeeper',
    });

    expect(positionIndexerService.getActivePositions().length).toBe(0);
    expect(positionIndexerService.isSpentNullifier('0x0liq')).toBe(true);
  });
});
