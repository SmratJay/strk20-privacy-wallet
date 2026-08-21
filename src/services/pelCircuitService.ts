/**
 * @file src/services/pelCircuitService.ts
 * @description Canonical client bridge to the PEL zk-SNARK circuits (Groth16, BN254).
 *
 * This is the single source of truth for the Poseidon commitment/nullifier used by the
 * PEL transition circuits (circuits/pel_open.circom, circuits/pel_close.circom).
 *
 * IMPORTANT: the hash here is BN254 Poseidon (circomlibjs), which matches the circom
 * circuit exactly. It intentionally differs from starknet.js's STARK-field Poseidon used
 * by the legacy `zkProverService.ts` — that legacy service is superseded by this one.
 *
 * Known field-compatibility note: BN254 Poseidon outputs live in [0, r) where
 * r ≈ 2.18e76 > 2^251; before storing commitments on-chain as felt252 the values must
 * be reduced/bound to the STARK field (p ≈ 2^251). The on-chain Groth16 verifier
 * (Garaga) handles this. This service keeps commitments as full BN254 field elements.
 */

import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';

export const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
export const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
export const PAYOUT_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_V2').toString('hex'));
export const MARKET_ID = BigInt('0x' + Buffer.from('BTC-PERP').toString('hex'));
export const QTY_SCALE = 100000000n; // sats per BTC

let poseidon: any = null;
let poseidonPromise: Promise<any> | null = null;

async function getPoseidon() {
  if (poseidon) return poseidon;
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  poseidon = await poseidonPromise;
  return poseidon;
}

async function poseidonHash(elems: bigint[]): Promise<bigint> {
  const p = await getPoseidon();
  return BigInt(p.F.toString(p(elems.map((e) => e.toString()))));
}

export interface OpenWitness {
  side: 0n | 1n; // 0 = LONG, 1 = SHORT
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  nonce: bigint;
  ownerSecret: bigint;
}

export interface CloseWitness {
  side: 0n | 1n;
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  feesCents: bigint;
  nonce: bigint;
  ownerSecret: bigint;
  payoutNonce: bigint;
  oraclePriceCents: bigint;
}

export interface ProvenTransition {
  proof: unknown;
  publicSignals: string[];
  commitment: bigint;
  nullifier: bigint;
}

export async function computePositionCommitment(
  side: 0n | 1n,
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
  fundingCents: bigint,
  nonce: bigint,
  ownerSecret: bigint,
): Promise<bigint> {
  return poseidonHash([DOMAIN_SEP, MARKET_ID, side, quantitySats, entryPriceCents, marginCents, fundingCents, nonce, ownerSecret]);
}

export async function computeNullifier(ownerSecret: bigint, commitment: bigint): Promise<bigint> {
  return poseidonHash([NULLIFIER_TAG, ownerSecret, commitment]);
}

export async function computePayoutCommitment(payoutAmount: bigint, payoutNonce: bigint): Promise<bigint> {
  return poseidonHash([PAYOUT_TAG, payoutAmount, payoutNonce]);
}

/**
 * Signed value decomposition matching the circuit's SignedDecompose template:
 * returns [isNeg (0|1), magnitude].
 */
export function decomposeSigned(value: bigint): [bigint, bigint] {
  if (value < 0n) return [1n, -value];
  return [0n, value];
}

/** Compute the close PnL/equity/payout witnesses, matching the circuit + riskEngine. */
export function computeCloseSettlement(
  side: 0n | 1n,
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
  fundingCents: bigint,
  feesCents: bigint,
  oraclePriceCents: bigint,
): {
  diffIsNeg: bigint; diffMag: bigint; pnlMag: bigint; pnlRem: bigint;
  equityIsNeg: bigint; equityMag: bigint; payout: bigint;
} {
  const delta = side === 0n ? oraclePriceCents - entryPriceCents : entryPriceCents - oraclePriceCents;
  const [diffIsNeg, diffMag] = decomposeSigned(delta);
  const prod = quantitySats * diffMag;
  const pnlMag = prod / QTY_SCALE;
  const pnlRem = prod % QTY_SCALE;
  const pnl = diffIsNeg ? -pnlMag : pnlMag;
  const equity = marginCents + pnl - fundingCents - feesCents;
  const [equityIsNeg, equityMag] = decomposeSigned(equity);
  const payout = equityIsNeg ? 0n : equityMag;
  return { diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag, payout };
}

const WASM_DIR = 'circuits/build';

