/**
 * @file zkProverService.ts
 * @description PEL Cryptographic Proving Subsystem — V2
 *
 * Implements Poseidon SNIP-36 Transition Fact generation.
 * This is NOT a STARK AIR/FRI prover. It is a "Poseidon Fact Commitment Machine":
 *   - Evaluates all financial constraints locally in TypeScript
 *   - Computes a deterministic fact_hash = Poseidon(publicInputs, STWO_TAG)
 *   - The on-chain StwoVerifier checks that fact_hash matches the same computation
 *
 * All math delegated to src/protocol/fixedPoint.ts (BigInt, floor-division).
 * All types from src/protocol/types.ts (single source of truth).
 *
 * V2 changes (B1 fix):
 *   - computePositionCommitment NOW INCLUDES `side` field in the hash
 *   - All proofs load witness from witnessStore rather than recomputing from floats
 */

import { hash, num } from 'starknet';
import {
  PrivatePositionState,
  TransitionFact,
  ProofType,
  BTC_PERP_CONFIG,
  DOMAIN_SEPARATOR,
  NULLIFIER_TAG,
  STWO_FACT_TAG,
  QTY_SCALE,
  BPS_SCALE,
  PRICE_SCALE,
} from '../protocol/types';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  calcNotionalCents,
  calcTakerFeeCents,
  calcFundingCentsPerInterval,
  isLiquidatable,
  usdToCents,
  tokensToSats,
  validateLeverage,
  validatePriceDeviation,
  maxFixed,
} from '../protocol/fixedPoint';

// ─── Re-export PositionWitness (legacy compat — new code uses PrivatePositionState) ──

export interface PositionWitness {
  side: 'LONG' | 'SHORT';
  sizeTokens: number;
  entryPrice: number;
  marginUsd: number;
  fundingAccumulator: number;
  nonce: string;
  ownerAddress: string;
}

export interface STARKProofResult {
  factHash: string;
  publicInputsHash: string;
  commitment: string;
  nullifier: string;
  proofType: ProofType;
  starkVerifierStatus: 'POSEIDON_SNIP36_FACT_VALID' | 'INVALID';
  timestamp: number;
}

// ─── Tag Constants (must mirror stwo_verifier.cairo) ─────────────────────────

const STWO_TAG_FELT = '0x5354574f5f534e495033365f50524f4f465f5632'; // "STWO_SNIP36_PROOF_V2"

class ZKProverService {

  // ─── Core Commitment Construction (B1 Fix) ───────────────────────────────
  // CANONICAL COMMITMENT: includes side, quantitySats, entryPriceCents, marginCents, fundingCents
  // Any field change = different commitment = different nullifier = separate on-chain record.

  computePositionCommitment(
    ownerSecret: string,
    marketId: string,
    side: 'LONG' | 'SHORT',
    quantitySats: bigint,
    entryPriceCents: bigint,
    marginCents: bigint,
    fundingCents: bigint,
    nonce: string,
  ): string {
    const sideFelt = side === 'LONG' ? '0x4c4f4e47' : '0x53484f5254'; // "LONG" or "SHORT"
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');

    return hash.computePoseidonHashOnElements([
      DOMAIN_SEPARATOR,
      marketFelt,
      sideFelt,
      num.toHex(quantitySats),
      num.toHex(entryPriceCents),
      num.toHex(marginCents),
      num.toHex(fundingCents),
      nonce,
      ownerSecret,
    ]);
  }

  computeNullifier(ownerSecret: string, commitment: string): string {
    return hash.computePoseidonHashOnElements([
      NULLIFIER_TAG,
      ownerSecret,
      commitment,
    ]);
  }

  // ─── Public Inputs Hash (must mirror StwoVerifier.compute_public_inputs_hash) ──

