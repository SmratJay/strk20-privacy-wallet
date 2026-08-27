/**
 * @file tests/circuits/pelCircuit.test.ts
 * @description End-to-end zk-SNARK test for the PEL transition circuits (Groth16 / snarkjs).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import { buildPoseidon } from 'circomlibjs';
import { pelCircuitService } from '../../src/services/pelCircuitService';

const BUILD = path.join(process.cwd(), 'circuits', 'build');

const DOMAIN_SEP = BigInt('0x' + Buffer.from('PEL_POSITION_V2').toString('hex'));
const NULLIFIER_TAG = BigInt('0x' + Buffer.from('PEL_NULLIFIER_V2').toString('hex'));
const PAYOUT_TAG = BigInt('0x' + Buffer.from('PEL_PAYOUT_V2').toString('hex'));
const MARKET_ID = BigInt('0x' + Buffer.from('BTC-PERP').toString('hex'));

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

describe('PEL zk-SNARK circuits', () => {
  const secret = 987654321012345678901234567890123456789n;
  const nonce = 111222333444555666777888999n;

  it('OPEN: generates and verifies a valid proof via pelCircuitService', async () => {
    const res = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 10000000n,
      marginCents: 200000n,
      nonce,
      ownerSecret: secret,
      oraclePriceCents: 10000000n,
    });

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_open_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, res.publicSignals, res.proof);
    expect(ok).toBe(true);
    expect(res.publicSignals.length).toBe(5);
  });

  it('OPEN: rejects a leverage violation (q*e too large for margin)', async () => {
    const side = 0n;
    const q = 100000000n;         // 1 BTC
    const entry = 10000000n;      // ,000
    const margin = 10000n;        //  -> 1000x, exceeds 50x
    const c = commitment(side, q, entry, margin, 0n, nonce, secret);
    const n = nullifier(secret, c);

    const input = {
      commitment: c.toString(),
      marginNullifier: n.toString(),
      marketId: MARKET_ID.toString(),
      oraclePrice: entry.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
      diffIsNeg: '0',
      diffMag: '0',
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
      oraclePrice: entry.toString(),
      side: side.toString(),
      quantity: q.toString(),
      entryPrice: entry.toString(),
      margin: margin.toString(),
      nonce: nonce.toString(),
      ownerSecret: secret.toString(),
      diffIsNeg: '0',
      diffMag: '0',
    };

    await expect(
      snarkjs.groth16.fullProve(input, path.join(BUILD, 'pel_open_js', 'pel_open.wasm'), path.join(BUILD, 'pel_open.zkey'))
    ).rejects.toThrow();
  });

  it('CLOSE: profitable long settles correct payout via pelCircuitService', async () => {
    const res = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 10000000n,
      marginCents: 200000n,
      fundingCents: 0n,
      nonce,
      ownerSecret: secret,
      payoutNonce: 424242424242n,
      oraclePriceCents: 11000000n,
      recipient: 12345n,
    });

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_close_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, res.publicSignals, res.proof);
    expect(ok).toBe(true);
    expect(res.payout).toBeGreaterThan(0n);
  });

  it('CLOSE: losing long pays out 0 (payout = max(0, equity))', async () => {
    const res = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 10000000n,
      marginCents: 200000n,
      fundingCents: 0n,
      nonce,
      ownerSecret: secret,
      payoutNonce: 777n,
      oraclePriceCents: 5000000n,
      recipient: 12345n,
    });

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_close_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, res.publicSignals, res.proof);
    expect(ok).toBe(true);
    expect(res.payout).toBe(0n);
    expect(res.publicSignals[3]).toBe('0');
  });

  it('CLOSE: rejects an invalid proof when public signal is tampered', async () => {
    const res = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 10000000n,
      marginCents: 200000n,
      fundingCents: 0n,
      nonce,
      ownerSecret: secret,
      payoutNonce: 424242424242n,
      oraclePriceCents: 11000000n,
      recipient: 12345n,
    });

    const tamperedSignals = [...res.publicSignals];
    tamperedSignals[3] = (BigInt(tamperedSignals[3]) + 100000n).toString(); // Lie: inflate payout

    const vkey = JSON.parse(fs.readFileSync(path.join(BUILD, 'pel_close_verification_key.json'), 'utf8'));
    const ok = await snarkjs.groth16.verify(vkey, tamperedSignals, res.proof);
    expect(ok).toBe(false);
  });
});
