/**
 * @file tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts
 * @description Authoritative REAL OPEN E2E using the ACTUAL deployed Garaga Groth16
 * OPEN verifier (no mock). Deploys the full protocol on a local devnet, generates a
 * real Circom witness + Groth16 proof, submits real Garaga calldata through
 * PELPerpsCore, waits for acceptance, reads position state, and confirms adversarial
 * proofs revert.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RpcProvider, uint256 } from 'starknet';
import * as garaga from 'garaga';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { generateOwnerSecret, generateNonce } from '../../src/protocol/witnessStore';
import { bn254ToStorageKey } from '../../src/protocol/canonical';
import { deployPerpsDevnet, PerpsDevnetManifest, ECIP_OPS_CLASS_HASH } from '../../scripts/deploy_perps_devnet';

const RPC_URL = process.env.STARKNET_RPC_URL || 'http://127.0.0.1:5050';
const MARKET_FELT = '0x4254432d50455250';

describe('REAL_GROTH16_OPEN_E2E (actual Garaga verifier)', () => {
  let manifest: PerpsDevnetManifest;
  let provider: RpcProvider;
  let commitmentKey: string;
  let nullifierKey: string;
  let realCalldata: bigint[];
  const marginCents = 500000n;
  const oraclePriceCents = 9500000n;
  const entryPriceCents = 9500000n;

  beforeAll(async () => {
    await garaga.init();
    provider = new RpcProvider({ nodeUrl: RPC_URL });
    manifest = await deployPerpsDevnet(RPC_URL);
  }, 600000);

  it('deploys five DISTINCT nonzero verifier addresses', () => {
    const v = [
      manifest.openVerifier,
      manifest.updateVerifier,
      manifest.fundVerifier,
      manifest.closeVerifier,
      manifest.liquidateVerifier,
    ];
    const uniq = new Set(v.map((x) => x.toLowerCase()));
    expect(uniq.size).toBe(5);
    for (const a of v) expect(BigInt(a)).toBeGreaterThan(0n);
  });

  it('declares the ECIP ops class that the verifiers library_call into', () => {
    expect(BigInt(manifest.ecipClassHash)).toBe(BigInt(ECIP_OPS_CLASS_HASH));
  });

  it('generates a REAL Groth16 proof + Garaga calldata locally', async () => {
    const ownerSecret = BigInt(generateOwnerSecret());
    const nonce = BigInt(generateNonce());
    const quantitySats = 100000000n;

    const proof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      nonce,
      ownerSecret,
      oraclePriceCents,
    });

    // proof must carry real Garaga calldata (no mock fallback)
    expect(proof.calldata).toBeDefined();
    expect(proof.calldata!.length).toBeGreaterThan(100);
    realCalldata = proof.calldata!;

    // public signals layout [commitment, marginNullifier, marketId, margin, oraclePrice]
    expect(proof.publicSignals.length).toBe(5);
    expect(BigInt(proof.publicSignals[2])).toBe(BigInt(MARKET_FELT));
    expect(BigInt(proof.publicSignals[3])).toBe(marginCents);
    expect(BigInt(proof.publicSignals[4])).toBe(oraclePriceCents);

    commitmentKey = bn254ToStorageKey(proof.commitment);
    nullifierKey = bn254ToStorageKey(proof.nullifier);
  });

  it('verifies the proof with snarkjs BEFORE touching the chain', async () => {
    // re-run via the real OPEN verifier key is done on-chain; here we assert the
    // proof is locally valid against its own VK (sanity).
    const pk = await import('fs').then((fs) =>
      JSON.parse(fs.readFileSync('circuits/build/pel_open_verification_key.json', 'utf8')),
    );
    // (regenerating a fresh proof inline to have proof object + signals)
    const ownerSecret = BigInt(generateOwnerSecret());
    const nonce = BigInt(generateNonce());
    const proof = await pelCircuitService.generateOpenProof({
      side: 0n, quantitySats: 100000000n, entryPriceCents, marginCents, nonce, ownerSecret, oraclePriceCents,
    });
    const ok = await import('snarkjs').then((s) => s.groth16.verify(pk, proof.publicSignals, proof.proof));
    expect(ok).toBe(true);
  });

  it('submits the real proof on-chain and gets SUCCEEDED', async () => {
    const { Account } = await import('starknet');
    const acc = (await import('../../scripts/deploy_perps_devnet')).resolveDevnetAccounts;
    const accounts = await acc(provider, RPC_URL);
    const openTx = await accounts.trader.execute({
      contractAddress: manifest.pelCore,
      entrypoint: 'open_position',
      calldata: [
        manifest.accounts.trader,
        MARKET_FELT,
        '0x' + marginCents.toString(16),
        ...realCalldata.map((x) => '0x' + BigInt(x).toString(16)),
      ],
    });
    const receipt: any = await provider.waitForTransaction(openTx.transaction_hash);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(receipt.execution_status || receipt.status);
  });

  it('reads the active position from on-chain storage (correct field indices)', async () => {
    const res = await provider.callContract({
      contractAddress: manifest.pelCore,
      entrypoint: 'get_position',
      calldata: [commitmentKey],
    });
    // PositionRecord: [0] commitment [1] margin_nullifier [2] locked_margin
    // [3] market_id [4] created_at [5] updated_at [6] last_funding_timestamp [7] is_active
    expect(res[0]).toBe(commitmentKey);
    expect(res[1]).toBe(nullifierKey);
    expect(BigInt(res[2])).toBe(marginCents);
    expect(res[3]).toBe(MARKET_FELT);
    expect(res[7]).toBe('0x1');
  });

  it('moved exactly the collateral units (margin * 10000) into the LP vault', async () => {
    // Canonical path: the margin is pulled into the PELLiquidityVault (counterparty
    // custody), not the legacy STRK20Adapter.
    const bal = await provider.callContract({
      contractAddress: manifest.collateralToken,
      entrypoint: 'balance_of',
      calldata: [manifest.lpVault],
    });
    const vaultBalance = uint256.uint256ToBN({ low: bal[0], high: bal[1] });
    // The vault holds: LP bootstrap deposit ($10,000,000 = 1,000,000,000 cents) + margin.
    const bootstrapCents = 1_000_000_000n;
    expect(vaultBalance).toBe((bootstrapCents + marginCents) * 10000n);
  });

  it('ADVERSARIAL: replay of the same proof reverts (NULLIFIER_ALREADY_SPENT)', async () => {
    const accounts = await (await import('../../scripts/deploy_perps_devnet')).resolveDevnetAccounts(provider, RPC_URL);
    let reverted = false;
    try {
      const tx = await accounts.trader.execute({
        contractAddress: manifest.pelCore,
        entrypoint: 'open_position',
        calldata: [
          manifest.accounts.trader, MARKET_FELT, '0x' + marginCents.toString(16),
          ...realCalldata.map((x) => '0x' + BigInt(x).toString(16)),
        ],
      });
      await provider.waitForTransaction(tx.transaction_hash);
    } catch {
      reverted = true;
    }
    expect(reverted).toBe(true);
  });

  it('ADVERSARIAL: mutated proof calldata reverts (real verifier rejects)', async () => {
    const accounts = await (await import('../../scripts/deploy_perps_devnet')).resolveDevnetAccounts(provider, RPC_URL);
    // generate a fresh valid proof then corrupt a proof field
    const ownerSecret = BigInt(generateOwnerSecret());
    const nonce = BigInt(generateNonce());
    const proof = await pelCircuitService.generateOpenProof({
      side: 0n, quantitySats: 100000000n, entryPriceCents, marginCents, nonce, ownerSecret, oraclePriceCents,
    });
    const tampered = [...proof.calldata!];
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] + 1n) % (1n << 128n);
    let reverted = false;
    try {
      const tx = await accounts.trader.execute({
        contractAddress: manifest.pelCore,
        entrypoint: 'open_position',
        calldata: [
          manifest.accounts.trader, MARKET_FELT, '0x' + marginCents.toString(16),
          ...tampered.map((x) => '0x' + BigInt(x).toString(16)),
        ],
      });
      await provider.waitForTransaction(tx.transaction_hash);
    } catch {
      reverted = true;
    }
    expect(reverted).toBe(true);
  });
});
