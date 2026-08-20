/**
 * @file pelProtocol.test.ts
 * @description Comprehensive unit and cryptographic verification tests for PEL Private Perpetuals
 * Updated for V2: canonical BigInt types, correct API signatures.
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';
import {
  calcPnlCents, calcEquityCents, calcMaintMarginCents, isLiquidatable,
  usdToCents, tokensToSats,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';

describe('PEL Private Perpetuals Protocol Test Suite', () => {
  const OWNER_SECRET = '0x020cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
  const NONCE        = '0x123456789abcdef0123456789abcdef0';
  const MARKET_ID    = 'BTC-PERP';
  const MAINT_BPS    = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps);

  it('1. Computes deterministic Poseidon commitment for position state', () => {
    const qty    = tokensToSats(0.01053); // ~$1000 notional at $95k
    const price  = usdToCents(95_000);
    const margin = usdToCents(100);

    const commitment = zkProverService.computePositionCommitment(
      OWNER_SECRET, MARKET_ID, 'LONG', qty, price, margin, 0n, NONCE,
    );

    expect(commitment).toBeDefined();
    expect(commitment.startsWith('0x')).toBe(true);
    expect(commitment.length).toBeGreaterThan(10);

    // Identical inputs produce identical commitment
    const commitmentRepeat = zkProverService.computePositionCommitment(
      OWNER_SECRET, MARKET_ID, 'LONG', qty, price, margin, 0n, NONCE,
    );
    expect(commitment).toBe(commitmentRepeat);
  });

  it('2. Computes deterministic nullifiers for replay prevention', () => {
    const qty    = tokensToSats(0.01053);
    const price  = usdToCents(95_000);
    const margin = usdToCents(100);

    const commitment = zkProverService.computePositionCommitment(
      OWNER_SECRET, MARKET_ID, 'LONG', qty, price, margin, 0n, NONCE,
    );

    const nullifier = zkProverService.computeNullifier(OWNER_SECRET, commitment);
    expect(nullifier).toBeDefined();
    expect(nullifier.startsWith('0x')).toBe(true);
    expect(nullifier).not.toBe(commitment);
  });

  it('3. Generates complete STARK SNIP-36 proof fact hash matching Cairo StwoVerifier', () => {
    const witness: PositionWitness = {
      side: 'LONG',
      sizeTokens: 0.010526,
      entryPrice: 95000,
      marginUsd: 100,
      fundingAccumulator: 0,
      nonce: NONCE,
      ownerAddress: OWNER_SECRET,
    };

    const proof = zkProverService.generateTransitionProof(
      'OPEN', witness, MARKET_ID, 95000, 100, 50, 0.02,
    );

    expect(proof.starkVerifierStatus).toBe('POSEIDON_SNIP36_FACT_VALID');
    expect(proof.factHash.startsWith('0x')).toBe(true);
    expect(proof.publicInputsHash.startsWith('0x')).toBe(true);
    expect(proof.commitment.startsWith('0x')).toBe(true);
    expect(proof.nullifier.startsWith('0x')).toBe(true);

    // Verify mathematical equality with Cairo Poseidon structure
    const proofTypeFelt = '0x' + Buffer.from('OPEN').toString('hex');
    const marketFelt    = '0x' + Buffer.from('BTC-PERP').toString('hex');
    const amountFelt    = '0x' + (100n * 100n).toString(16); // $100 in cents
    const priceFelt     = '0x' + (95_000n * 100n).toString(16); // $95,000 in cents

    const manualInputsHash = hash.computePoseidonHashOnElements([
      proofTypeFelt, marketFelt, proof.commitment, proof.nullifier, amountFelt, priceFelt,
    ]);
    expect(proof.publicInputsHash).toBe(manualInputsHash);

    const STWO_TAG = '0x5354574f5f534e495033365f50524f4f465f5632';
    const manualFactHash = hash.computePoseidonHashOnElements([manualInputsHash, STWO_TAG]);
    expect(proof.factHash).toBe(manualFactHash);
  });

  it('4. Evaluates linear signed PnL circuit correctly for LONG and SHORT', () => {
    // 1 BTC Long entered at $90,000, Mark price at $95,000 → +$5,000 PnL
    const longPnl = zkProverService.evaluatePnLCircuit('LONG', 1.0, 90000, 95000);
    expect(longPnl).toBeCloseTo(5000, 1);

    // 1 BTC Short entered at $90,000, Mark price at $95,000 → -$5,000 PnL
    const shortPnl = zkProverService.evaluatePnLCircuit('SHORT', 1.0, 90000, 95000);
    expect(shortPnl).toBeCloseTo(-5000, 1);
  });

  it('5. Evaluates solvency circuit and identifies liquidation thresholds', () => {
    // Position: $100 Margin, 10x leverage ($1000 notional, 0.01 BTC at $100k)
    // 2% maintenance margin = $20
    // Price drops to $91,000: PnL = -$90 → Equity = $10. ($10 < $18.2 maintenance) → LIQUIDATABLE
    const qty     = tokensToSats(0.01);
    const entry   = usdToCents(100_000);
    const mark    = usdToCents(91_000);
    const margin  = usdToCents(100);
    const pnl     = calcPnlCents('LONG', qty, entry, mark);
    const equity  = calcEquityCents(margin, pnl, 0n, 0n);
    const maint   = calcMaintMarginCents(qty, mark, MAINT_BPS);

    expect(Number(equity) / 100).toBeCloseTo(10, 0);    // $10
    expect(Number(maint) / 100).toBeCloseTo(18.2, 1);   // $18.2
    expect(isLiquidatable(margin, pnl, 0n, 0n, qty, mark, MAINT_BPS)).toBe(true);
  });

  it('6. Builds valid single-call calldata for PELPerpsCore on Starknet Sepolia', () => {
    const openCall = starknetPerpsDispatcher.buildOpenPositionCall(
      '0x_user_alice',
      'BTC-PERP',
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      150.75, // $150.75
      '0x3333333333333333333333333333333333333333333333333333333333333333',
    );

    expect(openCall.contractAddress).toBe(PERPS_DEPLOYMENTS.sepolia.pelCoreAddress);
    expect(openCall.entrypoint).toBe('open_position');
    const calldata = openCall.calldata as string[];
    expect(calldata.length).toBe(6);
    expect(calldata[0]).toBe('0x_user_alice');
    expect(calldata[1]).toBe('0x4254432d50455250'); // 'BTC-PERP' felt
  });
});
