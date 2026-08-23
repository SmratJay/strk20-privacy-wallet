/**
 * @file strk20WalletApiRecipient.test.ts
 * @description Unit tests for the STRK20 Wallet API recipient-readiness error
 * translation and the private-receiving onboarding helpers. These enforce the
 * "recipient must enable private receiving" protocol fact without faking it.
 */

import { describe, it, expect } from 'vitest';
import {
  isRecipientReadinessError,
  translateWalletError,
  checkPrivateReceivingStatus,
  enablePrivateReceiving,
  PRIVATE_RECEIVING_RECIPIENT_MESSAGE,
  MIN_STRK20_WALLET_API_VERSION,
} from '../services/strk20WalletApiService';

describe('isRecipientReadinessError', () => {
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
    expect(isRecipientReadinessError({})).toBe(false);
  });
});

describe('translateWalletError (recipient context)', () => {
  it('translates a missing-channel error to the recipient message when recipient=true', () => {
    const t = translateWalletError(
      { message: 'Missing channel context' },
      { recipient: true },
    );
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

function makeWallet({ supportsStrk20, notRegistered }: { supportsStrk20: boolean; notRegistered?: boolean }) {
  const request = async ({ type }: { type: string }): Promise<unknown> => {
    if (type === 'wallet_supportedWalletApi') {
      return supportsStrk20 ? [MIN_STRK20_WALLET_API_VERSION] : ['0.9.0'];
    }
    if (type === 'wallet_supportedSpecs') {
      return supportsStrk20 ? [MIN_STRK20_WALLET_API_VERSION] : [];
    }
    if (type === 'wallet_requestChainId') {
      return '0x534e5f5345504f4c4941';
    }
    if (type === 'wallet_strk20Balances') {
      if (notRegistered) {
        const err: any = new Error('An error occurred (NOT_REGISTERED)');
        err.code = 118;
        throw err;
      }
      return [{ token: '0x1', balance: '0x0' }];
    }
    return [];
  };
  return {
    isConnected: true,
    rawWallet: { request },
  };
}

describe('checkPrivateReceivingStatus', () => {
  it('returns UNSUPPORTED for a non-STRK20 wallet', async () => {
    const status = await checkPrivateReceivingStatus(makeWallet({ supportsStrk20: false }));
    expect(status).toBe('UNSUPPORTED');
  });

  it('returns ENABLED when registered', async () => {
    const status = await checkPrivateReceivingStatus(makeWallet({ supportsStrk20: true, notRegistered: false }));
    expect(status).toBe('ENABLED');
  });

  it('returns NOT_ENABLED when the wallet reports NOT_REGISTERED', async () => {
    const status = await checkPrivateReceivingStatus(makeWallet({ supportsStrk20: true, notRegistered: true }));
    expect(status).toBe('NOT_ENABLED');
  });
});

describe('enablePrivateReceiving', () => {
  it('reports UNSUPPORTED honestly for a non-STRK20 wallet', async () => {
    const res = await enablePrivateReceiving(makeWallet({ supportsStrk20: false }));
    expect(res.status).toBe('UNSUPPORTED');
    expect(res.message).toContain("isn't supported by this wallet yet");
  });

  it('reports ALREADY_ENABLED for a registered wallet', async () => {
    const res = await enablePrivateReceiving(makeWallet({ supportsStrk20: true, notRegistered: false }));
    expect(res.status).toBe('ALREADY_ENABLED');
  });

  it('reports NEEDS_FIRST_SHIELD for an unregistered wallet without faking registration', async () => {
    const res = await enablePrivateReceiving(makeWallet({ supportsStrk20: true, notRegistered: true }));
    expect(res.status).toBe('NEEDS_FIRST_SHIELD');
    expect(res.message.toLowerCase()).toContain('first time you shield');
  });
});