export async function generateOpenProof(w: OpenWitness): Promise<ProvenTransition> {
  const commitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, 0n, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment);

  const input = {
    commitment: commitment.toString(),
    marginNullifier: nullifier_.toString(),
    marketId: MARKET_ID.toString(),
    side: w.side.toString(),
    quantity: w.quantitySats.toString(),
    entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(),
    nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${WASM_DIR}/pel_open_js/pel_open.wasm`,
    `${WASM_DIR}/pel_open.zkey`
  );
  return { proof, publicSignals, commitment, nullifier: nullifier_ };
}

export async function generateCloseProof(w: CloseWitness): Promise<ProvenTransition & { payout: bigint; payoutCommitment: bigint }> {
  const commitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment);
  const s = computeCloseSettlement(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.feesCents, w.oraclePriceCents);
  const payoutCommitment = await computePayoutCommitment(s.payout, w.payoutNonce);

  const input = {
    commitment: commitment.toString(),
    finalNullifier: nullifier_.toString(),
    payoutCommitment: payoutCommitment.toString(),
    payoutAmount: s.payout.toString(),
    marketId: MARKET_ID.toString(),
    oraclePrice: w.oraclePriceCents.toString(),
    side: w.side.toString(),
    quantity: w.quantitySats.toString(),
    entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(),
    funding: w.fundingCents.toString(),
    fees: w.feesCents.toString(),
    nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(),
    payoutNonce: w.payoutNonce.toString(),
    diffIsNeg: s.diffIsNeg.toString(),
    diffMag: s.diffMag.toString(),
    pnlMag: s.pnlMag.toString(),
    pnlRem: s.pnlRem.toString(),
    equityIsNeg: s.equityIsNeg.toString(),
    equityMag: s.equityMag.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${WASM_DIR}/pel_close_js/pel_close.wasm`,
    `${WASM_DIR}/pel_close.zkey`
  );
  return { proof, publicSignals, commitment, nullifier: nullifier_, payout: s.payout, payoutCommitment };
}

export interface UpdateWitness {
  side: 0n | 1n;
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  nonce: bigint;
  newNonce: bigint;
  ownerSecret: bigint;
}

export interface FundWitness {
  side: 0n | 1n;
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  nonce: bigint;
  newNonce: bigint;
  ownerSecret: bigint;
  markPriceCents: bigint;
  fundingRateBpsHr: bigint; // signed
  intervalsElapsed: bigint;
}

export interface LiquidateWitness {
  side: 0n | 1n;
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  feesCents: bigint;
  nonce: bigint;
  ownerSecret: bigint;
  markPriceCents: bigint;
  keeper: bigint;
}

/** Funding settlement, matching the circuit's PelFund + riskEngine. */
export function computeFundingSettlement(
  quantitySats: bigint,
  markPriceCents: bigint,
  marginCents: bigint,
  fundingCents: bigint,
  fundingRateBpsHr: bigint,
  intervalsElapsed: bigint,
): {
  rateIsNeg: bigint; rateAbs: bigint; notional: bigint; notionalRem: bigint;
  rawFunding: bigint; rawFundingRem: bigint; fundingPayment: bigint;
  isLongPays: bigint; newMargin: bigint; newFunding: bigint;
} {
  const [rateIsNeg, rateAbs] = decomposeSigned(fundingRateBpsHr);
  const notional = (quantitySats * markPriceCents) / QTY_SCALE;
  const notionalRem = (quantitySats * markPriceCents) % QTY_SCALE;
  const rawFunding = (notional * rateAbs) / 10000n;
  const rawFundingRem = (notional * rateAbs) % 10000n;
  const fundingPayment = rawFunding * intervalsElapsed;
  const isLongPays = 1n - rateIsNeg;
  const newMargin = isLongPays ? marginCents - fundingPayment : marginCents + fundingPayment;
  const newFunding = fundingCents + fundingPayment;
  return { rateIsNeg, rateAbs, notional, notionalRem, rawFunding, rawFundingRem, fundingPayment, isLongPays, newMargin, newFunding };
}

/** Liquidation settlement, matching the circuit's PelLiquidate. */
export function computeLiquidationSettlement(
  side: 0n | 1n,
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
  fundingCents: bigint,
  feesCents: bigint,
  markPriceCents: bigint,
): {
  diffIsNeg: bigint; diffMag: bigint; pnlMag: bigint; pnlRem: bigint;
  equityIsNeg: bigint; equityMag: bigint; notional: bigint; notionalRem: bigint;
  maint: bigint; maintRem: bigint; equity: bigint; isLiquidatable: boolean;
} {
  const delta = side === 0n ? markPriceCents - entryPriceCents : entryPriceCents - markPriceCents;
  const [diffIsNeg, diffMag] = decomposeSigned(delta);
  const prod = quantitySats * diffMag;
  const pnlMag = prod / QTY_SCALE;
  const pnlRem = prod % QTY_SCALE;
  const pnl = diffIsNeg ? -pnlMag : pnlMag;
  const equity = marginCents + pnl - fundingCents - feesCents;
  const [equityIsNeg, equityMag] = decomposeSigned(equity);
  const notional = (quantitySats * markPriceCents) / QTY_SCALE;
  const notionalRem = (quantitySats * markPriceCents) % QTY_SCALE;
  const maint = (notional * 200n) / 10000n;
  const maintRem = (notional * 200n) % 10000n;
  const isLiquidatable = equityIsNeg === 1n || equityMag <= maint;
  return { diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag, notional, notionalRem, maint, maintRem, equity, isLiquidatable };
}

