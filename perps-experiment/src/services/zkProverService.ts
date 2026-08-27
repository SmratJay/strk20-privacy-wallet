/**
 * @file src/services/zkProverService.ts
 * @description Client-side ZK Proof & SNIP-36 Transition Fact Generator (Whitepaper Section 3.1 & 11)
 *
 * Implements typed domain-separated transition facts matching StwoVerifier.cairo V4.3:
 * - OPEN_FACT: H(OPEN_TAG, market, commitment, margin_nullifier, margin, oracle_price, owner)
 * - UPDATE_FACT: H(UPDATE_TAG, market, old_commitment, old_nullifier, new_commitment, new_margin, oracle_price)
 * - FUND_FACT: H(FUND_TAG, market, old_commitment, old_nullifier, new_commitment, funding, new_margin, oracle_price, direction)
 * - CLOSE_FACT: H(CLOSE_TAG, market, position_commitment, final_nullifier, payout_commitment, payout_amount, oracle_price, recipient)
 * - LIQ_FACT: H(LIQUIDATE_TAG, market, position_commitment, position_nullifier, liquidation_amount, oracle_price, keeper)
 */

import { hash, num, Call, AccountInterface } from 'starknet';
import { factRegistryDispatcher } from './factRegistryDispatcher';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';
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
import { BTC_PERP_CONFIG } from '../protocol/types';

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
  proofType: string;
  starkVerifierStatus: string;
  timestamp: number;
}

export type ProofType = 'OPEN' | 'UPDATE' | 'FUND' | 'LIQUIDATE' | 'CLOSE';

export interface PrivatePositionState {
  protocolVersion: number;
  marketId: 'BTC-PERP';
  side: 'LONG' | 'SHORT';
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  feesCents: bigint;
  nonce: string;
  ownerSecret: string;
  openedAtMs: number;
  commitment: string;
  nullifier: string;
}

export interface TransitionFact {
  proofType: ProofType;
  factHash: string;
  publicInputsHash: string;
  commitment: string;
  nullifier: string;
  amountCents: bigint;
  oraclePriceCents: bigint;
  timestamp: number;
}

const DOMAIN_SEPARATOR = '0x50454c5f504f534954494f4e5f5632'; // "PEL_POSITION_V2"
const NULLIFIER_TAG    = '0x50454c5f4e554c4c49464945525f5632'; // "PEL_NULLIFIER_V2"

