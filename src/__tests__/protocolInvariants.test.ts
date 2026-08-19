/**
 * @file protocolInvariants.test.ts
 * @description Protocol-Grade Invariant and Security Boundary Tests for PEL Private Perpetuals
 * Comprehensive verification covering all 16 acceptance criteria in the Red-Team Remediation Spec.
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';
import { validateRelayerCalls, checkRateLimit } from '../services/relayerSecurity';
import { vaultService } from '../services/vaultService';
import { perpsService } from '../services/perpsService';
import { normalizeNetworkId } from '../config/networks';

describe('PEL Perpetuals Protocol-Grade Invariants & Security Suite', () => {
  const dummyWallet = '0x020cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
  const dummyNonce = '0x123456789abcdef0123456789abcdef0';
  const usdcAddress = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
  const strkAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

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

  it('Invariant 5 [Solvency Cap on Settlement]: Close position call builds valid calldata within proven equity', () => {
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

  it('Invariant 7 [Relayer Security & Calldata Schemas]: Rejects unauthorized calls, malformed calldata and wrong parameter counts', () => {
    // A. Unauthorized contract
    const badContract = [
      {
        contractAddress: '0x01234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        entrypoint: 'transfer',
        calldata: ['0x1', '0x2'],
      },
    ];
    expect(validateRelayerCalls(badContract).isValid).toBe(false);

    // B. Unauthorized selector
    const badSelector = [
      {
        contractAddress: PERPS_DEPLOYMENTS.sepolia.pelCoreAddress,
        entrypoint: 'set_admin',
        calldata: ['0x123'],
      },
    ];
    expect(validateRelayerCalls(badSelector).isValid).toBe(false);

    // C. Schema mismatch (open_position requires 5 parameters, passing 2)
    const badSchema = [
      {
        contractAddress: PERPS_DEPLOYMENTS.sepolia.pelCoreAddress,
        entrypoint: 'open_position',
        calldata: ['0x1', '0x2'],
      },
    ];
    const schemaRes = validateRelayerCalls(badSchema);
    expect(schemaRes.isValid).toBe(false);
    expect(schemaRes.error).toMatch(/SCHEMA_MISMATCH/);
  });

  it('Invariant 8 [Shielded Vault Balance Enforcement]: Rejects spending when unspent balance is insufficient', () => {
    vaultService.clearVault(dummyWallet, 'SN_SEPOLIA');

    expect(() => {
      vaultService.spendNotesForMargin(dummyWallet, 'SN_SEPOLIA', 1000n, '0xmarginnullifier');
    }).toThrow(/INSUFFICIENT_SHIELDED_BALANCE/);
  });

  it('Invariant 9 [Note Domain Separation]: Preserves STRK20 UTXO nullifier domain when margin is locked', () => {
    vaultService.clearVault(dummyWallet, 'SN_SEPOLIA');
    const note = vaultService.addNote(
      dummyWallet,
      'SN_SEPOLIA',
      usdcAddress,
      'USDC',
      500n,
      '0xtxhash123'
    );

    const originalNullifier = note.nullifier;
    const marginNullifier = '0xpel_margin_nullifier_999';

    const updated = vaultService.spendNotesForMargin(dummyWallet, 'SN_SEPOLIA', 500n, marginNullifier, usdcAddress);
    const spentNote = updated.find((n) => n.noteId === note.noteId);

    expect(spentNote).toBeDefined();
    expect(spentNote!.isSpent).toBe(true);
    expect(spentNote!.nullifier).toBe(originalNullifier);
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
      marginUsd: 1000,
      fundingAccumulator: 0,
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    expect(() => {
      zkProverService.generateTransitionProof(
        'LIQUIDATE',
        solventWitness,
        'BTC-PERP',
        95000,
        1000,
        50,
        0.02
      );
    }).toThrow(/CANNOT_GENERATE_LIQUIDATION_PROOF: Position is solvent/);
  });

  it('Invariant 12 [Network ID Normalization]: SN_SEPOLIA and sepolia resolve to identical storage key', () => {
    const keyA = vaultService.getStorageKey(dummyWallet, 'SN_SEPOLIA');
    const keyB = vaultService.getStorageKey(dummyWallet, 'sepolia');
    const keyC = vaultService.getStorageKey(dummyWallet, 'starknet-sepolia');

    expect(keyA).toBe(keyB);
    expect(keyB).toBe(keyC);
    expect(normalizeNetworkId('sepolia')).toBe('SN_SEPOLIA');
    expect(normalizeNetworkId('SN_SEPOLIA')).toBe('SN_SEPOLIA');
    expect(normalizeNetworkId('mainnet')).toBe('SN_MAIN');
  });

  it('Invariant 13 [Token-Specific Shielded Margin]: Spending USDC margin does not consume STRK notes', () => {
    vaultService.clearVault(dummyWallet, 'SN_SEPOLIA');

    // Add STRK note only
    vaultService.addNote(
      dummyWallet,
      'SN_SEPOLIA',
      strkAddress,
      'STRK',
      1000n,
      '0xtx_strk'
    );

    // Attempting to spend USDC margin must fail since no USDC note exists
    expect(() => {
      vaultService.spendNotesForMargin(dummyWallet, 'SN_SEPOLIA', 100n, '0xnullifier_usdc', usdcAddress);
    }).toThrow(/INSUFFICIENT_SHIELDED_BALANCE/);

    // Now add USDC note and spend
    vaultService.addNote(
      dummyWallet,
      'SN_SEPOLIA',
      usdcAddress,
      'USDC',
      500n,
      '0xtx_usdc'
    );

    const updated = vaultService.spendNotesForMargin(dummyWallet, 'SN_SEPOLIA', 200n, '0xnullifier_usdc_ok', usdcAddress);
    const strkNote = updated.find((n) => n.tokenAddress.toLowerCase() === strkAddress.toLowerCase());
    expect(strkNote!.isSpent).toBe(false); // STRK note is unspent
  });

  it('Invariant 14 [Exact Settlement Payout Gating]: Prover rejects close proof if requested payout exceeds proven equity', () => {
    const witness: PositionWitness = {
      side: 'LONG',
      sizeTokens: 0.1, // 0.1 BTC
      entryPrice: 90000,
      marginUsd: 500,
      fundingAccumulator: 0,
      nonce: dummyNonce,
      ownerAddress: dummyWallet,
    };

    // Mark price drops to $85,000 -> PnL = -$500 -> Equity = $0
    // Attempting to claim $500 payout when equity is $0 must be rejected
    expect(() => {
      zkProverService.generateTransitionProof(
        'CLOSE',
        witness,
        'BTC-PERP',
        85000,
        500, // Invalid excessive payout
        50,
        0.02
      );
    }).toThrow(/CANNOT_GENERATE_CLOSE_PROOF/);
  });

  it('Invariant 15 [Relayer Rate Limiting]: Enforces sliding window rate limiter', () => {
    const testClient = 'test_rate_limited_client_' + Date.now();
    for (let i = 0; i < 20; i++) {
      const res = checkRateLimit(testClient);
      expect(res.allowed).toBe(true);
    }
    const exceeded = checkRateLimit(testClient);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.remaining).toBe(0);
  });

  it('Invariant 16 [Fixed-Point Arithmetic Precision]: Linear signed PnL calculates exact integer cents without drift', () => {
    // 0.12345678 BTC LONG from $95,000.00 to $96,500.25
    // Price diff = $1,500.25 = 150025 cents
    // PnL cents = (12345678 * 150025) / 1e8 = 18521.603... -> 18521 cents ($185.21)
    const pnlCents = zkProverService.evaluatePnLCircuitBigInt('LONG', 0.12345678, 95000, 96500.25);
    expect(pnlCents).toBe(18521n);
    expect(zkProverService.evaluatePnLCircuit('LONG', 0.12345678, 95000, 96500.25)).toBe(185.21);
  });
});