export async function generateUpdateProof(w: UpdateWitness): Promise<ProvenTransition & { newCommitment: bigint }> {
  const commitment_ = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment_);
  const newCommitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.newNonce, w.ownerSecret);

  const input = {
    oldCommitment: commitment_.toString(), newCommitment: newCommitment.toString(),
    oldNullifier: nullifier_.toString(), marketId: MARKET_ID.toString(),
    side: w.side.toString(), quantity: w.quantitySats.toString(), entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(), funding: w.fundingCents.toString(), nonce: w.nonce.toString(),
    newNonce: w.newNonce.toString(), ownerSecret: w.ownerSecret.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `${WASM_DIR}/pel_update_js/pel_update.wasm`, `${WASM_DIR}/pel_update.zkey`);
  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_, newCommitment };
}

export async function generateFundProof(w: FundWitness): Promise<ProvenTransition & { newCommitment: bigint; fundingPayment: bigint; newMargin: bigint; newFunding: bigint }> {
  const commitment_ = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment_);
  const s = computeFundingSettlement(w.quantitySats, w.markPriceCents, w.marginCents, w.fundingCents, w.fundingRateBpsHr, w.intervalsElapsed);
  const newCommitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, s.newMargin, s.newFunding, w.newNonce, w.ownerSecret);

  const input = {
    oldCommitment: commitment_.toString(), newCommitment: newCommitment.toString(),
    oldNullifier: nullifier_.toString(), marketId: MARKET_ID.toString(),
    oraclePrice: w.markPriceCents.toString(), fundingRateBpsHr: w.fundingRateBpsHr.toString(),
    intervalsElapsed: w.intervalsElapsed.toString(),
    side: w.side.toString(), quantity: w.quantitySats.toString(), entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(), funding: w.fundingCents.toString(), nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(), newNonce: w.newNonce.toString(),
    rateIsNeg: s.rateIsNeg.toString(), rateAbs: s.rateAbs.toString(),
    notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
    rawFunding: s.rawFunding.toString(), rawFundingRem: s.rawFundingRem.toString(),
    newMarginIsNeg: '0', newMarginMag: s.newMargin.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `${WASM_DIR}/pel_fund_js/pel_fund.wasm`, `${WASM_DIR}/pel_fund.zkey`);
  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_, newCommitment, fundingPayment: s.fundingPayment, newMargin: s.newMargin, newFunding: s.newFunding };
}

export async function generateLiquidateProof(w: LiquidateWitness): Promise<ProvenTransition> {
  const commitment_ = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment_);
  const s = computeLiquidationSettlement(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.feesCents, w.markPriceCents);

  const input = {
    positionCommitment: commitment_.toString(), positionNullifier: nullifier_.toString(),
    marketId: MARKET_ID.toString(), oraclePrice: w.markPriceCents.toString(), keeper: w.keeper.toString(),
    side: w.side.toString(), quantity: w.quantitySats.toString(), entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(), funding: w.fundingCents.toString(), fees: w.feesCents.toString(),
    nonce: w.nonce.toString(), ownerSecret: w.ownerSecret.toString(),
    diffIsNeg: s.diffIsNeg.toString(), diffMag: s.diffMag.toString(),
    pnlMag: s.pnlMag.toString(), pnlRem: s.pnlRem.toString(),
    notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
    maint: s.maint.toString(), maintRem: s.maintRem.toString(),
    equityIsNeg: s.equityIsNeg.toString(), equityMag: s.equityMag.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, `${WASM_DIR}/pel_liquidate_js/pel_liquidate.wasm`, `${WASM_DIR}/pel_liquidate.zkey`);
  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_ };
}

export async function verifyProof(proofType: 'OPEN' | 'CLOSE' | 'UPDATE' | 'FUND' | 'LIQUIDATE', proof: unknown, publicSignals: string[]): Promise<boolean> {
  const vkeyFile = `${WASM_DIR}/pel_${proofType.toLowerCase()}_verification_key.json`;
  const vkey = JSON.parse(await import('fs').then((f) => f.readFileSync(vkeyFile, 'utf8')));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
