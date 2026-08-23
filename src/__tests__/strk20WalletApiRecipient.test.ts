/**
 * @file strk20WalletApiRecipient.test.ts
 * @description Unit tests for STRK20 recipient-readiness error translation (fallback
 * UX only) and Wallet API version gating. Readiness itself is protocol-derived in
 * getPrivateReceivingRequirement (see strk20WalletApiOnboarding.test.ts); these error
 * matchers are deliberately NOT the primary readiness mechanism.
 */

import { describe, it, expect } from 'vitest';
import {
  isRecipientReadinessError,
  translateWalletError,
  isAccountFinalizingError,
  getWalletApiStatus,
  PRIVATE_RECEIVING_RECIPIENT_MESSAGE,
  MIN_STRK20_WALLET_API_VERSION,
} from '../services/strk20WalletApiService';

describe('isRecipientReadinessError (fallback translator only)', () => {
  it('detects a missing channel context', () => {
    expect(isRecipientReadinessError({ message: 'Missing channel context for recipient 0x123' })).toBe(true);
  });

  it('detects recipient-not-registered phrasing', () => {
    expect(isRecipientReadinessError({ message: 'The recipient is not registered. Register the recipient first.' })).toBe(true);
    expect(isRecipientReadinessError({ message: 'recipient has not enabled private receiving' })).toBe(true);
  });

  it('detects privacy-not-enabled phrasing', () => {
    expect(isRecipientReadinessError({ message: 'Privacy not enabled for this address' })).toBe(true);
    expect(isRecipientReadinessError({ message: 'private receiving not enabled' })).toBe(true);
  });

  it('does not fire on unrelated errors', () => {
    expect(isRecipientReadinessError({ message: 'Insufficient private balance' })).toBe(false);
    expect(isRecipientReadinessError({ message: 'User aborted the request' })).toBe(false);
    expect(isRecipientReadinessError({ message: 'An error occurred (NOT_REGISTERED)' })).toBe(false);
    expect(isRecipientReadinessError({})).toBe(false);
  });
});

describe('translateWalletError (recipient context fallback)', () => {
  it('translates a missing-channel error to the recipient message when recipient=true', () => {
    const t = translateWalletError({ message: 'Missing channel context' }, { recipient: true });
    expect(t.userMessage).toBe(PRIVATE_RECEIVING_RECIPIENT_MESSAGE);
  });

  it('keeps the sender-side NOT_REGISTERED message without recipient context', () => {
    const t = translateWalletError({ code: 118 }, {});
    expect(t.userMessage).toContain('not registered');
  });

  it('keeps the sender-side NOT_REGISTERED message even in recipient context (spec-accurate)', () => {
    const t = translateWalletError({ code: 118, message: 'An error occurred (NOT_REGISTERED)' }, { recipient: true });
    expect(t.userMessage).toContain('not registered');
  });

  it('preserves insufficient-balance translation', () => {
    const t = translateWalletError({ code: 119 });
    expect(t.userMessage).toContain('Insufficient private balance');
  });
});

describe('isAccountFinalizingError', () => {
  it('recognizes finalization messages as a wait-and-retry condition', () => {
    expect(isAccountFinalizingError({ message: 'Account is not finalized yet' })).toBe(true);
    expect(isAccountFinalizingError({ message: 'Cannot be registered yet — insufficient block finality' })).toBe(true);
    expect(isAccountFinalizingError({ message: 'Stale block, reorg detected' })).toBe(true);
  });

  it('does not misclassify a plain NOT_REGISTERED or unrelated error', () => {
    expect(isAccountFinalizingError({ message: 'An error occurred (NOT_REGISTERED)' })).toBe(false);
    expect(isAccountFinalizingError({ message: 'Insufficient private balance' })).toBe(false);
    expect(isAccountFinalizingError({ code: 113 })).toBe(false);
  });
});

describe('Wallet API version gating', () => {
  function walletWithApi(version: string) {
    return {
      isConnected: true,
      rawWallet: {
        request: async ({ type }: { type: string }) => {
          if (type === 'wallet_supportedWalletApi') return [version];
          if (type === 'wallet_supportedSpecs') return [];
          if (type === 'wallet_requestChainId') return '0x534e5f5345504f4c4941';
          return [];
        },
      },
    };
  }

  it('accepts 0.10 as STRK20-capable', async () => {
    const s = await getWalletApiStatus(walletWithApi(MIN_STRK20_WALLET_API_VERSION));
    expect(s.supportsStrk20).toBe(true);
  });

  it('accepts 0.10.3 as STRK20-capable', async () => {
    const s = await getWalletApiStatus(walletWithApi('0.10.3'));
    expect(s.supportsStrk20).toBe(true);
  });

  it('rejects 0.9.x as not STRK20-capable', async () => {
    const s = await getWalletApiStatus(walletWithApi('0.9.5'));
    expect(s.supportsStrk20).toBe(false);
  });
});