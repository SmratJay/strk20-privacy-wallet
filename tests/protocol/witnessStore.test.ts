import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveWitness,
  loadWitness,
  findWitnessByCommitment,
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
  let initialWitness: PrivatePositionState;

  beforeEach(() => {
    const ownerSecret = generateOwnerSecret();
    const nonce = generateNonce();
    initialWitness = {
      protocolVersion: 3,
      marketId: 'BTC-PERP',
      side: 'LONG',
      quantitySats: 100000000n, // 1 BTC
      entryPriceCents: 9500000n, // ,000
      marginCents: 500000n, // ,000
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
    expect(s1.length).toBe(66); // '0x' + 64 hex chars = 32 bytes
  });

  it('saves and retrieves private position witnesses accurately with BigInt preservation', () => {
    saveWitness(testWallet, initialWitness);
    const loaded = loadWitness(testWallet, initialWitness.commitment);
    expect(loaded).not.toBeNull();
    expect(loaded?.commitment).toBe(initialWitness.commitment);
    expect(loaded?.quantitySats).toBe(100000000n);
    expect(loaded?.ownerSecret).toBe(initialWitness.ownerSecret);
  });

  it('strictly preserves ownerSecret immutability across state transitions (UPDATE/FUND)', () => {
    saveWitness(testWallet, initialWitness);

    const rotatedWitness: PrivatePositionState = {
      ...initialWitness,
      commitment: '0x3333333333333333333333333333333333333333333333333333333333333333',
      nonce: generateNonce(),
    };

    // Updating with same ownerSecret succeeds
    expect(() => updateWitness(testWallet, initialWitness.commitment, rotatedWitness)).not.toThrow();

    // Attempting to mutate ownerSecret throws invariant error
    const illegalWitness: PrivatePositionState = {
      ...rotatedWitness,
      ownerSecret: generateOwnerSecret(), // Different secret!
    };
    expect(() => updateWitness(testWallet, rotatedWitness.commitment, illegalWitness)).toThrow(
      'OWNER_SECRET_MUTATION_FORBIDDEN'
    );
  });

  it('finds witnesses across namespaces and isolates by commitment key', () => {
    saveWitness(testWallet, initialWitness);
    const found = findWitnessByCommitment(initialWitness.commitment);
    expect(found).not.toBeNull();
    expect(found?.commitment).toBe(initialWitness.commitment);

    const notFound = findWitnessByCommitment('0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(notFound).toBeNull();
  });

  it('supports encrypted export and import recovery for position continuation', async () => {
    saveWitness(testWallet, initialWitness);
    const signature = '0xmock_starknet_account_signature_for_witness_recovery_key';

    const encryptedExport = await exportWitnesses(testWallet, signature);
    expect(encryptedExport).toContain('"encrypted":true');

    // Simulate clearing local storage (e.g. user on fresh device / browser)
    deleteWitness(testWallet, initialWitness.commitment);
    expect(loadWitness(testWallet, initialWitness.commitment)).toBeNull();

    // Import with valid signature restores the witness
    const importRes = await importWitnesses(testWallet, encryptedExport, signature);
    expect(importRes.imported).toBe(1);

    const recovered = loadWitness(testWallet, initialWitness.commitment);
    expect(recovered?.commitment).toBe(initialWitness.commitment);
    expect(recovered?.ownerSecret).toBe(initialWitness.ownerSecret);
  });

  it('fails closed when attempting to import encrypted export with missing signature', async () => {
    saveWitness(testWallet, initialWitness);
    const signature = '0xmock_starknet_account_signature_for_witness_recovery_key';
    const encryptedExport = await exportWitnesses(testWallet, signature);

    await expect(importWitnesses(testWallet, encryptedExport)).rejects.toThrow(
      'WITNESS_STORE: encrypted export requires signature'
    );
  });
});
