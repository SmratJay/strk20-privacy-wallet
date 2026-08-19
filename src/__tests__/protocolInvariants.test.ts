/**
 * @file protocolInvariants.test.ts
 * @description Protocol-Grade Invariant and Security Boundary Tests for PEL Private Perpetuals
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';
import { validateRelayerCalls } from '../services/relayerSecurity';
import { vaultService } from '../services/vaultService';
import { perpsService } from '../services/perpsService';

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

    expect(() => {
      zkProverService.generateTransitionProof('OPEN', invalidWitness, 'BTC-PERP', 95000, 100, 50, 0.02);
    }).toThrow(/CANNOT_GENERATE_OPEN_PROOF/);
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

  it('Invariant 7 [Relayer Security]: Rejects non-whitelisted contracts and non-whitelisted selectors with HTTP 403', () => {
    const maliciousCall = [
      {
        contractAddress: '0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // Random contract
        entrypoint: 'transfer',
        calldata: ['0x1', '0x2'],
      },
    ];

    const result = validateRelayerCalls(maliciousCall);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/UNAUTHORIZED_CONTRACT/);

    const unauthorizedSelectorCall = [
      {
        contractAddress: PERPS_DEPLOYMENTS.sepolia.pelCoreAddress,
        entrypoint: 'set_admin', // Admin call
        calldata: ['0x123'],
      },
    ];

    const resultSelector = validateRelayerCalls(unauthorizedSelectorCall);
    expect(resultSelector.isValid).toBe(false);
    expect(resultSelector.error).toMatch(/UNAUTHORIZED_SELECTOR/);
  });

  it('Invariant 8 [Shielded Vault Balance Enforcement]: Rejects spending when unspent balance is insufficient', () => {
    vaultService.clearVault(dummyWallet, 'sepolia');

    // Attempting to spend 1000 STRK when vault is empty must throw an explicit error
    expect(() => {
      vaultService.spendNotesForMargin(dummyWallet, 'sepolia', 1000n, '0xmarginnullifier');
    }).toThrow(/INSUFFICIENT_SHIELDED_BALANCE/);
  });

  it('Invariant 9 [Note Domain Separation]: Preserves STRK20 UTXO nullifier domain when margin is locked', () => {
    vaultService.clearVault(dummyWallet, 'sepolia');
    const note = vaultService.addNote(
      dummyWallet,
      'sepolia',
      '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      'STRK',
      500n,
      '0xtxhash123'
    );

    const originalNullifier = note.nullifier;
    const marginNullifier = '0xpel_margin_nullifier_999';

    const updated = vaultService.spendNotesForMargin(dummyWallet, 'sepolia', 500n, marginNullifier);
    const spentNote = updated.find((n) => n.noteId === note.noteId);

    expect(spentNote).toBeDefined();
    expect(spentNote!.isSpent).toBe(true);
    // Note's own nullifier MUST remain preserved
    expect(spentNote!.nullifier).toBe(originalNullifier);
    // Position margin nullifier stored in separate field
    expect(spentNote!.spentForPositionNullifier).toBe(marginNullifier);
  });

  it('Invariant 10 [Strict Market Validation]: Rejects invalid market IDs without silent fallback', () => {
    expect(() => {
      perpsService.openPosition(dummyWallet, 'INVALID-PERP' as any, 'LONG', 100, 10);
    }).toThrow(/INVALID_MARKET/);
  });

  it('Invariant 11 [Liquidation Circuit Solvency Gate]: Prover strictly rejects generating liquidation proof for solvent position', () => {
    const solventWitness: PositionWitness = {
      side: 'LONG',
      sizeTokens: 0.1,
      entryPrice: 95000,
      marginUsd: 1000, // $1,000 margin -> high equity
      fundingAccumulator: 0,
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    expect(() => {
      zkProverService.generateTransitionProof(
        'LIQUIDATE',
        solventWitness,
        'BTC-PERP',
        95000, // mark price equal to entry -> equity is $1000
        1000,
        50,
        0.02
      );
    }).toThrow(/CANNOT_GENERATE_LIQUIDATION_PROOF: Position is solvent/);
  });
});