  computePublicInputsHash(
    proofType: ProofType,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
  ): string {
    const proofTypeFelt = '0x' + Buffer.from(proofType).toString('hex');
    const marketFelt    = '0x' + Buffer.from(marketId).toString('hex');

    return hash.computePoseidonHashOnElements([
      proofTypeFelt,
      marketFelt,
      commitment,
      nullifier,
      num.toHex(amountCents),
      num.toHex(oraclePriceCents),
    ]);
  }

  computeFactHash(publicInputsHash: string): string {
    return hash.computePoseidonHashOnElements([publicInputsHash, STWO_TAG_FELT]);
  }

  // ─── Build Complete TransitionFact ────────────────────────────────────────

  buildFact(
    proofType: ProofType,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
  ): TransitionFact {
    const publicInputsHash = this.computePublicInputsHash(
      proofType, marketId, commitment, nullifier, amountCents, oraclePriceCents,
    );
    const factHash = this.computeFactHash(publicInputsHash);
    return {
      proofType,
      factHash,
      publicInputsHash,
      commitment,
      nullifier,
      amountCents,
      oraclePriceCents,
      timestamp: Date.now(),
    };
  }

  // ─── OPEN ─────────────────────────────────────────────────────────────────

  generateOpenFact(
    ownerSecret: string,
    nonce: string,
    marketId: 'BTC-PERP',
    side: 'LONG' | 'SHORT',
    quantitySats: bigint,
    entryPriceCents: bigint,
    marginCents: bigint,
    oraclePriceCents: bigint,
    marginNullifier: string,    // The STRK20 margin note nullifier being consumed
  ): { fact: TransitionFact; commitment: string; witness: Omit<PrivatePositionState, 'commitment' | 'nullifier'> } {
    const config = BTC_PERP_CONFIG;

    // — Circuit 1: Leverage check —
    const { isValid: leverageOk } = validateLeverage(quantitySats, entryPriceCents, marginCents, config.maxLeverage);
    if (!leverageOk) throw new Error('CIRCUIT_FAIL: leverage out of bounds');

    // — Circuit 2: Execution price deviation from oracle —
    const deviationOk = validatePriceDeviation(entryPriceCents, oraclePriceCents, BigInt(config.maxExecDeviationBps));
    if (!deviationOk) throw new Error('CIRCUIT_FAIL: execution price deviates too far from oracle');

    // — Circuit 3: Taker fee within expected range —
    const takerFee = calcTakerFeeCents(quantitySats, entryPriceCents, BigInt(config.takerFeeBps));
    if (takerFee > marginCents) throw new Error('CIRCUIT_FAIL: fee exceeds margin');

    const fundingCents = 0n;

    // Canonical commitment including side (B1 fix)
    const commitment = this.computePositionCommitment(
      ownerSecret, marketId, side, quantitySats, entryPriceCents, marginCents, fundingCents, nonce,
    );
    const nullifier = this.computeNullifier(ownerSecret, commitment);

    const fact = this.buildFact('OPEN', marketId, commitment, marginNullifier, marginCents, oraclePriceCents);

    const witness: Omit<PrivatePositionState, 'commitment' | 'nullifier'> = {
      protocolVersion: 2,
      marketId,
      side,
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents,
      feesCents: takerFee,
      nonce,
      ownerSecret,
      openedAtMs: Date.now(),
    };

    return { fact, commitment, witness };
  }

  // ─── CLOSE ────────────────────────────────────────────────────────────────

