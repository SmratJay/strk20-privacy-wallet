/**
 * @file src/__tests__/aiShadowAccount.test.ts
 * @description Proves the exact STRK20 identity relationship for the Hamster AI treasury.
 *
 * `computeReadyAccountAddress(publicKey)` derives the user's Ready/Argent smart-account.
 * This test proves — with the REAL vendored STRK20 SDK — that the derived address IS the
 * STRK20 **user identity**: it is the `user` the existing integration passes to
 * `createPrivateTransfers`, which owns private notes (`discoverNotes(user, viewingKey, …)`)
 * and is the SOURCE account of every private transfer. The SDK's separate "Shadow Account"
 * (`shadow_account_anonymizer`, keyed by identity_key + dapp name) is NOT wired in this repo.
 */
import { describe, it, expect } from 'vitest';
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';
import { computeReadyAccountAddress } from '@/privacy/privy/ready';

const PUBLIC_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde';
const POOL = '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91';

describe('computeReadyAccountAddress == STRK20 user identity', () => {
  it('is the address the existing STRK20 integration registers as the private-note owner', async () => {
    const derived = computeReadyAccountAddress(PUBLIC_KEY);

    // Construct a real PrivateTransfers exactly the way PrivyStrk20Adapter.getTransfers does
    // (account address = the derived Ready address; no shadowAccountAnonymizerAddress).
    // Construction is side-effect-free — no prover/discovery/network calls.
    const transfers = createPrivateTransfers({
      account: { address: derived, signer: {} as never },
      viewingKeyProvider: { getViewingKey: async () => 1n },
      provingProvider: {
        url: 'https://prover.invalid',
        chainId: '0x534e5f5345504f4c4941',
      } as never,
      discoveryProvider: { url: 'https://discovery.invalid' } as never,
      poolContractAddress: POOL,
    });

    // The SDK stores `user = toBigInt(account.address)` and keys note ownership by it.
    const user = (transfers as unknown as { user: bigint }).user;
    expect(user).toBe(BigInt(derived));
    expect(user).toBeGreaterThan(0n);
  });

  it('is deterministic for the same public key', () => {
    expect(computeReadyAccountAddress(PUBLIC_KEY)).toBe(computeReadyAccountAddress(PUBLIC_KEY));
  });

  it('produces a valid Starknet address (fits felt range, non-zero)', () => {
    const derived = computeReadyAccountAddress(PUBLIC_KEY);
    const value = BigInt(derived);
    expect(value).toBeGreaterThan(0n);
    expect(value).toBeLessThan(2n ** 251n);
  });
});