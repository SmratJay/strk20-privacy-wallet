import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveWitness,
  loadWitness,
  updateWitness,
  deleteWitness,
  listWitnesses,
  exportWitnesses,
  importWitnesses,
  generateOwnerSecret,
  generateNonce,
  WitnessCorruptionError,
} from '../../src/protocol/witnessStore';
import { PrivatePositionState } from '../../src/protocol/types';

describe('Private Witness Security & Persistence (Audit Section 10 & 11)', () => {
  const testWallet = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const testSig = '0xmock_starknet_account_signature_for_witness_recovery_key';
  let initialWitness: PrivatePositionState;

  beforeEach(() => {
    const ownerSecret = generateOwnerSecret();
    const nonce = generateNonce();
    initialWitness = {
      protocolVersion: 3,
      marketId: 'BTC-PERP',
      side: 'LONG',
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      fundingCents: 0n,
      feesCents: 0n,
      nonce,
      ownerSecret,
      commitment: '0x1111111111111111111111111111111111111111111111111111111111111111',
      nullifier: '0x2222222222222222222222222222222222222222222222222222222222222222',
      openedAtMs: Date.now(),
    };
  });

  it('generates true 256-bit CSPRNG secrets and nonces that are distinct and non-deterministic', () => {
    const s1 = generateOwnerSecret();
    const s2 = generateOwnerSecret();
    const n1 = generateNonce();
    expect(s1).not.toBe(s2);
    expect(s1).not.toBe(n1);
    expect(s1.startsWith('0x')).toBe(true);
    expect(s1.length).toBe(66);
  });

  it('saves and retrieves private position witnesses accurately with BigInt preservation', async () => {
    await saveWitness(testWallet, initialWitness, testSig);
    const loaded = await loadWitness(testWallet, initialWitness.commitment, testSig);
    expect(loaded).not.toBeNull();
    expect(loaded?.commitment).toBe(initialWitness.commitment);
    expect(loaded?.quantitySats).toBe(100000000n);
    expect(loaded?.ownerSecret).toBe(initialWitness.ownerSecret);
  });

  it('strictly preserves ownerSecret immutability across state transitions (UPDATE/FUND)', async () => {
    await saveWitness(testWallet, initialWitness, testSig);

    const rotatedWitness: PrivatePositionState = {
      ...initialWitness,
      commitment: '0x3333333333333333333333333333333333333333333333333333333333333333',
      nonce: generateNonce(),
    };

    await expect(updateWitness(testWallet, initialWitness.commitment, rotatedWitness, testSig)).resolves.not.toThrow();

    const illegalWitness: PrivatePositionState = {
      ...rotatedWitness,
      ownerSecret: generateOwnerSecret(),
    };
    await expect(updateWitness(testWallet, rotatedWitness.commitment, illegalWitness, testSig)).rejects.toThrow(
      'OWNER_SECRET_MUTATION_FORBIDDEN'
    );
  });

  it('finds and lists witnesses with isolation by commitment key', async () => {
    await saveWitness(testWallet, initialWitness, testSig);
    const list = await listWitnesses(testWallet, testSig);
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((w) => w.commitment.toLowerCase() === initialWitness.commitment.toLowerCase());
    expect(found).toBeDefined();
    expect(found?.commitment).toBe(initialWitness.commitment);
  });

  it('supports encrypted export and import recovery for position continuation', async () => {
    await saveWitness(testWallet, initialWitness, testSig);

    const encryptedExport = await exportWitnesses(testWallet, testSig);
    expect(encryptedExport).toContain('"encrypted":true');

    await deleteWitness(testWallet, initialWitness.commitment, testSig);
    expect(await loadWitness(testWallet, initialWitness.commitment, testSig)).toBeNull();

    const importRes = await importWitnesses(testWallet, encryptedExport, testSig);
    expect(importRes.imported).toBe(1);

    const recovered = await loadWitness(testWallet, initialWitness.commitment, testSig);
    expect(recovered?.commitment).toBe(initialWitness.commitment);
    expect(recovered?.ownerSecret).toBe(initialWitness.ownerSecret);
  });

  it('fails closed when attempting to import encrypted export with missing signature', async () => {
    await saveWitness(testWallet, initialWitness, testSig);
    const encryptedExport = await exportWitnesses(testWallet, testSig);

    await expect(importWitnesses(testWallet, encryptedExport, '')).rejects.toThrow();
  });
});
