import { describe, it, expect } from 'vitest';
import {
  strk20Crypto,
  NOTE_ID_TAG,
  NULLIFIER_TAG,
  CHANNEL_KEY_TAG,
  ENC_AMOUNT_TAG,
  AUDITOR_ESCROW_TAG,
} from '../src/services/strk20Crypto';
import { privacyService } from '../src/services/privacyService';
import { viewingKeyService } from '../src/services/viewingKeyService';
import { priceService } from '../src/services/priceService';
import { areFeltAddressesEqual, formatTokenAmount, parseTokenAmount, shortenAddress } from '../src/utils/formatters';

describe('STRK20 Cryptographic Suite & Domain Tags', () => {
  const dummyChannelKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const dummyToken = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  // Valid STARK curve keypairs (< CURVE_ORDER)
  const dummyOwnerPrivKey = '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdf0';
  const dummyOwnerPubKey = '0x0355250c2e64771e60858b018ae0d8b98a324e2206bf597c9b3bc98cc0197dfbe';
  const dummyRecipientPrivKey = '0x487654321fedcba0987654321fedcba0987654321fedcba0987654321fedcbb';
  const dummyRecipientPub = '0x02636d216297c7ca76f911196351ab865efcbaa130ee2228553ab08f4f8f4bdc8';
  const dummyAccount = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

  it('preserves exact STRK20 domain separation tags', () => {
    expect(NOTE_ID_TAG).toBe('0x4e4f54455f49445f5441473a5631'); // NOTE_ID_TAG:V1
    expect(NULLIFIER_TAG).toBe('0x4e554c4c49464945525f5441473a5631'); // NULLIFIER_TAG:V1
    expect(CHANNEL_KEY_TAG).toBe('0x4348414e4e454c5f4b45595f5441473a5631'); // CHANNEL_KEY_TAG:V1
    expect(ENC_AMOUNT_TAG).toBe('0x454e435f414d4f554e545f5441473a5631'); // ENC_AMOUNT_TAG:V1
    expect(AUDITOR_ESCROW_TAG).toBe('0x41554449544f525f455343524f575f5441473a5631'); // AUDITOR_ESCROW_TAG:V1
  });

  it('computes deterministic Note IDs matching index progression', () => {
    const note0 = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 0);
    const note1 = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 1);
    const note0Repeat = strk20Crypto.computeNoteId(dummyChannelKey, dummyToken, 0);

    expect(note0).toBeDefined();
    expect(note1).toBeDefined();
    expect(note0).not.toEqual(note1);
    expect(note0).toEqual(note0Repeat);
    expect(note0.startsWith('0x')).toBe(true);
  });

  it('derives unique, deterministic nullifiers bound to owner private key', () => {
    const nullifier0 = strk20Crypto.computeNullifier(dummyChannelKey, dummyToken, 0, dummyOwnerPrivKey);
    const nullifier1 = strk20Crypto.computeNullifier(dummyChannelKey, dummyToken, 1, dummyOwnerPrivKey);
    const nullifierDiffKey = strk20Crypto.computeNullifier(dummyChannelKey, dummyToken, 0, '0x0111');

    expect(nullifier0).toBeDefined();
    expect(nullifier0).not.toEqual(nullifier1);
    expect(nullifier0).not.toEqual(nullifierDiffKey);
  });

  it('derives directional channel key via ECDH and Poseidon domain tag', () => {
    const channelKey = strk20Crypto.deriveChannelKeyECDH(
      dummyOwnerPrivKey,
      dummyRecipientPub,
      dummyAccount,
      dummyToken
    );
    expect(channelKey).toBeDefined();
    expect(channelKey.startsWith('0x')).toBe(true);

    // Symmetric key derivation by recipient with sender's public key
    const recipientDerivedKey = strk20Crypto.deriveChannelKeyECDH(
      dummyRecipientPrivKey,
      dummyOwnerPubKey,
      dummyAccount,
      dummyToken
    );
    expect(recipientDerivedKey).toEqual(channelKey);
  });

  it('strictly rejects invalid public keys in ECDH instead of leaking public address hashes', () => {
    expect(() => {
      strk20Crypto.deriveChannelKeyECDH(
        dummyOwnerPrivKey,
        '0x0345678901abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // Invalid curve point
        dummyAccount,
        dummyToken
      );
    }).toThrow(/ECDH key agreement failed/);
  });

  it('computes selective disclosure auditor escrow commitment', () => {
    const escrowCommitment = strk20Crypto.computeAuditorEscrowCommitment(dummyAccount, dummyRecipientPub);
    expect(escrowCommitment).toBeDefined();
    expect(escrowCommitment.startsWith('0x')).toBe(true);
  });

  it('correctly masks and unmasks note amounts across value boundaries (mod 2^128)', () => {
    const testAmounts = [
      0n,
      1n,
      50000000000000000000n, // 50 STRK
      1000000000000000000000000n, // 1M tokens
      (2n ** 128n) - 1n, // Maximum 128-bit boundary
    ];
    const salt = '0x42f7';

    for (const original of testAmounts) {
      const masked = strk20Crypto.maskAmount(dummyChannelKey, dummyToken, 0, salt, original);
      expect(masked).toBeDefined();
      expect(masked < (2n ** 128n)).toBe(true);

      const recovered = strk20Crypto.unmaskAmount(dummyChannelKey, dummyToken, 0, salt, masked);
      expect(recovered).toEqual(original);
    }
  });
});

