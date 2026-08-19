/**
 * @file protocolInvariants.test.ts
 * @description Protocol-Grade Invariant and Security Boundary Tests for PEL Private Perpetuals
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';

describe('PEL Perpetuals Protocol-Grade Invariants & Security Suite', () => {
  const dummyWallet = '0x020cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
  const dummyNonce = '0x123456789abcdef0123456789abcdef0';

  it('Invariant 1 [Replay Protection]: Different nonces produce unique, collision-resistant nullifiers', () => {
    const commitment = zkProverService.computePositionCommitment(
      dummyWallet,
      'BTC-PERP',
      1000,
      95000,
      100,
      dummyNonce
    );

    const nullifier1 = zkProverService.computePositionNullifier(commitment, dummyNonce);
    const nullifier2 = zkProverService.computePositionNullifier(commitment, '0xdeadbeef1234');

    expect(nullifier1).not.toBe(nullifier2);
    expect(nullifier1.startsWith('0x')).toBe(true);
    expect(nullifier2.startsWith('0x')).toBe(true);
  });

  it('Invariant 2 [Leverage Bounds]: Opening circuit rejects leverage > L_max (50x)', () => {
    const invalidWitness: PositionWitness = {
      side: 'LONG',
      sizeTokens: 1.0, // 1 BTC at $95k = $95,000 notional
      entryPrice: 95000,
      marginUsd: 100, // $100 margin -> 950x leverage (exceeds 50x)
      fundingAccumulator: 0,
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    const { isValid } = zkProverService.evaluateOpeningCircuit(invalidWitness, 'BTC-PERP', 50);
    expect(isValid).toBe(false);
  });

  it('Invariant 3 [Solvency Inequality]: Position is liquidatable IF AND ONLY IF Et <= Mmaint', () => {
    // Position: 0.1 BTC ($9,500 notional), Entry $95,000, Margin $500 (19x leverage)
    // Maintenance margin (2%) = $190
    // Case A: Price drops to $92,000 -> PnL = -$300 -> Equity = $200 (> $184 M_maint) -> SOLVENT
    const caseA = zkProverService.evaluateSolvencyCircuit(500, -300, 0, 0, 0.1, 92000, 0.02);
    expect(caseA.isSolvent).toBe(true);

    // Case B: Price drops to $90,000 -> PnL = -$500 -> Equity = $0 (<= $180 M_maint) -> LIQUIDATION ELIGIBLE
    const caseB = zkProverService.evaluateSolvencyCircuit(500, -500, 0, 0, 0.1, 90000, 0.02);
    expect(caseB.isSolvent).toBe(false);
  });

  it('Invariant 4 [Deterministic Poseidon SNIP-36 Fact Binding]: Verifies algebraic fact construction', () => {
    const witness: PositionWitness = {
      side: 'LONG',
      sizeTokens: 0.05,
      entryPrice: 95000,
      marginUsd: 200,
      fundingAccumulator: 0,
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    const proof = zkProverService.generateTransitionProof(
      'OPEN',
      witness,
      'BTC-PERP',
      95000,
      200,
      50,
      0.02
    );

    expect(proof.starkVerifierStatus).toBe('POSEIDON_SNIP36_FACT_VALID');
    expect(proof.circuitResults.openingValid).toBe(true);

    // Reconstruct exact Poseidon public inputs
    const proofTypeFelt = '0x' + Buffer.from('OPEN').toString('hex');
    const marketFelt = '0x' + Buffer.from('BTC-PERP').toString('hex');
    const amountFelt = '0x' + Math.floor(200 * 100).toString(16);
    const priceFelt = '0x' + Math.floor(95000 * 100).toString(16);

    const manualInputs = hash.computePoseidonHashOnElements([
      proofTypeFelt,
      marketFelt,
      proof.circuitResults.commitment,
      proof.circuitResults.nullifier,
      amountFelt,
      priceFelt,
    ]);

    expect(proof.publicInputsHash).toBe(manualInputs);
  });

  it('Invariant 5 [Solvency Cap on Settlement]: Close position call builds valid calldata within solvency caps', () => {
    const commitment = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const finalNullifier = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const payoutCommitment = '0x9999999999999999999999999999999999999999999999999999999999999999';

    const closeCall = starknetPerpsDispatcher.buildClosePositionCall(
      'BTC-PERP',
      commitment,
      finalNullifier,
      payoutCommitment,
      275.50, // $275.50 payout
      '0xfacthash123'
    );

    expect(closeCall.contractAddress).toBe(PERPS_DEPLOYMENTS.sepolia.pelCoreAddress);
    expect(closeCall.entrypoint).toBe('close_position');
    const calldata = closeCall.calldata as string[];
    expect(calldata.length).toBe(6);
    expect(calldata[4]).toBe('0x6b9e'); // 27550 cents
  });

  it('Invariant 6 [Keeper Liquidation Call]: Encodes keeper recipient and liquidation fact correctly', () => {
    const keeperAddress = '0x0374e50eb9598ee09f7a7da0e3ebc7075c3db6f281e22be582d966d54cf8e51a';
    const commitment = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const nullifier = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const liqFact = '0x3333333333333333333333333333333333333333333333333333333333333333';

    const liqCall = starknetPerpsDispatcher.buildLiquidatePositionCall(
      'ETH-PERP',
      commitment,
      nullifier,
      liqFact,
      keeperAddress
    );

    expect(liqCall.entrypoint).toBe('liquidate_position');
    const calldata = liqCall.calldata as string[];
    expect(calldata[0]).toBe('0x4554482d50455250'); // 'ETH-PERP'
    expect(calldata[4]).toBe(keeperAddress);
  });
});