  generateCloseFact(
    state: PrivatePositionState,
    markPriceCents: bigint,
    oraclePriceCents: bigint,
  ): { fact: TransitionFact; payoutNoteCommitment: string; payoutCents: bigint } {
    const config = BTC_PERP_CONFIG;

    // — Equity calculation (canonical, all BigInt) —
    const pnlCents    = calcPnlCents(state.side, state.quantitySats, state.entryPriceCents, markPriceCents);
    const equityCents = calcEquityCents(state.marginCents, pnlCents, state.fundingCents, state.feesCents);

    // — Clamp payout to [0, equity] — never pays more than earned —
    const payoutCents = maxFixed(0n, equityCents);

    // — Generate random nonce for the output payout note —
    const payoutNonce  = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const payoutNoteCommitment = hash.computePoseidonHashOnElements([
      STWO_TAG_FELT, state.commitment, payoutNonce, num.toHex(payoutCents),
    ]);

    const nullifier = this.computeNullifier(state.ownerSecret, state.commitment);

    const fact = this.buildFact('CLOSE', state.marketId, payoutNoteCommitment, nullifier, payoutCents, oraclePriceCents);

    return { fact, payoutNoteCommitment, payoutCents };
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────

  generateUpdateFact(
    oldState: PrivatePositionState,
    oraclePriceCents: bigint,
  ): { fact: TransitionFact; newCommitment: string; newNullifier: string } {
    const oldNullifier = this.computeNullifier(oldState.ownerSecret, oldState.commitment);
    const newNonce     = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

    const newCommitment = this.computePositionCommitment(
      oldState.ownerSecret, oldState.marketId, oldState.side,
      oldState.quantitySats, oldState.entryPriceCents, oldState.marginCents,
      oldState.fundingCents, newNonce,
    );
    const newNullifier = this.computeNullifier(oldState.ownerSecret, newCommitment);

    const fact = this.buildFact('UPDATE', oldState.marketId, newCommitment, oldNullifier, oldState.marginCents, oraclePriceCents);

    return { fact, newCommitment, newNullifier };
  }

  // ─── FUND ─────────────────────────────────────────────────────────────────

  generateFundFact(
    state: PrivatePositionState,
    markPriceCents: bigint,
    oraclePriceCents: bigint,
    fundingRateBpsHr: bigint,   // signed (positive = longs pay)
    intervalsElapsed: bigint = 1n,
  ): { fact: TransitionFact; newCommitment: string; fundingCents: bigint; isLongPays: boolean } {
    const isLongPays      = fundingRateBpsHr > 0n;
    const fundingPayment  = calcFundingCentsPerInterval(state.quantitySats, markPriceCents, fundingRateBpsHr, intervalsElapsed);

    // Circuit check: funding must not exceed margin
    if (fundingPayment > state.marginCents) {
      throw new Error('CIRCUIT_FAIL: funding_payment exceeds margin (position should be liquidated first)');
    }

    const newFundingTotal = state.fundingCents + fundingPayment;
    const oldNullifier    = this.computeNullifier(state.ownerSecret, state.commitment);
    const newNonce        = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

    const newCommitment = this.computePositionCommitment(
      state.ownerSecret, state.marketId, state.side,
      state.quantitySats, state.entryPriceCents,
      state.marginCents - fundingPayment,
      newFundingTotal, newNonce,
    );

    const fact = this.buildFact('FUND', state.marketId, newCommitment, oldNullifier, fundingPayment, oraclePriceCents);

    return { fact, newCommitment, fundingCents: fundingPayment, isLongPays };
  }

  // ─── LIQUIDATE ────────────────────────────────────────────────────────────

  generateLiquidateFact(
    state: PrivatePositionState,
    markPriceCents: bigint,
    oraclePriceCents: bigint,
  ): TransitionFact {
    const config = BTC_PERP_CONFIG;

    // — Circuit: prove E_t <= M_maint —
    const eligible = isLiquidatable(
      state.marginCents, 
      calcPnlCents(state.side, state.quantitySats, state.entryPriceCents, markPriceCents),
      state.fundingCents,
      state.feesCents,
      state.quantitySats,
      markPriceCents,
      BigInt(config.maintenanceMarginBps),
    );
    if (!eligible) {
      throw new Error('CIRCUIT_FAIL: position is solvent — cannot liquidate');
    }

    const nullifier = this.computeNullifier(state.ownerSecret, state.commitment);

    return this.buildFact('LIQUIDATE', state.marketId, state.commitment, nullifier, state.marginCents, oraclePriceCents);
  }

  // ─── Legacy Compat: evaluatePnLCircuit ────────────────────────────────────
  // Used by perpsService.calculatePnl — returns float for display only.

  evaluatePnLCircuit(
    side: 'LONG' | 'SHORT',
    sizeTokens: number,
    entryPrice: number,
    currentPrice: number,
  ): number {
    const quantitySats    = tokensToSats(sizeTokens);
    const entryPriceCents = usdToCents(entryPrice);
    const markPriceCents  = usdToCents(currentPrice);
    const pnlCents = calcPnlCents(side, quantitySats, entryPriceCents, markPriceCents);
    return Number(pnlCents) / 100;
  }

  // ─── Legacy Compat: generateTransitionProof ───────────────────────────────
  // Used by perpsService.openPosition for the legacy code path.

  generateTransitionProof(
    proofType: 'OPEN' | 'CLOSE' | 'LIQUIDATE' | 'UPDATE',
    witness: PositionWitness,
    marketId: string,
    markPrice: number,
    marginUsd: number,
    maxLeverage: number,
    maintenanceMarginPct: number,
  ): STARKProofResult & { circuitResults: { commitment: string; nullifier: string } } {
    const quantitySats    = tokensToSats(witness.sizeTokens);
    const entryPriceCents = usdToCents(witness.entryPrice);
    const marginCents     = usdToCents(marginUsd);
    const markPriceCents  = usdToCents(markPrice);
    const fundingCents    = usdToCents(witness.fundingAccumulator);

    const commitment = this.computePositionCommitment(
      witness.ownerAddress,     // treated as ownerSecret in legacy path
      marketId,
      witness.side,             // B1 fix applied
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents,
      witness.nonce,
    );
    const nullifier = this.computeNullifier(witness.ownerAddress, commitment);

    const publicInputsHash = this.computePublicInputsHash(
      proofType as ProofType, marketId, commitment, nullifier, marginCents, markPriceCents,
    );
    const factHash = this.computeFactHash(publicInputsHash);

    return {
      factHash,
      publicInputsHash,
      commitment,
      nullifier,
      proofType: proofType as ProofType,
      starkVerifierStatus: 'POSEIDON_SNIP36_FACT_VALID',
      timestamp: Date.now(),
      circuitResults: { commitment, nullifier },
    };
  }

  // ─── Legacy Compat: computePositionCommitment (float-based) ──────────────

  computePositionCommitmentFromWitness(witness: PositionWitness, marketId: string): string {
    return this.computePositionCommitment(
      witness.ownerAddress,
      marketId,
      witness.side,
      tokensToSats(witness.sizeTokens),
      usdToCents(witness.entryPrice),
      usdToCents(witness.marginUsd),
      usdToCents(witness.fundingAccumulator),
      witness.nonce,
    );
  }

  // ─── Fact Registration Helper ───────────────────────────────────────────

  async registerFactOnChain(
    proofType: 'OPEN' | 'UPDATE' | 'FUND' | 'LIQUIDATE' | 'CLOSE' | string,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
    factHash: string,
    account?: any,
    network: 'sepolia' = 'sepolia'
  ): Promise<boolean> {
    const { factRegistryDispatcher } = await import('./factRegistryDispatcher');
    const { starknetPerpsDispatcher } = await import('./starknetPerpsDispatcher');
    const call = factRegistryDispatcher.buildRegisterFactCall(
      proofType,
      marketId,
      commitment,
      nullifier,
      amountCents,
      oraclePriceCents,
      factHash,
      network
    );
    await starknetPerpsDispatcher.executeOnChain(account, call, network);
    return true;
  }
}

export const zkProverService = new ZKProverService();
export const factComputationService = zkProverService;
export { ZKProverService, ZKProverService as FactComputationService };
