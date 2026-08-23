/**
 * @file strk20WalletAccountDeploy.test.ts
 * @description Unit tests for on-chain account-deployment detection used to give
 * accurate guidance when the wallet cannot register yet (not deployed vs finalizing).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAccountDeployed } from '../services/strk20WalletApiService';

const state = vi.hoisted(() => ({
  error: null as Error | null,
  hash: '0x1',
}));

vi.mock('starknet', () => ({
  RpcProvider: class {
    async getClassHashAt() {
      if (state.error) throw state.error;
      return state.hash;
    }
  },
}));

describe('checkAccountDeployed', () => {
  beforeEach(() => {
    state.error = null;
    state.hash = '0x1';
  });

  it('returns true when the account class hash exists', async () => {
    expect(await checkAccountDeployed('0xabc', 'https://rpc')).toBe(true);
  });

  it('returns false when the account is not deployed (contract not found)', async () => {
    state.error = new Error('Contract not found');
    expect(await checkAccountDeployed('0xabc', 'https://rpc')).toBe(false);
  });

  it('returns false on "not deployed" phrasing', async () => {
    state.error = new Error('Requested contract address is not deployed');
    expect(await checkAccountDeployed('0xabc', 'https://rpc')).toBe(false);
  });

  it('returns null on an unrelated RPC failure (never guesses)', async () => {
    state.error = new Error('502 Bad Gateway');
    expect(await checkAccountDeployed('0xabc', 'https://rpc')).toBe(null);
  });
});