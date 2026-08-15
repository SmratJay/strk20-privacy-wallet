import { describe, it, expect } from 'vitest';
import { strk20Crypto, NOTE_ID_TAG, NULLIFIER_TAG } from '../src/services/strk20Crypto';
import { areFeltAddressesEqual, formatTokenAmount, parseTokenAmount, shortenAddress } from '../src/utils/formatters';

describe('STRK20 Cryptographic Suite', () => {
  const dummyChannelKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const dummyToken = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const dummyOwnerPrivKey = '0x0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba';

  it('computes deterministic Note IDs matching index progression', () => {
    const note0 = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 0);
    const note1 = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 1);
    const note0Repeat = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 0);

    expect(note0).toBeDefined();
    expect(note1).toBeDefined();
    expect(note0).not.toEqual(note1);
    expect(note0).toEqual(note0Repeat);
  });

  it('derives unique, deterministic nullifiers bound to owner private key', () => {
    const nullifier0 = strk20Crypto.computeNullifier(dummyChannelKey, dummyToken, 0, dummyOwnerPrivKey);
    const nullifier1 = strk20Crypto.computeNullifier(dummyChannelKey, dummyToken, 1, dummyOwnerPrivKey);

    expect(nullifier0).toBeDefined();
    expect(nullifier0).not.toEqual(nullifier1);
  });

  it('correctly masks and unmasks note amounts (homomorphic symmetric property)', () => {
    const originalAmount = 50000000000000000000n; // 50 STRK
    const salt = '0x42';

    const masked = strk20Crypto.maskAmount(dummyChannelKey, dummyToken, 0, salt, originalAmount);
    expect(masked).not.toEqual(originalAmount);

    const recovered = strk20Crypto.unmaskAmount(dummyChannelKey, dummyToken, 0, salt, masked);
    expect(recovered).toEqual(originalAmount);
  });
});

describe('Formatters & Utilities', () => {
  it('shortens hex addresses cleanly', () => {
    const addr = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
    expect(shortenAddress(addr, 4)).toBe('0x0471...938d');
  });

  it('handles felt address equality regardless of leading zeros', () => {
    const zeroPadded = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
    const unpadded = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

    expect(areFeltAddressesEqual(zeroPadded, unpadded)).toBe(true);
  });

  it('formats and parses token units with precision', () => {
    const amountBig = 1500000000000000000n; // 1.5 STRK (18 decimals)
    expect(formatTokenAmount(amountBig, 18, 2)).toBe('1.5');
    expect(parseTokenAmount('1.5', 18)).toBe(amountBig);
  });
});
