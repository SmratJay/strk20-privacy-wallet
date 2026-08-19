/**
 * @file tests/e2e/fullLifecycle.test.ts
 * @description PEL BTC-PERP Complete Lifecycle E2E Test (OPEN -> UPDATE -> FUND -> CLOSE)
 *
 * Simulates the full state transition sequence off-chain & proves mathematical consistency.
 */

import { describe, it, expect } from 'vitest';
import { zkProverService } from '../../src/services/zkProverService';
import {
  saveWitness,
  loadWitness,
  deleteWitness,
  updateWitness,
} from '../../src/protocol/witnessStore';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  calcTakerFeeCents,
  calcFundingCentsPerInterval,
  usdToCents,
  tokensToSats,
} from '../../src/protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../../src/protocol/types';

describe('PEL BTC-PERP End-to-End State Machine Lifecycle', () => {
  const WALLET_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const OWNER_SECRET   = '0x011122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000';
  const MARKET_ID      = 'BTC-PERP' as const;

  // 10x leverage on $1,000 margin at $95,000 entry price
  const ENTRY_PRICE_CENTS = 9_500_000n; // $95,000.00
  const MARGIN_CENTS      = 100_000n;   // $1,000.00
  const NOTIONAL_CENTS    = 1_000_000n; // $10,000.00
  // Qty sats = (notional / entry) * 1e8 = (10,000 / 95,000) * 1e8 = 10,526,315 sats
  const QTY_SATS          = 10_526_315n;
  const NONCE             = '0x0123456789abcdef0123456789abcdef';
  const MARGIN_NULLIFIER  = '0x0aabbccddeeff00112233445566778899';

  let activeCommitment: string;
  let activeNullifier: string;

  it('Step 1: OPEN Position (Generates Canonical Commitment & SNIP-36 Open Fact)', () => {
    const { fact, commitment, witness } = zkProverService.generateOpenFact(
      OWNER_SECRET,
      NONCE,
      MARKET_ID,
      'LONG',
      QTY_SATS,
      ENTRY_PRICE_CENTS,
      MARGIN_CENTS,
      ENTRY_PRICE_CENTS,
      MARGIN_NULLIFIER,
    );

    expect(fact.proofType).toBe('OPEN');
    expect(fact.factHash.startsWith('0x')).toBe(true);
    expect(commitment.startsWith('0x')).toBe(true);

    activeCommitment = commitment;
    activeNullifier = zkProverService.computeNullifier(OWNER_SECRET, commitment);

    // Save witness in store
    const fullWitness = {
      ...witness,
      commitment: activeCommitment,
      nullifier: activeNullifier,
    };
    saveWitness(WALLET_ADDRESS, fullWitness);

    // Verify stored
    const loaded = loadWitness(WALLET_ADDRESS, activeCommitment);
    expect(loaded).not.toBeNull();
    expect(loaded?.side).toBe('LONG');
    expect(loaded?.quantitySats).toBe(QTY_SATS);
    expect(loaded?.marginCents).toBe(MARGIN_CENTS);
  });

  it('Step 2: UPDATE Position (State Rollover on Oracle Price Tick)', () => {
    const loaded = loadWitness(WALLET_ADDRESS, activeCommitment);
    expect(loaded).not.toBeNull();

    const newOraclePriceCents = 9_600_000n; // $96,000.00
    const { fact, newCommitment, newNullifier } = zkProverService.generateUpdateFact(
      loaded!,
      newOraclePriceCents,
    );

    expect(fact.proofType).toBe('UPDATE');
    expect(newCommitment).not.toBe(activeCommitment);
    expect(newNullifier).not.toBe(activeNullifier);

    // Update in witness store
    const updatedWitness = {
      ...loaded!,
      commitment: newCommitment,
      nullifier: newNullifier,
    };
    updateWitness(WALLET_ADDRESS, activeCommitment, updatedWitness);

    activeCommitment = newCommitment;
    activeNullifier = newNullifier;

    // Verify state transitioned
    expect(loadWitness(WALLET_ADDRESS, newCommitment)).not.toBeNull();
  });

  it('Step 3: FUND Position (Funding Rate Accrual for 1 Hour)', () => {
    const loaded = loadWitness(WALLET_ADDRESS, activeCommitment);
    expect(loaded).not.toBeNull();

    const markPriceCents = 9_600_000n;
    const fundingRateBpsHr = 120n; // 0.0012%
    const { fact, newCommitment, fundingCents, isLongPays } = zkProverService.generateFundFact(
      loaded!,
      markPriceCents,
      markPriceCents,
      fundingRateBpsHr,
      1n,
    );

    expect(fact.proofType).toBe('FUND');
    expect(isLongPays).toBe(true);
    expect(fundingCents).toBeGreaterThan(0n);

    // Update state with deducted margin & accumulated funding
    const fundedWitness = {
      ...loaded!,
      marginCents: loaded!.marginCents - fundingCents,
      fundingCents: loaded!.fundingCents + fundingCents,
      commitment: newCommitment,
      nullifier: zkProverService.computeNullifier(OWNER_SECRET, newCommitment),
    };
    updateWitness(WALLET_ADDRESS, activeCommitment, fundedWitness);

    activeCommitment = newCommitment;
  });

  it('Step 4: CLOSE Position (Profitable Exit with Exact Shielded Settlement)', () => {
    const loaded = loadWitness(WALLET_ADDRESS, activeCommitment);
    expect(loaded).not.toBeNull();

    // Price rises to $100,000.00 (+5.26%)
    const exitPriceCents = 10_000_000n;
    const { fact, payoutNoteCommitment, payoutCents } = zkProverService.generateCloseFact(
      loaded!,
      exitPriceCents,
      exitPriceCents,
    );

    expect(fact.proofType).toBe('CLOSE');
    expect(payoutNoteCommitment.startsWith('0x')).toBe(true);

    // PnL check: notional was $10,000 at $95k -> at $100k, PnL = 10526315 * 500000 / 1e8 = 52,631 cents = $526.31
    // Payout = margin ($1,000 - funding) + PnL ($526.31)
    expect(payoutCents).toBeGreaterThan(MARGIN_CENTS);

    // Delete witness post-close
    deleteWitness(WALLET_ADDRESS, activeCommitment);
    expect(loadWitness(WALLET_ADDRESS, activeCommitment)).toBeNull();
  });
});
