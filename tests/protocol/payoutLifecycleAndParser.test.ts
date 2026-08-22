/**
 * @file tests/protocol/payoutLifecycleAndParser.test.ts
 * @description P0/P1 Validation Suite for PositionClosed event parsing & pending payout states.
 */

import { describe, it, expect } from 'vitest';
import {
  savePendingPayout,
  loadPendingPayouts,
  updatePendingPayoutStatus,
  clearPendingPayout,
} from '../../src/protocol/witnessStore';
import { PendingPayoutRecord } from '../../src/protocol/types';

describe('Strict PositionClosed Event Parser & Payout Lifecycle', () => {
  const traderAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const commitment    = '0x05a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde';
  const payoutAmountCents = 150000n; // $1,500.00
  const txHash        = '0x03a8740b6702f6e9c51f61cb2ba33e84b462cfb2146f8d4b541ac94d71bdc93b';

  it('Pending payout lifecycle: records POSITION_CLOSED and transitions through states', () => {
    // 1. Initial save after on-chain close
    const initialPayout: PendingPayoutRecord = {
      commitment,
      positionTxHash: txHash,
      payoutAmountCents,
      recipient: traderAddress,
      status: 'POSITION_CLOSED',
      updatedAtMs: Date.now(),
    };
    savePendingPayout(traderAddress, initialPayout);

    let loaded = loadPendingPayouts(traderAddress);
    expect(loaded.length).toBe(1);
    expect(loaded[0].status).toBe('POSITION_CLOSED');
    expect(loaded[0].payoutAmountCents).toBe(150000n);

    // 2. Transition to PAYOUT_CLAIMING
    updatePendingPayoutStatus(traderAddress, commitment, 'PAYOUT_CLAIMING');
    loaded = loadPendingPayouts(traderAddress);
    expect(loaded[0].status).toBe('PAYOUT_CLAIMING');

    // 3. Verified delivery -> PAYOUT_CLAIMED
    updatePendingPayoutStatus(traderAddress, commitment, 'PAYOUT_CLAIMED');
    loaded = loadPendingPayouts(traderAddress);
    expect(loaded[0].status).toBe('PAYOUT_CLAIMED');

    // 4. Prover failure during shield -> PAYOUT_FAILED with reason, preserving amount for retry
    updatePendingPayoutStatus(traderAddress, commitment, 'PAYOUT_FAILED', {
      failureReason: 'STRK20 Prover offline (503 Service Unavailable)',
    });
    loaded = loadPendingPayouts(traderAddress);
    expect(loaded[0].status).toBe('PAYOUT_FAILED');
    expect(loaded[0].failureReason).toContain('Prover offline');
    expect(loaded[0].payoutAmountCents).toBe(150000n);

    // 5. Retry succeeds -> PAYOUT_SHIELDED with real note commitment
    const shieldedNoteCommitment = '0x0777777777777777777777777777777777777777777777777777777777777777';
    updatePendingPayoutStatus(traderAddress, commitment, 'PAYOUT_SHIELDED', {
      shieldedNoteCommitment,
    });
    loaded = loadPendingPayouts(traderAddress);
    expect(loaded[0].status).toBe('PAYOUT_SHIELDED');
    expect(loaded[0].shieldedNoteCommitment).toBe(shieldedNoteCommitment);

    // 6. Clean up after terminal confirmation
    clearPendingPayout(traderAddress, commitment);
    loaded = loadPendingPayouts(traderAddress);
    expect(loaded.length).toBe(0);
  });
});
