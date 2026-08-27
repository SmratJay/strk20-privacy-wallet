/**
 * @file tests/circuits/pelTransitions.test.ts
 * @description zk-SNARK tests for PEL UPDATE / FUND / LIQUIDATE circuits (Groth16).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import { buildPoseidon } from 'circomlibjs';

const BUILD = path.join(process.cwd(), 'circuits', 'build');

const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
const MARKET_ID = BigInt('0x' + Buffer.from('BTC-PERP').toString('hex'));
const QTY_SCALE = 100000000n;
const BPS_SCALE = 10000n;

let poseidon: any;

beforeAll(async () => {
  poseidon = await buildPoseidon();
});

function ph(elems: bigint[]): bigint {
  return BigInt(poseidon.F.toString(poseidon(elems.map((e) => e.toString()))));
}
function commitment(side: bigint, q: bigint, e: bigint, m: bigint, f: bigint, nonce: bigint, secret: bigint): bigint {
  return ph([DOMAIN_SEP, MARKET_ID, side, q, e, m, f, nonce, secret]);
}
function nullifier(secret: bigint, c: bigint): bigint {
  return ph([NULLIFIER_TAG, secret, c]);
}

const secret = 987654321012345678901234567890123456789n;
const nonce = 111222333444555666777888999n;
const newNonce = 999888777666555444333222111n;

function prove(name: string, input: Record<string, string>) {
  return snarkjs.groth16.fullProve(
    input,
    path.join(BUILD, `${name}_js`, `${name}.wasm`),
    path.join(BUILD, `${name}.zkey`)
  );
}
function vkey(name: string) {
  return JSON.parse(fs.readFileSync(path.join(BUILD, `${name}_verification_key.json`), 'utf8'));
}

describe('PEL UPDATE circuit', () => {
  it('rotates commitment to a fresh nonce (valid proof)', async () => {
    const side = 0n, q = 100000000n, e = 10000000n, m = 200000n, f = 0n;
    const oldC = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, oldC);
    const newC = commitment(side, q, e, m, f, newNonce, secret);

    const input = {
      oldCommitment: oldC.toString(),
      newCommitment: newC.toString(),
      oldNullifier: n.toString(),
      marketId: MARKET_ID.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), nonce: nonce.toString(),
      newNonce: newNonce.toString(), ownerSecret: secret.toString(),
    };

    const { proof, publicSignals } = await prove('pel_update', input);
    expect(publicSignals[0]).toBe(oldC.toString());
    expect(publicSignals[1]).toBe(newC.toString());
    expect(await snarkjs.groth16.verify(vkey('pel_update'), publicSignals, proof)).toBe(true);
  });

  it('rejects if the new commitment does not match the state', async () => {
    const side = 0n, q = 100000000n, e = 10000000n, m = 200000n, f = 0n;
    const oldC = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, oldC);
    const badNewC = commitment(side, q, e, m + 1n, f, newNonce, secret); // tampered margin

    const input = {
      oldCommitment: oldC.toString(), newCommitment: badNewC.toString(), oldNullifier: n.toString(),
      marketId: MARKET_ID.toString(), side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), nonce: nonce.toString(),
      newNonce: newNonce.toString(), ownerSecret: secret.toString(),
    };
    await expect(prove('pel_update', input)).rejects.toThrow();
  });
});

describe('PEL FUND circuit', () => {
  const side = 0n, q = 100000000n, e = 10000000n, m = 200000n, f = 0n;
  const mark = 10500000n; // $105,000

  function fundWitness(rate: bigint, intervals: bigint) {
    const rateIsNeg = rate < 0n ? 1n : 0n;
    const rateAbs = rate < 0n ? -rate : rate;
    const notional = (q * mark) / QTY_SCALE;
    const notionalRem = (q * mark) % QTY_SCALE;
    const rawFunding = (notional * rateAbs) / BPS_SCALE;
    const rawFundingRem = (notional * rateAbs) % BPS_SCALE;
    const fundingPayment = rawFunding * intervals;
    const isLongPays = 1n - rateIsNeg;
    const newMargin = isLongPays ? m - fundingPayment : m + fundingPayment;
    const newFunding = f + fundingPayment;
    const newC = commitment(side, q, e, newMargin, newFunding, newNonce, secret);
    return {
      rateIsNeg, rateAbs, notional, notionalRem, rawFunding, rawFundingRem,
      fundingPayment, newMargin, newFunding, newC, isLongPays,
    };
  }

  it('long pays: positive rate deducts margin and updates commitment', async () => {
    const w = fundWitness(120n, 1n); // longs pay
    expect(w.isLongPays).toBe(1n);
    expect(w.newMargin).toBe(200000n - 126000n); // $740

    const oldC = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, oldC);

    const input = {
      oldCommitment: oldC.toString(), newCommitment: w.newC.toString(), oldNullifier: n.toString(),
      marketId: MARKET_ID.toString(), oraclePrice: mark.toString(),
      fundingRateBpsHr: 120n.toString(), intervalsElapsed: 1n.toString(),
      fundingPayment: w.fundingPayment.toString(), isLongPays: w.isLongPays.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), nonce: nonce.toString(),
      ownerSecret: secret.toString(), newNonce: newNonce.toString(),
      rateIsNeg: w.rateIsNeg.toString(), rateAbs: w.rateAbs.toString(),
      notional: w.notional.toString(), notionalRem: w.notionalRem.toString(),
      rawFunding: w.rawFunding.toString(), rawFundingRem: w.rawFundingRem.toString(),
      newMarginIsNeg: '0', newMarginMag: w.newMargin.toString(),
    };

    const { proof, publicSignals } = await prove('pel_fund', input);
    expect(await snarkjs.groth16.verify(vkey('pel_fund'), publicSignals, proof)).toBe(true);
  });

  it('short pays: negative rate credits margin', async () => {
    const w = fundWitness(-120n, 1n); // shorts pay -> long receives
    expect(w.isLongPays).toBe(0n);
    expect(w.newMargin).toBe(200000n + 126000n);

    const oldC = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, oldC);

    const input = {
      oldCommitment: oldC.toString(), newCommitment: w.newC.toString(), oldNullifier: n.toString(),
      marketId: MARKET_ID.toString(), oraclePrice: mark.toString(),
      fundingRateBpsHr: (-120n).toString(), intervalsElapsed: 1n.toString(),
      fundingPayment: w.fundingPayment.toString(), isLongPays: w.isLongPays.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), nonce: nonce.toString(),
      ownerSecret: secret.toString(), newNonce: newNonce.toString(),
      rateIsNeg: w.rateIsNeg.toString(), rateAbs: w.rateAbs.toString(),
      notional: w.notional.toString(), notionalRem: w.notionalRem.toString(),
      rawFunding: w.rawFunding.toString(), rawFundingRem: w.rawFundingRem.toString(),
      newMarginIsNeg: '0', newMarginMag: w.newMargin.toString(),
    };

    const { proof, publicSignals } = await prove('pel_fund', input);
    expect(await snarkjs.groth16.verify(vkey('pel_fund'), publicSignals, proof)).toBe(true);
  });

  it('rejects funding that would make margin negative', async () => {
    const w = fundWitness(120n, 1n);
    const oldC = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, oldC);

    const input = {
      oldCommitment: oldC.toString(), newCommitment: w.newC.toString(), oldNullifier: n.toString(),
      marketId: MARKET_ID.toString(), oraclePrice: mark.toString(),
      fundingRateBpsHr: 120n.toString(), intervalsElapsed: 1n.toString(),
      fundingPayment: w.fundingPayment.toString(), isLongPays: w.isLongPays.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), nonce: nonce.toString(),
      ownerSecret: secret.toString(), newNonce: newNonce.toString(),
      rateIsNeg: w.rateIsNeg.toString(), rateAbs: w.rateAbs.toString(),
      notional: w.notional.toString(), notionalRem: w.notionalRem.toString(),
      rawFunding: w.rawFunding.toString(), rawFundingRem: w.rawFundingRem.toString(),
      // lie: claim the resulting margin is negative
      newMarginIsNeg: '1', newMarginMag: w.newMargin.toString(),
    };

    await expect(prove('pel_fund', input)).rejects.toThrow();
  });
});

describe('PEL LIQUIDATE circuit', () => {
  function settle(side: bigint, q: bigint, e: bigint, m: bigint, f: bigint, fees: bigint, oracle: bigint) {
    const delta = side === 0n ? oracle - e : e - oracle;
    const diffIsNeg = delta < 0n ? 1n : 0n;
    const diffMag = delta < 0n ? -delta : delta;
    const prod = q * diffMag;
    const pnlMag = prod / QTY_SCALE;
    const pnlRem = prod % QTY_SCALE;
    const pnl = diffIsNeg ? -pnlMag : pnlMag;
    const equity = m + pnl - f - fees;
    const equityIsNeg = equity < 0n ? 1n : 0n;
    const equityMag = equity < 0n ? -equity : equity;
    const notional = (q * oracle) / QTY_SCALE;
    const notionalRem = (q * oracle) % QTY_SCALE;
    const maint = (notional * 200n) / BPS_SCALE;
    const maintRem = (notional * 200n) % BPS_SCALE;
    return { diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag, notional, notionalRem, maint, maintRem, equity };
  }

  it('liquidates an underwater long (equity <= maint)', async () => {
    const side = 0n, q = 100000000n, e = 10000000n, m = 200000n, f = 0n, fees = 0n;
    const oracle = 5000000n; // $50,000 -> deep loss
    const s = settle(side, q, e, m, f, fees, oracle);
    expect(s.equity < 0n).toBe(true);

    const c = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, c);
    const keeper = 12345n;
    const seizedCollateral = s.equityIsNeg === 1n ? 0n : s.equityMag;
    const badDebt = s.equityIsNeg === 1n ? s.equityMag : 0n;

    const input = {
      positionCommitment: c.toString(), positionNullifier: n.toString(),
      marketId: MARKET_ID.toString(), oraclePrice: oracle.toString(), keeper: keeper.toString(),
      seizedCollateral: seizedCollateral.toString(), badDebt: badDebt.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), fees: fees.toString(),
      nonce: nonce.toString(), ownerSecret: secret.toString(),
      diffIsNeg: s.diffIsNeg.toString(), diffMag: s.diffMag.toString(),
      pnlMag: s.pnlMag.toString(), pnlRem: s.pnlRem.toString(),
      notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
      maint: s.maint.toString(), maintRem: s.maintRem.toString(),
      equityIsNeg: s.equityIsNeg.toString(), equityMag: s.equityMag.toString(),
    };

    const { proof, publicSignals } = await prove('pel_liquidate', input);
    expect(publicSignals.length).toBe(7);
    expect(await snarkjs.groth16.verify(vkey('pel_liquidate'), publicSignals, proof)).toBe(true);
  });

  it('rejects a healthy position (equity > maint)', async () => {
    const side = 0n, q = 100000000n, e = 10000000n, m = 200000n, f = 0n, fees = 0n;
    const oracle = 10500000n; // profitable
    const s = settle(side, q, e, m, f, fees, oracle);
    expect(s.equity > s.maint).toBe(true);

    const c = commitment(side, q, e, m, f, nonce, secret);
    const n = nullifier(secret, c);
    const keeper = 12345n;
    const seizedCollateral = s.equityIsNeg === 1n ? 0n : s.equityMag;
    const badDebt = s.equityIsNeg === 1n ? s.equityMag : 0n;

    const input = {
      positionCommitment: c.toString(), positionNullifier: n.toString(),
      marketId: MARKET_ID.toString(), oraclePrice: oracle.toString(), keeper: keeper.toString(),
      seizedCollateral: seizedCollateral.toString(), badDebt: badDebt.toString(),
      side: side.toString(), quantity: q.toString(), entryPrice: e.toString(),
      margin: m.toString(), funding: f.toString(), fees: fees.toString(),
      nonce: nonce.toString(), ownerSecret: secret.toString(),
      diffIsNeg: s.diffIsNeg.toString(), diffMag: s.diffMag.toString(),
      pnlMag: s.pnlMag.toString(), pnlRem: s.pnlRem.toString(),
      notional: s.notional.toString(), notionalRem: s.notionalRem.toString(),
      maint: s.maint.toString(), maintRem: s.maintRem.toString(),
      equityIsNeg: s.equityIsNeg.toString(), equityMag: s.equityMag.toString(),
    };

    await expect(prove('pel_liquidate', input)).rejects.toThrow();
  });
});
