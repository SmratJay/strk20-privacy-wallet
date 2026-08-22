/**
 * @file src/services/pelCircuitService.ts
 * @description Canonical client bridge to the PEL zk-SNARK circuits (Groth16, BN254) and Garaga calldata builder.
 *
 * Single source of truth for PEL transition proofs across:
 * - circuits/pel_open.circom
 * - circuits/pel_close.circom
 * - circuits/pel_update.circom
 * - circuits/pel_fund.circom
 * - circuits/pel_liquidate.circom
 */

import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import * as fs from 'fs';
import * as path from 'path';

export const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
export const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
export const MARGIN_NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_MARGIN_NULLIFIER_V2').toString('hex'));
export const PAYOUT_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_V2').toString('hex'));
export const PAYOUT_NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_NULLIFIER_V2').toString('hex'));
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

let garagaModule: any = null;
let garagaPromise: Promise<any> | null = null;

async function getGaraga() {
  if (garagaModule) return garagaModule;
  if (!garagaPromise) {
    garagaPromise = (async () => {
      const g = await import('garaga');
      await g.init();
      garagaModule = g;
      return g;
    })();
  }
  return garagaPromise;
}

export interface OpenWitness {
  side: 0n | 1n; // 0 = LONG, 1 = SHORT
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  nonce: bigint;
  ownerSecret: bigint;
  oraclePriceCents?: bigint; // must match the on-chain canonical oracle at execution (defaults to entryPriceCents)
}

export interface CloseWitness {
  side: 0n | 1n;
  quantitySats: bigint;
  entryPriceCents: bigint;
  marginCents: bigint;
  fundingCents: bigint;
  feesCents?: bigint; // DEPRECATED: ignored — the close fee is derived from the canonical taker fee
  nonce: bigint;
  ownerSecret: bigint;
  payoutNonce: bigint;
  oraclePriceCents: bigint;
  recipient: bigint;
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

export interface ProvenTransition {
  proof: unknown;
  publicSignals: string[];
  commitment: bigint;
  nullifier: bigint;
  calldata?: bigint[];
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

export async function computeMarginNullifier(ownerSecret: bigint, commitment: bigint): Promise<bigint> {
  return poseidonHash([MARGIN_NULLIFIER_TAG, ownerSecret, commitment]);
}

export async function computePayoutCommitment(payoutAmount: bigint, payoutNonce: bigint): Promise<bigint> {
  return poseidonHash([PAYOUT_TAG, payoutAmount, payoutNonce]);
}

/** Deterministic payout nullifier used for vault note replay protection. */
export async function computePayoutNullifier(payoutAmount: bigint, payoutNonce: bigint): Promise<bigint> {
  return poseidonHash([PAYOUT_NULLIFIER_TAG, payoutAmount, payoutNonce]);
}

export function decomposeSigned(value: bigint): [bigint, bigint] {
  if (value < 0n) return [1n, -value];
  return [0n, value];
}

export function computeCloseSettlement(
  side: 0n | 1n,
  quantitySats: bigint,
  entryPriceCents: bigint,
  marginCents: bigint,
  fundingCents: bigint,
  oraclePriceCents: bigint,
): {
  diffIsNeg: bigint; diffMag: bigint; pnlMag: bigint; pnlRem: bigint;
  equityIsNeg: bigint; equityMag: bigint; payout: bigint;
  notional: bigint; notionalRem: bigint; fees: bigint; feeRem: bigint;
} {
  const delta = side === 0n ? oraclePriceCents - entryPriceCents : entryPriceCents - oraclePriceCents;
  const [diffIsNeg, diffMag] = decomposeSigned(delta);
  const prod = quantitySats * diffMag;
  const pnlMag = prod / QTY_SCALE;
  const pnlRem = prod % QTY_SCALE;
  const pnl = diffIsNeg ? -pnlMag : pnlMag;

  // Canonical taker fee (7 bps on close notional) — NOT a free input.
  const notionalProd = quantitySats * oraclePriceCents;
  const notional = notionalProd / QTY_SCALE;
  const notionalRem = notionalProd % QTY_SCALE;
  const feeProd = notional * 7n;
  const fees = feeProd / 10000n;
  const feeRem = feeProd % 10000n;

  const equity = marginCents + pnl - fundingCents - fees;
  const [equityIsNeg, equityMag] = decomposeSigned(equity);
  const payout = equityIsNeg ? 0n : equityMag;
  return { diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag, payout, notional, notionalRem, fees, feeRem };
}

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
  seizedCollateral: bigint; badDebt: bigint;
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
  const seizedCollateral = equityIsNeg === 1n ? 0n : equityMag;
  const badDebt = equityIsNeg === 1n ? equityMag : 0n;
  return { diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag, notional, notionalRem, maint, maintRem, equity, isLiquidatable, seizedCollateral, badDebt };
}

const WASM_DIR = path.join(process.cwd(), 'circuits', 'build');

export async function generateGaragaCalldata(
  proofType: 'OPEN' | 'CLOSE' | 'UPDATE' | 'FUND' | 'LIQUIDATE',
  proof: any,
  publicSignals: string[],
): Promise<bigint[]> {
  // No mock fallback. A real Groth16 proof must produce real Garaga calldata.
  // If this fails, the caller must fail loudly rather than submit a non-verifying proof.
  const g = await getGaraga();
  const vkeyFile = path.join(WASM_DIR, `pel_${proofType.toLowerCase()}_verification_key.json`);
  const vkeyJson = JSON.parse(fs.readFileSync(vkeyFile, 'utf8'));
  const vk = g.parseGroth16VerifyingKeyFromObject(vkeyJson);
  const parsedProof = g.parseGroth16ProofFromObject(proof, publicSignals.map((s) => BigInt(s)));
  const calldata: bigint[] = g.getGroth16CallData(parsedProof, vk, g.CurveId.BN254);
  return calldata;
}

export async function generateOpenProof(w: OpenWitness): Promise<ProvenTransition> {
  const commitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, 0n, w.nonce, w.ownerSecret);
  const nullifier_ = await computeMarginNullifier(w.ownerSecret, commitment);

