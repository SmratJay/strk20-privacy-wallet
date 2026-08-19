import { describe, it, expect } from 'vitest';
import { zkProverService, PositionWitness } from '../src/services/zkProverService';
import { pragmaOracleService } from '../src/services/pragmaOracleService';
import { perpsService } from '../src/services/perpsService';

describe('PEL Private Perpetuals ZK Prover Subsystem (Whitepaper Section 11)', () => {
  const dummyOwner = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const dummyNonce = '0x123456789abcdef0123456789abcdef0';

  const longWitness: PositionWitness = {
    side: 'LONG',
    sizeTokens: 0.51855,        // ~0.518 BTC
    entryPrice: 96420.50,       // $96,420.50
    marginUsd: 5000,            // $5,000 USDC
    fundingAccumulator: 0,
    nonce: dummyNonce,
    ownerAddress: dummyOwner,
  };

  it('Circuit 1 & 2: evaluates ownership and opening invariants under leverage constraints', () => {
    const isOwnerValid = zkProverService.verifyOwnershipCircuit(dummyOwner);
    expect(isOwnerValid).toBe(true);

    const { isValid: isOpenValid, commitment } = zkProverService.evaluateOpeningCircuit(
      longWitness,
      'BTC-PERP',
      50 // Max 50x
    );

    expect(isOpenValid).toBe(true);
    expect(commitment.startsWith('0x')).toBe(true);
  });

  it('Circuit 3: evaluates exact signed linear PnL without witness exposure', () => {
    // 1. Long PnL when price moves from 96,420.50 -> 100,000 (+3,579.50 per BTC)
    const longPnl = zkProverService.evaluatePnLCircuit('LONG', 1.0, 96420.50, 100000);
    expect(longPnl).toBeCloseTo(3579.50, 2);

    // 2. Short PnL when price moves down from 96,420.50 -> 90,000 (+6,420.50 per BTC)
    const shortPnl = zkProverService.evaluatePnLCircuit('SHORT', 1.0, 96420.50, 90000);
    expect(shortPnl).toBeCloseTo(6420.50, 2);
  });

  it('Circuit 4: evaluates cumulative funding payment calculation', () => {
    const funding = zkProverService.evaluateFundingCircuit(1.0, 100000, 0.0012, 1);
    expect(funding).toBeCloseTo(120, 2); // 1 BTC * $100,000 * 0.12% = $120
  });

  it('Circuit 5: verifies solvency risk invariant (Et > Mmaint)', () => {
    // Margin: $5,000, PnL: +$1,000, Size: 0.5 BTC at $100,000, Maintenance: 2% ($1,000)
    // Equity = $6,000 > $1,000 (Solvent)
    const result = zkProverService.evaluateSolvencyCircuit(
      5000,
      1000,
      0,
      0,
      0.5,
      100000,
      0.02
    );

    expect(result.isSolvent).toBe(true);
    expect(result.equityUsd).toBe(6000);
    expect(result.maintenanceMarginUsd).toBe(1000);
  });

  it('Circuit 6: proves zero-knowledge liquidation condition (Et <= Mmaint) without witness leakage', () => {
    // Margin: $5,000, PnL: -$4,500, Size: 0.5 BTC at $100,000, Maintenance: 2% ($1,000)
    // Equity = $500 <= $1,000 (Liquidatable)
    const result = zkProverService.evaluateLiquidationCircuit(
      5000,
      -4500,
      0,
      0,
      0.5,
      100000,
      0.02
    );

    expect(result.isLiquidatable).toBe(true);
    expect(result.factHash.startsWith('0x')).toBe(true);
  });

  it('Full STARK Transition Proof Pipeline (SNIP-36)', () => {
    const proofResult = zkProverService.generateTransitionProof(
      'OPEN',
      longWitness,
      'BTC-PERP',
      96420.50,
      5000,
      50,
      0.02
    );

    expect(proofResult.starkVerifierStatus).toBe('POSEIDON_SNIP36_FACT_VALID');
    expect(proofResult.factHash.startsWith('0x')).toBe(true);
    expect(proofResult.publicInputsHash.startsWith('0x')).toBe(true);
    expect(proofResult.circuitResults.solvencyValid).toBe(true);
    expect(proofResult.circuitResults.nullifier.startsWith('0x')).toBe(true);
  });
});

describe('Pragma Oracle Live Service (Whitepaper Section 9)', () => {
  it('fetches live market feeds with freshness verification', async () => {
    const feed = await pragmaOracleService.getMarketPrice('BTC/USD', 'mainnet');
    expect(feed.priceUsd).toBeGreaterThan(0);
    expect(feed.isFresh).toBe(true);
    expect(feed.numSources).toBeGreaterThan(0);
  });
});
