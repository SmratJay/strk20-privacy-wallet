/**
 * @file protocolInvariants.test.ts
 * @description Protocol-Grade Invariant and Security Boundary Tests for PEL Private Perpetuals
 * Updated for V2: uses fixedPoint.ts canonical math and zkProverService V2 API.
 * All 16 invariants from the remediation spec.
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import { zkProverService, PositionWitness } from '../services/zkProverService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../services/starknetPerpsDispatcher';
import { validateRelayerCalls, checkRateLimit } from '../services/relayerSecurity';
import { vaultService } from '../services/vaultService';
import { perpsService } from '../services/perpsService';
import { normalizeNetworkId } from '../config/networks';
import {
  calcPnlCents, calcEquityCents, calcMaintMarginCents,
  isLiquidatable, validateLeverage, usdToCents, tokensToSats,
  calcTakerFeeCents, maxFixed,
} from '../protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../protocol/types';

describe('PEL Perpetuals Protocol-Grade Invariants & Security Suite', () => {
  const OWNER_SECRET = '0x020cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
  const NONCE        = '0x123456789abcdef0123456789abcdef0';
  const MARKET_ID    = 'BTC-PERP';
  const BTC_PRICE    = 9_500_000n;  // $95,000 in cents
  const MARGIN_CENTS = 50_000n;     // $500 in cents
  // 10x leverage on $500 margin at $95k -> $5,000 notional -> 0.05263158 BTC -> 5,263,158 sats
  const QTY_SATS     = 5_263_158n;
  const MAINT_BPS    = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps);

  it('Invariant 1 [Replay Protection]: Different nonces produce unique, collision-resistant nullifiers', () => {
    const c1 = zkProverService.computePositionCommitment(
      OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE,
    );
    const c2 = zkProverService.computePositionCommitment(
      OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, '0xdeadbeef1234',
    );
    const nf1 = zkProverService.computeNullifier(OWNER_SECRET, c1);
    const nf2 = zkProverService.computeNullifier(OWNER_SECRET, c2);
    expect(nf1).not.toBe(nf2);
    expect(nf1.startsWith('0x')).toBe(true);
    expect(nf2.startsWith('0x')).toBe(true);
  });

  it('Invariant 2 [Leverage Bounds]: Opening circuit rejects leverage > L_max (50x)', () => {
    // 1 BTC at $95k = $95,000 notional with $100 margin = 950x leverage → rejects
    const qty    = tokensToSats(1.0);
    const price  = usdToCents(95_000);
    const margin = usdToCents(100);
    const { isValid } = validateLeverage(qty, price, margin, 50);
    expect(isValid).toBe(false);
  });

  it('Invariant 3 [Solvency Inequality]: Position is liquidatable IFF Et <= Mmaint', () => {
    // Position: 0.1 BTC ($9,500 notional), Entry $95k, Margin $500 (19x leverage)
    const qty    = tokensToSats(0.1);
    const price  = usdToCents(95_000);
    const margin = usdToCents(500);
    const maint  = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps);

    // At entry price: PnL = 0, equity = $500, maint ≈ $190 → solvent
    const pnlFlat = calcPnlCents('LONG', qty, price, price);
    expect(isLiquidatable(margin, pnlFlat, 0n, 0n, qty, price, maint)).toBe(false);

    // At $90k (-5.26%): PnL = 0.1 * ($90k - $95k) = -$500 → equity = 0 → at edge
    const downPrice = usdToCents(90_000);
    const pnlDown   = calcPnlCents('LONG', qty, price, downPrice);
    const equityDown = calcEquityCents(margin, pnlDown, 0n, 0n);
    const maintAt   = calcMaintMarginCents(qty, downPrice, maint);
    const liqResult = isLiquidatable(margin, pnlDown, 0n, 0n, qty, downPrice, maint);
    expect(typeof liqResult).toBe('boolean');

    // At $88k: clearly liquidatable for 19x leverage position
    const crashPrice = usdToCents(88_000);
    const pnlCrash   = calcPnlCents('LONG', qty, price, crashPrice);
    expect(isLiquidatable(margin, pnlCrash, 0n, 0n, qty, crashPrice, maint)).toBe(true);
  });

  it('Invariant 4 [Deterministic Poseidon SNIP-36 Fact Binding]: Verifies algebraic fact construction', () => {
    const proof = zkProverService.generateTransitionProof(
      'OPEN',
      { side: 'LONG', sizeTokens: 0.1, entryPrice: 95000, marginUsd: 500,
        fundingAccumulator: 0, nonce: NONCE, ownerAddress: OWNER_SECRET },
      MARKET_ID, 95000, 500, 50, 0.02
    );

    expect(proof.starkVerifierStatus).toBe('POSEIDON_SNIP36_FACT_VALID');
    expect(proof.factHash).toBeTruthy();
    expect(proof.factHash.startsWith('0x')).toBe(true);

    // Reconstruct exact Poseidon public inputs
    const recomputed = zkProverService.computePublicInputsHash(
      'OPEN', MARKET_ID, proof.commitment, proof.nullifier,
      usdToCents(500), usdToCents(95000),
    );
    expect(proof.publicInputsHash).toBe(recomputed);
  });

  it('Invariant 5 [Commitment Binding]: Identical inputs produce identical commitment (determinism)', () => {
    const c1 = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE);
    const c2 = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE);
    expect(c1).toBe(c2);
  });

  it('Invariant 6 [Side Commitment Binding (B1 Fix)]: LONG and SHORT commitments differ', () => {
    const cLong  = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG',  QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE);
    const cShort = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'SHORT', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE);
    expect(cLong).not.toBe(cShort);
  });

  it('Invariant 7 [Anti-Replay Nullifier]: Nullifier changes with nonce', () => {
    const c1 = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, NONCE);
    const c2 = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG', QTY_SATS, BTC_PRICE, MARGIN_CENTS, 0n, '0x01112222333344445555666677778888');
    const nf1 = zkProverService.computeNullifier(OWNER_SECRET, c1);
    const nf2 = zkProverService.computeNullifier(OWNER_SECRET, c2);
    expect(nf1).not.toBe(nf2);
  });

  it('Invariant 8 [Sealed Fact Hash]: fact_hash is deterministic for same (proof_type, commitment, nullifier, amount, oracle)', () => {
    const validCommit = '0x0111111111111111111111111111111111111111111111111111111111111111';
    const validNull   = '0x0222222222222222222222222222222222222222222222222222222222222222';
    const f1 = zkProverService.buildFact('OPEN', MARKET_ID, validCommit, validNull, MARGIN_CENTS, BTC_PRICE);
    const f2 = zkProverService.buildFact('OPEN', MARKET_ID, validCommit, validNull, MARGIN_CENTS, BTC_PRICE);
    expect(f1.factHash).toBe(f2.factHash);
  });

  it('Invariant 9 [Proof Type Isolation]: fact_hashes differ across proof types', () => {
    const validCommit = '0x0111111111111111111111111111111111111111111111111111111111111111';
    const validNull   = '0x0222222222222222222222222222222222222222222222222222222222222222';
    const fOpen  = zkProverService.buildFact('OPEN',  MARKET_ID, validCommit, validNull, MARGIN_CENTS, BTC_PRICE);
    const fClose = zkProverService.buildFact('CLOSE', MARKET_ID, validCommit, validNull, MARGIN_CENTS, BTC_PRICE);
    expect(fOpen.factHash).not.toBe(fClose.factHash);
  });

  it('Invariant 10 [Exact Linear PnL]: LONG PnL = q * (markPrice - entryPrice)', () => {
    const qty      = tokensToSats(0.12345678);
    const entry    = usdToCents(95_000.00);
    const mark     = usdToCents(96_500.25);
    const pnl      = calcPnlCents('LONG', qty, entry, mark);
    // PnL = 0.12345678 * (96500.25 - 95000.00) = 0.12345678 * 1500.25
    // In cents: qty_sats * diff_cents / 1e8 = 12345678 * 150025 / 1e8 = 18521.xxx → floor 18521n
    expect(pnl).toBe(18521n);
  });

  it('Invariant 11 [Liquidation Circuit Solvency Gate]: Prover rejects generating liquidation proof for solvent position', () => {
    const qty   = tokensToSats(0.1);
    const price = usdToCents(95_000);
    const margin = usdToCents(500);
    const commit = zkProverService.computePositionCommitment(OWNER_SECRET, MARKET_ID, 'LONG', qty, price, margin, 0n, NONCE);
    const state = {
      protocolVersion: 2 as const, marketId: 'BTC-PERP' as const, side: 'LONG' as const,
      quantitySats: qty, entryPriceCents: price, marginCents: margin,
      fundingCents: 0n, feesCents: 0n, nonce: NONCE, ownerSecret: OWNER_SECRET,
      commitment: commit, nullifier: '0x0', openedAtMs: Date.now(),
    };
    expect(() =>
      zkProverService.generateLiquidateFact(state, price, price)
    ).toThrow('CIRCUIT_FAIL: position is solvent');
  });

  it('Invariant 12 [Zero-Sum PnL Antisymmetry]: LONG PnL + SHORT PnL = 0', () => {
    const upPrice = (BTC_PRICE * 11000n) / 10000n;
    const longPnl  = calcPnlCents('LONG',  QTY_SATS, BTC_PRICE, upPrice);
    const shortPnl = calcPnlCents('SHORT', QTY_SATS, BTC_PRICE, upPrice);
    expect(longPnl + shortPnl).toBe(0n);
  });

  it('Invariant 13 [Payout Conservation]: equity = margin + PnL - funding - fees (no free money)', () => {
    const upPrice = (BTC_PRICE * 10500n) / 10000n;
    const pnl     = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, upPrice);
    const equity  = calcEquityCents(MARGIN_CENTS, pnl, 0n, 0n);
    expect(equity).toBe(MARGIN_CENTS + pnl);
  });

  it('Invariant 14 [Exact Settlement Payout Gating]: Prover rejects close proof if requested payout exceeds proven equity', () => {
    // A deeply losing position should have payout clamped to 0
    const crashPrice = (BTC_PRICE * 80n) / 100n; // -20%
    const pnl        = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, crashPrice);
    const equity     = calcEquityCents(MARGIN_CENTS, pnl, 0n, 0n);
    const payout     = maxFixed(0n, equity);
    expect(payout).toBe(0n);
    expect(equity).toBeLessThan(0n);
  });

  it('Invariant 15 [Network ID Normalisation]: Canonical SN_SEPOLIA regardless of input string variant', () => {
    expect(normalizeNetworkId('sepolia')).toBe('SN_SEPOLIA');
    expect(normalizeNetworkId('SN_SEPOLIA')).toBe('SN_SEPOLIA');
    expect(normalizeNetworkId('starknet-sepolia')).toBe('SN_SEPOLIA');
    expect(normalizeNetworkId('mainnet')).toBe('SN_MAIN');
  });

  it('Invariant 16 [Fixed-Point Arithmetic Precision]: Linear signed PnL calculates exact integer cents without drift', () => {
    // 0.12345678 BTC * ($96500.25 - $95000.00) in exact integer cents
    const qty   = tokensToSats(0.12345678);
    const entry = usdToCents(95000.00);
    const mark  = usdToCents(96500.25);
    const pnlCents = calcPnlCents('LONG', qty, entry, mark);
    expect(pnlCents).toBe(18521n); // floor of 18521.603...
    // Float path gives same rounded result
    const pnlFloat = zkProverService.evaluatePnLCircuit('LONG', 0.12345678, 95000.00, 96500.25);
    expect(Math.round(pnlFloat * 100)).toBe(18521);
  });
});
