import { describe, expect, it } from 'vitest';
import { validateWalletAmount, walletErrorMessage, transactionUrl, networkLabel, walletOperationPending } from '../utils/walletUx';
import type { WalletRuntimeView } from '../wallet/runtime';

describe('wallet amount review validation', () => {
  it('preserves exact base units beyond floating-point precision', () => {
    expect(validateWalletAmount('1.000000000000000001', 18, 2000000000000000000n)).toEqual({ units: 1000000000000000001n, error: null });
  });
  it.each(['', '-1', 'NaN', '1e3', '0', '0.0000001'])('blocks invalid 6-decimal amount %s', value => {
    expect(validateWalletAmount(value, 6, 1000000n).error).toBeTruthy();
  });
  it('does not treat an unavailable balance as spendable', () => {
    expect(validateWalletAmount('1', 6, null).error).toContain('unavailable');
  });
  it('distinguishes zero balance and insufficient funds', () => {
    expect(validateWalletAmount('1', 6, 0n).error).toContain('exceeds');
    expect(validateWalletAmount('1', 6, 1000000n).error).toBeNull();
  });
});

describe('honest wallet feedback', () => {
  it('keeps raw provider errors out of the primary message', () => {
    expect(walletErrorMessage(new Error('CONTRACT_NOT_FOUND at 0x123'))).toBe('Unable to find this account or asset on the selected network.');
    expect(walletErrorMessage(new Error('RPC failed: internal payload'))).not.toContain('internal payload');
    expect(walletErrorMessage(new Error('Quote expired'))).toContain('fresh quote');
  });
  it('uses the actual transaction network for explorer links', () => {
    expect(transactionUrl('mainnet', '0xabc')).toBe('https://starkscan.co/tx/0xabc');
    expect(transactionUrl('sepolia', '0xabc')).toBe('https://sepolia.starkscan.co/tx/0xabc');
    expect(networkLabel('sepolia')).toContain('Testnet');
  });
  it.each(['pending', 'unknown', 'proving', 'source-confirming', 'destination-pending'])('blocks another private spend while %s', phase => {
    const state = { privacyOp: { phase: 'idle' }, executionOp: { phase: 'idle' }, swapOp: { phase: 'idle' }, nearIntentOp: { phase } } as WalletRuntimeView;
    expect(walletOperationPending(state)).toBe(true);
  });
  it('allows another action only after terminal state', () => {
    const state = { privacyOp: { phase: 'success' }, executionOp: { phase: 'reverted' }, swapOp: { phase: 'failed' }, nearIntentOp: { phase: 'refunded' } } as WalletRuntimeView;
    expect(walletOperationPending(state)).toBe(false);
  });
});