  const oraclePrice = w.oraclePriceCents !== undefined ? BigInt(w.oraclePriceCents) : w.entryPriceCents;
  const [diffIsNeg, diffMag] = decomposeSigned(w.entryPriceCents - oraclePrice);

  const input = {
    commitment: commitment.toString(),
    marginNullifier: nullifier_.toString(),
    marketId: MARKET_ID.toString(),
    margin: w.marginCents.toString(),
    oraclePrice: oraclePrice.toString(),
    side: w.side.toString(),
    quantity: w.quantitySats.toString(),
    entryPrice: w.entryPriceCents.toString(),
    nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(),
    diffIsNeg: diffIsNeg.toString(),
    diffMag: diffMag.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(WASM_DIR, 'pel_open_js', 'pel_open.wasm'),
    path.join(WASM_DIR, 'pel_open.zkey')
  );

  const calldata = await generateGaragaCalldata('OPEN', proof, publicSignals);
  return { proof, publicSignals, commitment, nullifier: nullifier_, calldata };
}

export async function generateCloseProof(w: CloseWitness): Promise<ProvenTransition & { payout: bigint; payoutCommitment: bigint; payoutNullifier: bigint }> {
  const commitment = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment);
  const s = computeCloseSettlement(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.oraclePriceCents);
  const payoutCommitment = await computePayoutCommitment(s.payout, w.payoutNonce);
  const payoutNullifier = await computePayoutNullifier(s.payout, w.payoutNonce);

  const input = {
    commitment: commitment.toString(),
    finalNullifier: nullifier_.toString(),
    payoutCommitment: payoutCommitment.toString(),
    payoutAmount: s.payout.toString(),
    marketId: MARKET_ID.toString(),
    oraclePrice: w.oraclePriceCents.toString(),
    recipient: (w.recipient ?? 0n).toString(),
    side: w.side.toString(),
    quantity: w.quantitySats.toString(),
    entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(),
    funding: w.fundingCents.toString(),
    fees: s.fees.toString(),
    nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(),
    payoutNonce: w.payoutNonce.toString(),
    diffIsNeg: s.diffIsNeg.toString(),
    diffMag: s.diffMag.toString(),
    pnlMag: s.pnlMag.toString(),
    pnlRem: s.pnlRem.toString(),
    equityIsNeg: s.equityIsNeg.toString(),
    equityMag: s.equityMag.toString(),
    notional: s.notional.toString(),
    notionalRem: s.notionalRem.toString(),
    feeRem: s.feeRem.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(WASM_DIR, 'pel_close_js', 'pel_close.wasm'),
    path.join(WASM_DIR, 'pel_close.zkey')
  );

  const calldata = await generateGaragaCalldata('CLOSE', proof, publicSignals);
  return { proof, publicSignals, commitment, nullifier: nullifier_, payout: s.payout, payoutCommitment, payoutNullifier, calldata };
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

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(WASM_DIR, 'pel_update_js', 'pel_update.wasm'),
    path.join(WASM_DIR, 'pel_update.zkey')
  );

  const calldata = await generateGaragaCalldata('UPDATE', proof, publicSignals);
  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_, newCommitment, calldata };
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
    fundingPayment: s.fundingPayment.toString(), isLongPays: s.isLongPays.toString(),
    side: w.side.toString(), quantity: w.quantitySats.toString(), entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(), funding: w.fundingCents.toString(), nonce: w.nonce.toString(),
    ownerSecret: w.ownerSecret.toString(), newNonce: w.newNonce.toString(),
    rateIsNeg: s.rateIsNeg.toString(), rateAbs: s.rateAbs.toString(),
    notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
    rawFunding: s.rawFunding.toString(), rawFundingRem: s.rawFundingRem.toString(),
    newMarginIsNeg: '0', newMarginMag: s.newMargin.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(WASM_DIR, 'pel_fund_js', 'pel_fund.wasm'),
    path.join(WASM_DIR, 'pel_fund.zkey')
  );

  const calldata = await generateGaragaCalldata('FUND', proof, publicSignals);
  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_, newCommitment, fundingPayment: s.fundingPayment, newMargin: s.newMargin, newFunding: s.newFunding, calldata };
}

