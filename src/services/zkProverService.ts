/**
 * @file zkProverService.ts
 * @description PEL Cryptographic Proving Subsystem — V4.1
 *
 * Implements Poseidon SNIP-36 Transition Fact generation.
 * This is a "Poseidon Fact Commitment Machine":
 *   - Evaluates all financial constraints locally in TypeScript
 *   - Computes a deterministic fact_hash = Poseidon(publicInputs, STWO_TAG)
 *   - The on-chain StwoVerifier checks that fact_hash matches the same computation
 *
 * All math delegated to src/protocol/fixedPoint.ts (BigInt, floor-division).
 * All types from src/protocol/types.ts (single source of truth).
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

export interface CanonicalPositionWitness {
  protocolVersion: 2;
  marketId: 'BTC-PERP';
  side: 'LONG' | 'SHORT';
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  feesCents: bigint;
  nonce: string;
  ownerSecret: string;
  marginNoteNullifier: string;
  openedAtMs: number;
}

export interface PositionWitness {
  side: 'LONG' | 'SHORT';
  sizeTokens: number;
  entryPrice: number;
  marginUsd: number;
  fundingAccumulator: number;
  nonce: string;
  ownerAddress: string;
  marginNoteNullifier?: string;
}

export interface STARKProofResult {
  factHash: string;
  publicInputsHash: string;
  commitment: string;
  nullifier: string;
  circuitResults?: {
    commitment: string;
    nullifier: string;
  };
  proofType: ProofType;
  starkVerifierStatus: 'POSEIDON_SNIP36_FACT_VALID' | 'INVALID';
  timestamp: number;
}

const STWO_TAG_FELT = '0x5354574f5f534e495033365f50524f4f465f5632'; // "STWO_SNIP36_PROOF_V2"

class ZKProverService {

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
    recipientOrCaller: string = '0x0',
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
      recipientOrCaller || '0x0',
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
    recipientOrCaller: string = '0x0',
  ): TransitionFact {
    const publicInputsHash = this.computePublicInputsHash(
      proofType, marketId, commitment, nullifier, amountCents, oraclePriceCents, recipientOrCaller,
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
    quantitySats: bigint | number,
    entryPriceCents: bigint | number,
    marginCents: bigint | number,
    oraclePriceCents: bigint | number,
    marginNullifier: string,    // The STRK20 margin note nullifier being consumed
    collateralOwner: string = '0x0',
  ): { fact: TransitionFact; commitment: string; witness: Omit<PrivatePositionState, 'commitment' | 'nullifier'> } {
    const config = BTC_PERP_CONFIG;

    const qSats = BigInt(quantitySats);
    const epCents = BigInt(entryPriceCents);
    const mCents = BigInt(marginCents);
    const opCents = BigInt(oraclePriceCents);

    // — Circuit 1: Leverage check —
    const { isValid: leverageOk } = validateLeverage(qSats, epCents, mCents, config.maxLeverage);
    if (!leverageOk) throw new Error('CIRCUIT_FAIL: leverage out of bounds');

    // — Circuit 2: Execution price deviation from oracle —
    const deviationOk = validatePriceDeviation(epCents, opCents, BigInt(config.maxExecDeviationBps));
    if (!deviationOk) throw new Error('CIRCUIT_FAIL: execution price deviates too far from oracle');

    // — Circuit 3: Taker fee within expected range —
    const takerFee = calcTakerFeeCents(qSats, epCents, BigInt(config.takerFeeBps));
    if (takerFee > mCents) throw new Error('CIRCUIT_FAIL: fee exceeds margin');

    const fundingCents = 0n;

    const commitment = this.computePositionCommitment(
      ownerSecret, marketId, side, qSats, epCents, mCents, fundingCents, nonce,
    );
    const nullifier = this.computeNullifier(ownerSecret, commitment);

    const fact = this.buildFact('OPEN', marketId, commitment, marginNullifier, mCents, opCents, collateralOwner);

    const witness: Omit<PrivatePositionState, 'commitment' | 'nullifier'> = {
      protocolVersion: 2,
      marketId,
      side,
      quantitySats: qSats,
      entryPriceCents: epCents,
      marginCents: mCents,
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
    markPriceArg: bigint | number,
    oraclePriceArg: bigint | number,
    recipient: string = '0x0',
  ): { fact: TransitionFact; payoutNoteCommitment: string; payoutCents: bigint; proofType: ProofType } {
    const markPriceCents = BigInt(markPriceArg);
    const oraclePriceCents = BigInt(oraclePriceArg);
    const qSats = BigInt(state.quantitySats);
    const epCents = BigInt(state.entryPriceCents);
    const mCents = BigInt(state.marginCents);
    const fundCents = BigInt(state.fundingCents || 0n);
    const feeCents = BigInt(state.feesCents || 0n);

    const pnlCents    = calcPnlCents(state.side, qSats, epCents, markPriceCents);
    const equityCents = calcEquityCents(mCents, pnlCents, fundCents, feeCents);

    const payoutCents = maxFixed(0n, equityCents);

    const payoutNonce  = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const payoutNoteCommitment = hash.computePoseidonHashOnElements([
      STWO_TAG_FELT, state.commitment, payoutNonce, num.toHex(payoutCents),
    ]);

    const nullifier = this.computeNullifier(state.ownerSecret, state.commitment);

    const fact = this.buildFact('CLOSE', state.marketId, payoutNoteCommitment, nullifier, payoutCents, oraclePriceCents, recipient);

    return { fact, payoutNoteCommitment, payoutCents, proofType: 'CLOSE' };
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────

  generateUpdateFact(
    oldState: PrivatePositionState,
    oraclePriceArg: bigint | number,
  ): { fact: TransitionFact; newCommitment: string; newNullifier: string; proofType: ProofType } {
    const oraclePriceCents = BigInt(oraclePriceArg);
    const oldNullifier = this.computeNullifier(oldState.ownerSecret, oldState.commitment);
    const newNonce     = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

    const qSats = BigInt(oldState.quantitySats);
    const epCents = BigInt(oldState.entryPriceCents);
    const mCents = BigInt(oldState.marginCents);
    const fundCents = BigInt(oldState.fundingCents || 0n);

    const newCommitment = this.computePositionCommitment(
      oldState.ownerSecret, oldState.marketId, oldState.side,
      qSats, epCents, mCents, fundCents, newNonce,
    );
    const newNullifier = this.computeNullifier(oldState.ownerSecret, newCommitment);

    const fact = this.buildFact('UPDATE', oldState.marketId, newCommitment, oldNullifier, mCents, oraclePriceCents, '0x0');

    return { fact, newCommitment, newNullifier, proofType: 'UPDATE' };
  }

  // ─── FUND ─────────────────────────────────────────────────────────────────

  generateFundFact(
    state: PrivatePositionState,
    markPriceArg: bigint | number,
    oraclePriceArg: bigint | number,
    fundingRateBpsHrArg: bigint | number,   // signed (positive = longs pay)
    intervalsElapsedArg: bigint | number = 1n,
  ): { fact: TransitionFact; newCommitment: string; fundingCents: bigint; isLongPays: boolean; proofType: ProofType } {
    const markPriceCents = BigInt(markPriceArg);
    const oraclePriceCents = BigInt(oraclePriceArg);
    const fundingRateBpsHr = BigInt(fundingRateBpsHrArg);
    const intervalsElapsed = BigInt(intervalsElapsedArg);

    const qSats = BigInt(state.quantitySats);
    const epCents = BigInt(state.entryPriceCents);
    const mCents = BigInt(state.marginCents);
    const fundCents = BigInt(state.fundingCents || 0n);

    const isLongPays      = fundingRateBpsHr > 0n;
    const fundingPayment  = calcFundingCentsPerInterval(qSats, markPriceCents, fundingRateBpsHr, intervalsElapsed);

    if (fundingPayment > mCents) {
      throw new Error('CIRCUIT_FAIL: funding_payment exceeds margin (position should be liquidated first)');
    }

    const newFundingTotal = fundCents + fundingPayment;
    const oldNullifier    = this.computeNullifier(state.ownerSecret, state.commitment);
    const newNonce        = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

    const newCommitment = this.computePositionCommitment(
      state.ownerSecret, state.marketId, state.side,
      qSats, epCents, mCents - fundingPayment, newFundingTotal, newNonce,
    );

    const fact = this.buildFact('FUND', state.marketId, newCommitment, oldNullifier, fundingPayment, oraclePriceCents, '0x0');

    return { fact, newCommitment, fundingCents: fundingPayment, isLongPays, proofType: 'FUND' };
  }

  // ─── LIQUIDATE ────────────────────────────────────────────────────────────

  generateLiquidateFact(
    state: PrivatePositionState,
    markPriceArg: bigint | number,
    oraclePriceOrKeeper?: bigint | number | string,
    keeperRecipientArg?: string,
  ): { fact: TransitionFact; commitment: string; nullifier: string; bountyCents: bigint; badDebtCents: bigint; factHash: string; proofType: ProofType } {
    const config = BTC_PERP_CONFIG;

    const markPriceCents = BigInt(markPriceArg);
    let oraclePriceCents = markPriceCents;
    let keeperRecipient = '0x0';

    if (typeof oraclePriceOrKeeper === 'bigint' || typeof oraclePriceOrKeeper === 'number') {
      oraclePriceCents = BigInt(oraclePriceOrKeeper);
      keeperRecipient = keeperRecipientArg || '0x0';
    } else if (typeof oraclePriceOrKeeper === 'string') {
      keeperRecipient = oraclePriceOrKeeper;
    }

    const qSats = BigInt(state.quantitySats);
    const epCents = BigInt(state.entryPriceCents);
    const mCents = BigInt(state.marginCents);
    const fundCents = BigInt(state.fundingCents || 0n);
    const feeCents = BigInt(state.feesCents || 0n);

    const pnlCents    = calcPnlCents(state.side, qSats, epCents, markPriceCents);
    const equityCents = calcEquityCents(mCents, pnlCents, fundCents, feeCents);
    const maintMargin = calcMaintMarginCents(qSats, oraclePriceCents, BigInt(config.maintenanceMarginBps));

    if (!isLiquidatable(equityCents, maintMargin)) {
      throw new Error('CIRCUIT_FAIL: position is solvent (equity >= maintMargin)');
    }

    const bountyCents  = (mCents * 200n) / 10000n; // 2%
    const badDebtCents = equityCents < 0n ? -equityCents : 0n;
    const nullifier    = this.computeNullifier(state.ownerSecret, state.commitment);

    const fact = this.buildFact('LIQUIDATE', state.marketId, state.commitment, nullifier, mCents, oraclePriceCents, keeperRecipient);

    return {
      fact,
      commitment: state.commitment,
      nullifier,
      bountyCents,
      badDebtCents,
      factHash: fact.factHash,
      proofType: 'LIQUIDATE',
    };
  }

  // ─── Legacy Math & Proof Helpers ───────────────────────────────────────────

  evaluatePnLCircuit(
    side: 'LONG' | 'SHORT',
    sizeTokens: number,
    entryPrice: number,
    currentPrice: number,
  ): number {
    const qtySats = tokensToSats(sizeTokens);
    const entryCents = usdToCents(entryPrice);
    const currentCents = usdToCents(currentPrice);
    const pnlCents = calcPnlCents(side, qtySats, entryCents, currentCents);
    return Number(pnlCents) / 100;
  }

  generateTransitionProof(
    proofType: ProofType,
    witness: PositionWitness,
    marketId: string,
    currentOraclePrice: number,
    ...rest: any[]
  ): STARKProofResult {
    return this.generateStarkTransitionProof(witness, proofType, marketId, currentOraclePrice);
  }

  generateStarkTransitionProof(
    witness: PositionWitness,
    proofType: ProofType,
    marketId: string,
    currentOraclePrice: number,
  ): STARKProofResult {
    const oraclePriceCents = usdToCents(currentOraclePrice);
    const qtySats = tokensToSats(witness.sizeTokens);
    const epCents = usdToCents(witness.entryPrice);
    const mCents = usdToCents(witness.marginUsd);
    const fundCents = usdToCents(witness.fundingAccumulator);
    const mid = (marketId as 'BTC-PERP') || 'BTC-PERP';

    const commitment = this.computePositionCommitment(
      witness.ownerAddress, mid, witness.side,
      qtySats, epCents, mCents, fundCents, witness.nonce,
    );
    const nullifier = this.computeNullifier(witness.ownerAddress, commitment);

    const state: PrivatePositionState = {
      protocolVersion: 2,
      marketId: mid,
      side: witness.side,
      quantitySats: qtySats,
      entryPriceCents: epCents,
      marginCents: mCents,
      fundingCents: fundCents,
      feesCents: 0n,
      nonce: witness.nonce,
      ownerSecret: witness.ownerAddress,
      openedAtMs: Date.now(),
      commitment,
      nullifier,
    };

    let fact: TransitionFact;

    switch (proofType) {
      case 'OPEN': {
        const marginNullifier = witness.marginNoteNullifier || hash.computePoseidonHashOnElements(['0x6d617267696e', witness.ownerAddress, witness.nonce]);
        const res = this.generateOpenFact(
          state.ownerSecret, state.nonce, 'BTC-PERP', state.side,
          state.quantitySats, state.entryPriceCents, state.marginCents, oraclePriceCents,
          marginNullifier, witness.ownerAddress,
        );
        fact = res.fact;
        break;
      }
      case 'CLOSE': {
        const res = this.generateCloseFact({ ...state, commitment, nullifier }, oraclePriceCents, oraclePriceCents, witness.ownerAddress);
        fact = res.fact;
        break;
      }
      case 'UPDATE': {
        const res = this.generateUpdateFact({ ...state, commitment, nullifier }, oraclePriceCents);
        fact = res.fact;
        break;
      }
      case 'FUND': {
        const res = this.generateFundFact({ ...state, commitment, nullifier }, oraclePriceCents, oraclePriceCents, 120n);
        fact = res.fact;
        break;
      }
      case 'LIQUIDATE': {
        const res = this.generateLiquidateFact({ ...state, commitment, nullifier }, oraclePriceCents, '0x_keeper');
        fact = res.fact;
        break;
      }
      default:
        throw new Error(`Unknown proof type: ${proofType}`);
    }

    return {
      factHash: fact.factHash,
      publicInputsHash: fact.publicInputsHash,
      commitment: fact.commitment,
      nullifier: fact.nullifier,
      circuitResults: {
        commitment: fact.commitment,
        nullifier: fact.nullifier,
      },
      proofType,
      starkVerifierStatus: 'POSEIDON_SNIP36_FACT_VALID',
      timestamp: fact.timestamp,
    };
  }

  // ─── Fact Registration Helper ───────────────────────────────────────────

  async registerFactOnChain(
    proofType: 'OPEN' | 'UPDATE' | 'FUND' | 'LIQUIDATE' | 'CLOSE' | string,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
    recipientOrCaller: string,
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
      recipientOrCaller,
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
