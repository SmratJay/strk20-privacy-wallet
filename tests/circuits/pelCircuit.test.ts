/**
 * @file tests/circuits/pelCircuit.test.ts
 * @description End-to-end zk-SNARK test for the PEL transition circuits (Groth16 / snarkjs).
 *
 * Validates:
 *  - OPEN: commitment + nullifier binding, side ∈ {0,1}, margin > 0, leverage bound.
 *  - CLOSE: PnL/equity/payout correctness + payout-commitment binding.
 *  - Negative cases: wrong commitment, leverage violation → no valid proof.
 *
 * Also proves that the client-side Poseidon (circomlibjs, BN254) matches the
 * circuit Poseidon (circomlib), which is the binding between app and prover.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import { buildPoseidon } from 'circomlibjs';

const BUILD = path.join(process.cwd(), 'circuits', 'build');

const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
const PAYOUT_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_V2').toString('hex'));
const MARKET_ID = BigInt('0x' + Buffer.from('BTC-PERP').toString('hex'));
const QTY_SCALE = 100000000n;

let poseidon: any;

beforeAll(async () => {
  poseidon = await buildPoseidon();
});

function poseidonHash(elems: bigint[]): bigint {
  return BigInt(poseidon.F.toString(poseidon(elems.map((e) => e.toString()))));
}

function commitment(side: bigint, q: bigint, e: bigint, m: bigint, f: bigint, nonce: bigint, secret: bigint): bigint {
  return poseidonHash([DOMAIN_SEP, MARKET_ID, side, q, e, m, f, nonce, secret]);
}
function nullifier(secret: bigint, c: bigint): bigint {
  return poseidonHash([NULLIFIER_TAG, secret, c]);
}
function payoutCommitment(payoutAmount: bigint, payoutNonce: bigint): bigint {
  return poseidonHash([PAYOUT_TAG, payoutAmount, payoutNonce]);
}

describe('PEL zk-SNARK circuits', () => {
  const secret = 987654321012345678901234567890123456789n;
  const nonce = 111222333444555666777888999n;

  it('OPEN: generates and verifies a valid proof', async () => {
    const side = 0n;              // LONG
    const q = 100000000n;         // 1 BTC in sats
    const entry = 10000000n;      // $100,000.00 in cents
    const margin = 200000n;       // $2,000 = 50x
    const c = commitment(side, q, entry, margin, 0n, nonce, secret);
    const n = nullifier(secret, c);

    const input = {
      commitment: c.toString(),
      marginNullifier: n.toString(),
      marketId: MARKET_ID.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      path.join(BUILD, 'pel_open_js', 'pel_open.wasm'),
      path.join(BUILD, 'pel_open.zkey')
    );
    expect(publicSignals[0]).toBe(c.toString());
    expect(publicSignals[1]).toBe(n.toString());
    expect(publicSignals[2]).toBe(MARKET_ID.toString());

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_open_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(ok).toBe(true);
  });

  it('OPEN: rejects a leverage violation (q*e too large for margin)', async () => {
    const side = 0n;
    const q = 100000000n;         // 1 BTC
    const entry = 10000000n;      // $100,000
    const margin = 10000n;        // $100 → 1000x, exceeds 50x
    const c = commitment(side, q, entry, margin, 0n, nonce, secret);
    const n = nullifier(secret, c);

    const input = {
      commitment: c.toString(),
      marginNullifier: n.toString(),
      marketId: MARKET_ID.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
    };

    await expect(
      snarkjs.groth16.fullProve(input, path.join(BUILD, 'pel_open_js', 'pel_open.wasm'), path.join(BUILD, 'pel_open.zkey'))
    ).rejects.toThrow();
  });

  it('OPEN: rejects a commitment that does not match the witness', async () => {
    const side = 0n;
    const q = 100000000n;
    const entry = 10000000n;
    const margin = 200000n;
    const c = commitment(side, q, entry, margin, 0n, nonce, secret);
    const n = nullifier(secret, c);

    const input = {
      commitment: (c + 1n).toString(),   // tampered commitment
      marginNullifier: n.toString(),
      marketId: MARKET_ID.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
    };

    await expect(
      snarkjs.groth16.fullProve(input, path.join(BUILD, 'pel_open_js', 'pel_open.wasm'), path.join(BUILD, 'pel_open.zkey'))
    ).rejects.toThrow();
  });

  it('CLOSE: profitable long settles correct payout', async () => {
    const side = 0n;              // LONG
    const q = 100000000n;         // 1 BTC
    const entry = 10000000n;      // $100,000
    const margin = 200000n;       // $2,000
    const funding = 0n;
    const fees = 0n;
    const oracle = 11000000n;     // $110,000 → +$10,000 on 1 BTC

    const c = commitment(side, q, entry, margin, funding, nonce, secret);
    const n = nullifier(secret, c);

    // PnL math (must match reference riskEngine)
    const delta = oracle - entry;                       // +$10,000
    const diffIsNeg = delta < 0n ? 1n : 0n;
    const diffMag = delta < 0n ? -delta : delta;
    const prod = q * diffMag;
    const pnlMag = prod / QTY_SCALE;
    const pnlRem = prod % QTY_SCALE;
    const pnl = diffIsNeg ? -pnlMag : pnlMag;
    const equity = margin + pnl - funding - fees;
    const equityIsNeg = equity < 0n ? 1n : 0n;
    const equityMag = equity < 0n ? -equity : equity;
    const payout = equityIsNeg ? 0n : equityMag;

    expect(payout).toBe(1200000n); // $2,000 margin + $10,000 PnL = $12,000 = 1,200,000 cents

    const payoutNonce = 424242424242n;
    const pc = payoutCommitment(payout, payoutNonce);

    const input = {
      commitment: c.toString(),
      finalNullifier: n.toString(),
      payoutCommitment: pc.toString(),
      payoutAmount: payout.toString(),
      marketId: MARKET_ID.toString(),
      oraclePrice: oracle.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      funding: funding.toString(),
      fees: fees.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
      payoutNonce: payoutNonce.toString(),
      diffIsNeg: diffIsNeg.toString(),
      diffMag: diffMag.toString(),
      pnlMag: pnlMag.toString(),
      pnlRem: pnlRem.toString(),
      equityIsNeg: equityIsNeg.toString(),
      equityMag: equityMag.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      path.join(BUILD, 'pel_close_js', 'pel_close.wasm'),
      path.join(BUILD, 'pel_close.zkey')
    );

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_close_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(ok).toBe(true);
    expect(publicSignals[3]).toBe(payout.toString());
  });

  it('CLOSE: losing long pays out 0 (payout = max(0, equity))', async () => {
    const side = 0n;
    const q = 100000000n;
    const entry = 10000000n;
    const margin = 200000n;
    const funding = 0n;
    const fees = 0n;
    const oracle = 5000000n;      // $50,000 → -$50,000 PnL on 1 BTC

    const c = commitment(side, q, entry, margin, funding, nonce, secret);
    const n = nullifier(secret, c);

    const delta = oracle - entry;   // negative
    const diffIsNeg = delta < 0n ? 1n : 0n;
    const diffMag = delta < 0n ? -delta : delta;
    const prod = q * diffMag;
    const pnlMag = prod / QTY_SCALE;
    const pnlRem = prod % QTY_SCALE;
    const pnl = diffIsNeg ? -pnlMag : pnlMag;
    const equity = margin + pnl - funding - fees;
    const equityIsNeg = equity < 0n ? 1n : 0n;
    const equityMag = equity < 0n ? -equity : equity;
    const payout = equityIsNeg ? 0n : equityMag;

    expect(equity < 0n).toBe(true);
    expect(payout).toBe(0n);

    const payoutNonce = 777n;
    const pc = payoutCommitment(payout, payoutNonce);

    const input = {
      commitment: c.toString(),
      finalNullifier: n.toString(),
      payoutCommitment: pc.toString(),
      payoutAmount: payout.toString(),
      marketId: MARKET_ID.toString(),
      oraclePrice: oracle.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      funding: funding.toString(),
      fees: fees.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
      payoutNonce: payoutNonce.toString(),
      diffIsNeg: diffIsNeg.toString(),
      diffMag: diffMag.toString(),
      pnlMag: pnlMag.toString(),
      pnlRem: pnlRem.toString(),
      equityIsNeg: equityIsNeg.toString(),
      equityMag: equityMag.toString(),
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      path.join(BUILD, 'pel_close_js', 'pel_close.wasm'),
      path.join(BUILD, 'pel_close.zkey')
    );
    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_close_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    expect(ok).toBe(true);
    expect(publicSignals[3]).toBe('0');
  });

  it('CLOSE: rejects an inflated payout (payoutAmount != max(0, equity))', async () => {
    const side = 0n;
    const q = 100000000n;
    const entry = 10000000n;
    const margin = 200000n;
    const funding = 0n;
    const fees = 0n;
    const oracle = 11000000n;

    const c = commitment(side, q, entry, margin, funding, nonce, secret);
    const n = nullifier(secret, c);

    const delta = oracle - entry;
    const diffIsNeg = 0n;
    const diffMag = delta;
    const prod = q * diffMag;
    const pnlMag = prod / QTY_SCALE;
    const pnlRem = prod % QTY_SCALE;
    const pnl = pnlMag;
    const equity = margin + pnl - funding - fees;
    const equityIsNeg = 0n;
    const equityMag = equity;
    const payout = equityMag + 999999999n;   // inflated

    const payoutNonce = 999n;
    const pc = payoutCommitment(payout, payoutNonce);

    const input = {
      commitment: c.toString(),
      finalNullifier: n.toString(),
      payoutCommitment: pc.toString(),
      payoutAmount: payout.toString(),
      marketId: MARKET_ID.toString(),
      oraclePrice: oracle.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      funding: funding.toString(),
      fees: fees.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
      payoutNonce: payoutNonce.toString(),
      diffIsNeg: diffIsNeg.toString(),
      diffMag: diffMag.toString(),
      pnlMag: pnlMag.toString(),
      pnlRem: pnlRem.toString(),
      equityIsNeg: equityIsNeg.toString(),
      equityMag: equityMag.toString(),
    };

    await expect(
      snarkjs.groth16.fullProve(input, path.join(BUILD, 'pel_close_js', 'pel_close.wasm'), path.join(BUILD, 'pel_close.zkey'))
    ).rejects.toThrow();
  });
});
