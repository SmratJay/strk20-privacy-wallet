/**
 * @file pelProtocol.test.ts
 * @description Comprehensive unit and cryptographic verification tests for PEL Private Perpetuals
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';

describe('PEL Private Perpetuals Protocol Test Suite', () => {
  const dummyWallet = '0x020cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
  const dummyNonce = '0x123456789abcdef0123456789abcdef0';

  it('1. Computes deterministic Poseidon commitment for position state', () => {
    const commitment = zkProverService.computePositionCommitment(
      dummyWallet,
      'BTC-PERP',
      1000, // notional $1000
      95000, // entry $95,000
      100, // margin $100
      dummyNonce
    );

    expect(commitment).toBeDefined();
    expect(commitment.startsWith('0x')).toBe(true);
    expect(commitment.length).toBeGreaterThan(10);

    // Identical inputs produce identical commitment
    const commitmentRepeat = zkProverService.computePositionCommitment(
      dummyWallet,
      'BTC-PERP',
      1000,
      95000,
      100,
      dummyNonce
    );
    expect(commitment).toBe(commitmentRepeat);
  });

  it('2. Computes deterministic nullifiers for replay prevention', () => {
    const commitment = zkProverService.computePositionCommitment(
      dummyWallet,
      'BTC-PERP',
      1000,
      95000,
      100,
      dummyNonce
    );

    const nullifier = zkProverService.computePositionNullifier(commitment, dummyNonce);
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
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    const proof = zkProverService.generateTransitionProof(
      'OPEN',
      witness,
      'BTC-PERP',
      95000,
      100,
      50,
      0.02
    );

    expect(proof.starkVerifierStatus).toBe('POSEIDON_SNIP36_FACT_VALID');
    expect(proof.circuitResults.openingValid).toBe(true);
    expect(proof.circuitResults.solvencyValid).toBe(true);
    expect(proof.factHash.startsWith('0x')).toBe(true);
    expect(proof.publicInputsHash.startsWith('0x')).toBe(true);

    // Verify mathematical equality with Cairo Poseidon structure
    const proofTypeFelt = '0x' + Buffer.from('OPEN').toString('hex');
    const marketFelt = '0x' + Buffer.from('BTC-PERP').toString('hex');
    const amountFelt = '0x' + Math.floor(100 * 100).toString(16);
    const priceFelt = '0x' + Math.floor(95000 * 100).toString(16);

    const manualInputsHash = hash.computePoseidonHashOnElements([
      proofTypeFelt,
      marketFelt,
      proof.circuitResults.commitment,
      proof.circuitResults.nullifier,
      amountFelt,
      priceFelt,
    ]);

    expect(proof.publicInputsHash).toBe(manualInputsHash);

    const STWO_TAG = '0x' + Buffer.from('STWO_SNIP36_PROOF_V2').toString('hex');
    const manualFactHash = hash.computePoseidonHashOnElements([
      manualInputsHash,
      STWO_TAG,
    ]);

    expect(proof.factHash).toBe(manualFactHash);
  });

  it('4. Evaluates linear signed PnL circuit correctly for LONG and SHORT', () => {
    // 1 BTC Long entered at $90,000, Mark price at $95,000 -> +$5,000 PnL
    const longPnl = zkProverService.evaluatePnLCircuit('LONG', 1.0, 90000, 95000);
    expect(longPnl).toBe(5000);

    // 1 BTC Short entered at $90,000, Mark price at $95,000 -> -$5,000 PnL
    const shortPnl = zkProverService.evaluatePnLCircuit('SHORT', 1.0, 90000, 95000);
    expect(shortPnl).toBe(-5000);
  });

  it('5. Evaluates solvency circuit and identifies liquidation thresholds', () => {
    // Position: $100 Margin, 10x leverage ($1000 notional, 0.01 BTC at $100k)
    // 2% maintenance margin = $20
    // Price drops to $91,000: PnL = -$90 -> Equity = $10. ($10 < $18.2 maintenance) -> LIQUIDATION ELIGIBLE
    const solvency = zkProverService.evaluateSolvencyCircuit(
      100, // margin
      -90, // pnl
      0,   // funding
      0,   // fees
      0.01,// size tokens
      91000,// current price
      0.02 // 2% maintenance
    );

    expect(solvency.isSolvent).toBe(false);
    expect(solvency.equityUsd).toBe(10);
    expect(solvency.maintenanceMarginUsd).toBe(18.2);
  });

  it('6. Builds valid single-call calldata for PELPerpsCore on Starknet Sepolia', () => {
    const openCall = starknetPerpsDispatcher.buildOpenPositionCall(
      'BTC-PERP',
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      150.75, // $150.75
      '0x3333333333333333333333333333333333333333333333333333333333333333'
    );

    expect(openCall.contractAddress).toBe(PERPS_DEPLOYMENTS.sepolia.pelCoreAddress);
    expect(openCall.entrypoint).toBe('open_position');
    const calldata = openCall.calldata as string[];
    expect(calldata.length).toBe(5);
    expect(calldata[0]).toBe('0x4254432d50455250'); // 'BTC-PERP' felt
    expect(calldata[3]).toBe('0x3ae3'); // 15075 cents in hex
  });
});