describe('Privacy Service Data Parsers', () => {
  it('robustly parses varied Starknet u256 serialization formats', () => {
    // 1. Direct bigint
    expect(privacyService.parseU256Result(500n)).toBe(500n);

    // 2. Struct { balance: { low, high } }
    const structBalance = { balance: { low: 1000n, high: 0n } };
    expect(privacyService.parseU256Result(structBalance)).toBe(1000n);

    // 3. Direct { low, high }
    const directLowHigh = { low: '250', high: '0' };
    expect(privacyService.parseU256Result(directLowHigh)).toBe(250n);

    // 4. Array [low, high]
    const arrayFormat = [750n, 0n];
    expect(privacyService.parseU256Result(arrayFormat)).toBe(750n);

    // 5. Number and String
    expect(privacyService.parseU256Result(42)).toBe(42n);
    expect(privacyService.parseU256Result('12345')).toBe(12345n);
    expect(privacyService.parseU256Result(null)).toBe(0n);
  });
});

describe('Formatters & Utilities', () => {
  it('shortens hex addresses cleanly', () => {
    const addr = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
    expect(shortenAddress(addr, 4)).toBe('0x0471...938d');
    expect(shortenAddress('')).toBe('');
  });

  it('handles felt address equality regardless of leading zeros', () => {
    const zeroPadded = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
    const unpadded = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

    expect(areFeltAddressesEqual(zeroPadded, unpadded)).toBe(true);
    expect(areFeltAddressesEqual(zeroPadded, '0x123')).toBe(false);
  });

  it('formats and parses token units with precision for 6 and 18 decimals and handles decimal fractions without leading zero', () => {
    const amount18 = 1500000000000000000n; // 1.5 STRK (18 decimals)
    expect(formatTokenAmount(amount18, 18, 2)).toBe('1.5');
    expect(parseTokenAmount('1.5', 18)).toBe(amount18);

    // Edge case: '.5' without leading zero should parse to 0.5 (500000000000000000n)
    expect(parseTokenAmount('.5', 18)).toBe(500000000000000000n);
    expect(parseTokenAmount('.005', 6)).toBe(5000n);
    expect(parseTokenAmount('', 18)).toBe(0n);
    expect(parseTokenAmount('abc', 18)).toBe(0n);

    const amount6 = 50000000n; // 50 USDC (6 decimals)
    expect(formatTokenAmount(amount6, 6, 2)).toBe('50');
    expect(parseTokenAmount('50', 6)).toBe(amount6);
  });
});

describe('Viewing Key Service (Whitepaper Section 4.3 & 14)', () => {
  it('derives deterministic viewing keypair from wallet signature felt', () => {
    const sigFelt = '0x123456789abcdef';
    const vk1 = viewingKeyService.deriveViewingKeyFromSignature(sigFelt);
    expect(vk1.privateViewingKey.startsWith('0x')).toBe(true);
    expect(vk1.publicViewingKey.startsWith('0x')).toBe(true);

    const vk2 = viewingKeyService.deriveViewingKeyFromSignature(sigFelt);
    expect(vk1.privateViewingKey).toEqual(vk2.privateViewingKey);
    expect(vk1.publicViewingKey).toEqual(vk2.publicViewingKey);
  });

  it('rejects empty or missing signatures', () => {
    expect(() => viewingKeyService.deriveViewingKeyFromSignature('')).toThrow(/signature/i);
  });
});

describe('Price Service (Real-Time Rates)', () => {
  it('provides default fallback token prices with valid symbols', () => {
    const prices = priceService.getCachedPrices();
    expect(prices.STRK).toBeGreaterThan(0);
    expect(prices.ETH).toBeGreaterThan(0);
    expect(prices.USDC).toBe(1.0);
    expect(prices.USDT).toBe(1.0);
  });
});