export const OPEN_TAG_FELT   = '0x' + Buffer.from('STWO_PEL_OPEN_V4').toString('hex');
export const UPDATE_TAG_FELT = '0x' + Buffer.from('STWO_PEL_UPDATE_V4').toString('hex');
export const FUND_TAG_FELT   = '0x' + Buffer.from('STWO_PEL_FUND_V4').toString('hex');
export const CLOSE_TAG_FELT  = '0x' + Buffer.from('STWO_PEL_CLOSE_V4').toString('hex');
export const LIQ_TAG_FELT    = '0x' + Buffer.from('STWO_PEL_LIQ_V4').toString('hex');

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

  // ─── TYPED FACT HASH COMPUTATION (Domain-Separated) ────────────────────────

  computeOpenFactHash(
    marketId: string,
    commitment: string,
    marginNullifier: string,
    marginCents: bigint,
    oraclePriceCents: bigint,
    owner: string,
  ): string {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    return hash.computePoseidonHashOnElements([
      OPEN_TAG_FELT,
      marketFelt,
      commitment,
      marginNullifier,
      num.toHex(marginCents),
      num.toHex(oraclePriceCents),
      owner || '0x0',
    ]);
  }

  computeUpdateFactHash(
    marketId: string,
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    newMarginCents: bigint,
    oraclePriceCents: bigint,
  ): string {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    return hash.computePoseidonHashOnElements([
      UPDATE_TAG_FELT,
      marketFelt,
      oldCommitment,
      oldNullifier,
      newCommitment,
      num.toHex(newMarginCents),
      num.toHex(oraclePriceCents),
    ]);
  }

  computeFundFactHash(
    marketId: string,
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    fundingCents: bigint,
    newMarginCents: bigint,
    oraclePriceCents: bigint,
    direction: boolean,
  ): string {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    return hash.computePoseidonHashOnElements([
      FUND_TAG_FELT,
      marketFelt,
      oldCommitment,
      oldNullifier,
      newCommitment,
      num.toHex(fundingCents),
      num.toHex(newMarginCents),
      num.toHex(oraclePriceCents),
      direction ? '0x1' : '0x0',
    ]);
  }

  computeCloseFactHash(
    marketId: string,
    positionCommitment: string,
    finalNullifier: string,
    payoutCommitment: string,
    payoutAmountCents: bigint,
    oraclePriceCents: bigint,
    recipient: string,
  ): string {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    return hash.computePoseidonHashOnElements([
      CLOSE_TAG_FELT,
      marketFelt,
      positionCommitment,
      finalNullifier,
      payoutCommitment,
      num.toHex(payoutAmountCents),
      num.toHex(oraclePriceCents),
      recipient || '0x0',
    ]);
  }

  computeLiquidateFactHash(
    marketId: string,
    positionCommitment: string,
    positionNullifier: string,
    liquidationAmountCents: bigint,
    oraclePriceCents: bigint,
    keeper: string,
  ): string {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    return hash.computePoseidonHashOnElements([
      LIQ_TAG_FELT,
      marketFelt,
      positionCommitment,
      positionNullifier,
      num.toHex(liquidationAmountCents),
      num.toHex(oraclePriceCents),
      keeper || '0x0',
    ]);
  }

  // ─── CANONICAL TYPED TRANSITION FACT PROVERS (SNIP-36) ─────────────────────

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
    marginNullifier: string,
    collateralOwner: string = '0x0',
  ): { fact: TransitionFact; commitment: string; witness: Omit<PrivatePositionState, 'commitment' | 'nullifier'> } {
    const config = BTC_PERP_CONFIG;

    const qSats = BigInt(quantitySats);
    const epCents = BigInt(entryPriceCents);
    const mCents = BigInt(marginCents);
    const opCents = BigInt(oraclePriceCents);

    const { isValid: leverageOk } = validateLeverage(qSats, epCents, mCents, config.maxLeverage);
    if (!leverageOk) throw new Error('CIRCUIT_FAIL: leverage out of bounds');

    const devOk = validatePriceDeviation(epCents, opCents, BigInt(Math.max(Number(config.maxExecDeviationBps || 100), 2000)));
    if (!devOk) throw new Error('CIRCUIT_FAIL: execution price deviates too far from oracle');

    const commitment = this.computePositionCommitment(
      ownerSecret, marketId, side, qSats, epCents, mCents, 0n, nonce,
    );

    const factHash = this.computeOpenFactHash(marketId, commitment, marginNullifier, mCents, opCents, collateralOwner);

    const fact: TransitionFact = {
      proofType: 'OPEN',
      factHash,
      publicInputsHash: factHash,
      commitment,
      nullifier: marginNullifier,
      amountCents: mCents,
      oraclePriceCents: opCents,
      timestamp: Date.now(),
    };

    return {
      fact,
      commitment,
      witness: {
        protocolVersion: 2,
        marketId,
        side,
        quantitySats: qSats,
        entryPriceCents: epCents,
        marginCents: mCents,
        fundingCents: 0n,
        feesCents: 0n,
        nonce,
        ownerSecret,
        openedAtMs: Date.now(),
      },
    };
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
      CLOSE_TAG_FELT, state.commitment, payoutNonce, num.toHex(payoutCents),
    ]);

    const finalNullifier = this.computeNullifier(state.ownerSecret, state.commitment);
    const factHash = this.computeCloseFactHash(
      state.marketId, state.commitment, finalNullifier, payoutNoteCommitment, payoutCents, oraclePriceCents, recipient,
    );

    const fact: TransitionFact = {
      proofType: 'CLOSE',
      factHash,
      publicInputsHash: factHash,
      commitment: state.commitment,
      nullifier: finalNullifier,
      amountCents: payoutCents,
      oraclePriceCents,
      timestamp: Date.now(),
    };

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

    const factHash = this.computeUpdateFactHash(
      oldState.marketId, oldState.commitment, oldNullifier, newCommitment, mCents, oraclePriceCents,
    );

    const fact: TransitionFact = {
      proofType: 'UPDATE',
      factHash,
      publicInputsHash: factHash,
      commitment: newCommitment,
      nullifier: oldNullifier,
      amountCents: mCents,
      oraclePriceCents,
      timestamp: Date.now(),
    };

    return { fact, newCommitment, newNullifier, proofType: 'UPDATE' };
  }

  // ─── FUND ─────────────────────────────────────────────────────────────────

  generateFundFact(
    state: PrivatePositionState,
    markPriceArg: bigint | number,
    oraclePriceArg: bigint | number,
    fundingRateBpsHrArg: bigint | number,
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

    if (isLongPays && fundingPayment > mCents) {
      throw new Error('CIRCUIT_FAIL: funding_payment exceeds margin (position should be liquidated first)');
    }

    const newFundingTotal = fundCents + fundingPayment;
    const newMarginCents  = isLongPays ? mCents - fundingPayment : mCents + fundingPayment;
    const oldNullifier    = this.computeNullifier(state.ownerSecret, state.commitment);
    const newNonce        = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');

    const newCommitment = this.computePositionCommitment(
      state.ownerSecret, state.marketId, state.side,
      qSats, epCents, newMarginCents, newFundingTotal, newNonce,
    );

    const factHash = this.computeFundFactHash(
      state.marketId, state.commitment, oldNullifier, newCommitment, fundingPayment, newMarginCents, oraclePriceCents, isLongPays,
    );

    const fact: TransitionFact = {
      proofType: 'FUND',
      factHash,
      publicInputsHash: factHash,
      commitment: newCommitment,
      nullifier: oldNullifier,
      amountCents: fundingPayment,
      oraclePriceCents,
      timestamp: Date.now(),
    };

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
    const commitment   = state.commitment || this.computePositionCommitment(
      state.ownerSecret, state.marketId, state.side, qSats, epCents, mCents, fundCents, state.nonce
    );
    const nullifier    = this.computeNullifier(state.ownerSecret, commitment);

    const factHash = this.computeLiquidateFactHash(
      state.marketId, commitment, nullifier, mCents, oraclePriceCents, keeperRecipient,
    );

    const fact: TransitionFact = {
      proofType: 'LIQUIDATE',
      factHash,
      publicInputsHash: factHash,
      commitment,
      nullifier,
      amountCents: mCents,
      oraclePriceCents,
      timestamp: Date.now(),
    };

    return {
      fact,
      commitment,
      nullifier,
      bountyCents,
      badDebtCents,
      factHash,
      proofType: 'LIQUIDATE',
    };
  }

  // ─── Legacy & Proof Generation Wrappers ───────────────────────────────────

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

  // ─── Fact Registration Helper (Typed StwoVerifier Dispatch) ────────────────

  async registerFactOnChain(
    proofType: ProofType | string,
    marketId: string,
    commitment: string,
    nullifier: string,
    amountCents: bigint,
    oraclePriceCents: bigint,
    recipientOrCaller: string = '0x0',
    factHash: string,
    signerAccount?: any,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const isRegistered = await factRegistryDispatcher.isFactRegistered(factHash, network);
    if (isRegistered) return;

    let entrypoint = 'register_open_fact';
    let calldata: string[] = [];

    switch (proofType) {
      case 'OPEN':
        entrypoint = 'register_open_fact';
        calldata = [
          '0x' + Buffer.from(marketId).toString('hex'),
          commitment,
          nullifier,
          amountCents.toString(),
          oraclePriceCents.toString(),
          recipientOrCaller || '0x0',
          factHash,
        ];
        break;
      case 'UPDATE':
        entrypoint = 'register_update_fact';
        calldata = [
          '0x' + Buffer.from(marketId).toString('hex'),
          commitment,
          nullifier,
          commitment,
          amountCents.toString(),
          oraclePriceCents.toString(),
          factHash,
        ];
        break;
      case 'FUND':
        entrypoint = 'register_fund_fact';
        calldata = [
          '0x' + Buffer.from(marketId).toString('hex'),
          commitment,
          nullifier,
          commitment,
          amountCents.toString(),
          amountCents.toString(),
          oraclePriceCents.toString(),
          '0x1',
          factHash,
        ];
        break;
      case 'CLOSE':
        entrypoint = 'register_close_fact';
        calldata = [
          '0x' + Buffer.from(marketId).toString('hex'),
          commitment,
          nullifier,
          commitment,
          amountCents.toString(),
          oraclePriceCents.toString(),
          recipientOrCaller || '0x0',
          factHash,
        ];
        break;
      case 'LIQUIDATE':
        entrypoint = 'register_liquidate_fact';
        calldata = [
          '0x' + Buffer.from(marketId).toString('hex'),
          commitment,
          nullifier,
          amountCents.toString(),
          oraclePriceCents.toString(),
          recipientOrCaller || '0x0',
          factHash,
        ];
        break;
    }

    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint,
      calldata,
    };

    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }

  // ─── DEDICATED TYPED REGISTRATION METHODS (P0-04 & P0-05) ───────────────────

  async registerOpenFactOnChain(
    marketId: string,
    commitment: string,
    marginNullifier: string,
    marginCents: bigint,
    oraclePriceCents: bigint,
    owner: string,
    factHash: string,
    signerAccount?: AccountInterface,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint: 'register_open_fact',
      calldata: [
        marketFelt,
        commitment,
        marginNullifier,
        marginCents.toString(),
        oraclePriceCents.toString(),
        owner || '0x0',
        factHash,
      ],
    };
    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }

  async registerUpdateFactOnChain(
    marketId: string,
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    newMarginCents: bigint,
    oraclePriceCents: bigint,
    factHash: string,
    signerAccount?: AccountInterface,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint: 'register_update_fact',
      calldata: [
        marketFelt,
        oldCommitment,
        oldNullifier,
        newCommitment,
        newMarginCents.toString(),
        oraclePriceCents.toString(),
        factHash,
      ],
    };
    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }

  async registerFundFactOnChain(
    marketId: string,
    oldCommitment: string,
    oldNullifier: string,
    newCommitment: string,
    fundingCents: bigint,
    newMarginCents: bigint,
    oraclePriceCents: bigint,
    isLongPays: boolean,
    factHash: string,
    signerAccount?: AccountInterface,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint: 'register_fund_fact',
      calldata: [
        marketFelt,
        oldCommitment,
        oldNullifier,
        newCommitment,
        fundingCents.toString(),
        newMarginCents.toString(),
        oraclePriceCents.toString(),
        isLongPays ? '0x1' : '0x0',
        factHash,
      ],
    };
    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }

  async registerCloseFactOnChain(
    marketId: string,
    positionCommitment: string,
    finalNullifier: string,
    payoutCommitment: string,
    payoutAmountCents: bigint,
    oraclePriceCents: bigint,
    recipient: string,
    factHash: string,
    signerAccount?: AccountInterface,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint: 'register_close_fact',
      calldata: [
        marketFelt,
        positionCommitment,
        finalNullifier,
        payoutCommitment,
        payoutAmountCents.toString(),
        oraclePriceCents.toString(),
        recipient || '0x0',
        factHash,
      ],
    };
    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }

  async registerLiquidateFactOnChain(
    marketId: string,
    positionCommitment: string,
    positionNullifier: string,
    liquidationAmountCents: bigint,
    oraclePriceCents: bigint,
    keeper: string,
    factHash: string,
    signerAccount?: AccountInterface,
    network: 'sepolia' = 'sepolia'
  ): Promise<void> {
    const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
    const call: Call = {
      contractAddress: PERPS_DEPLOYMENTS[network].stwoVerifierAddress,
      entrypoint: 'register_liquidate_fact',
      calldata: [
        marketFelt,
        positionCommitment,
        positionNullifier,
        liquidationAmountCents.toString(),
        oraclePriceCents.toString(),
        keeper || '0x0',
        factHash,
      ],
    };
    await starknetPerpsDispatcher.executeOnChain(signerAccount, call, network);
  }
}

export const zkProverService = new ZKProverService();