export async function generateLiquidateProof(w: LiquidateWitness): Promise<ProvenTransition & { seizedCollateral: bigint; badDebt: bigint }> {
  const commitment_ = await computePositionCommitment(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.nonce, w.ownerSecret);
  const nullifier_ = await computeNullifier(w.ownerSecret, commitment_);
  const s = computeLiquidationSettlement(w.side, w.quantitySats, w.entryPriceCents, w.marginCents, w.fundingCents, w.feesCents, w.markPriceCents);

  const input = {
    positionCommitment: commitment_.toString(), positionNullifier: nullifier_.toString(),
    marketId: MARKET_ID.toString(), oraclePrice: w.markPriceCents.toString(), keeper: w.keeper.toString(),
    seizedCollateral: s.seizedCollateral.toString(), badDebt: s.badDebt.toString(),
    side: w.side.toString(), quantity: w.quantitySats.toString(), entryPrice: w.entryPriceCents.toString(),
    margin: w.marginCents.toString(), funding: w.fundingCents.toString(), fees: w.feesCents.toString(),
    nonce: w.nonce.toString(), ownerSecret: w.ownerSecret.toString(),
    diffIsNeg: s.diffIsNeg.toString(), diffMag: s.diffMag.toString(),
    pnlMag: s.pnlMag.toString(), pnlRem: s.pnlRem.toString(),
    notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
    maint: s.maint.toString(), maintRem: s.maintRem.toString(),
    equityIsNeg: s.equityIsNeg.toString(), equityMag: s.equityMag.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(WASM_DIR, 'pel_liquidate_js', 'pel_liquidate.wasm'),
    path.join(WASM_DIR, 'pel_liquidate.zkey')
  );

  const calldata = await generateGaragaCalldata('LIQUIDATE', proof, publicSignals);

  return { proof, publicSignals, commitment: commitment_, nullifier: nullifier_, seizedCollateral: s.seizedCollateral, badDebt: s.badDebt, calldata };
}

export async function verifyProof(proofType: 'OPEN' | 'CLOSE' | 'UPDATE' | 'FUND' | 'LIQUIDATE', proof: unknown, publicSignals: string[]): Promise<boolean> {
  const vkeyFile = path.join(WASM_DIR, `pel_${proofType.toLowerCase()}_verification_key.json`);
  const vkey = JSON.parse(fs.readFileSync(vkeyFile, 'utf8'));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

export const pelCircuitService = {
  computePositionCommitment,
  computeNullifier,
  computePayoutCommitment,
  computePayoutNullifier,
  decomposeSigned,
  computeCloseSettlement,
  computeFundingSettlement,
  computeLiquidationSettlement,
  generateOpenProof,
  generateCloseProof,
  generateUpdateProof,
  generateFundProof,
  generateLiquidateProof,
  generateGaragaCalldata,
  verifyProof,
};
