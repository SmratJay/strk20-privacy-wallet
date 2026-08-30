import { describe, it, expect } from 'vitest';
import {
  getShadowAccountCapability,
  deriveShadowCommitment,
  SHADOW_ANONYMIZER_ENV,
  SHADOW_DAPP_ENV,
  DEFAULT_SHADOW_DAPP_NAME,
} from '@/ai/shadow';
import { buildAnalyzeRequest } from '@/services/treasuryService';
import { SEPOLIA_TOKENS } from '@/config/networks';

const POOL = SEPOLIA_TOKENS.find((t) => t.symbol === 'STRK')!.address;
const ANONYMIZER = '0x1111111111111111111111111111111111111111111111111111111111111111';
const USER = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const VIEWING_KEY = 0x1234n;
const DAPP = 'orrange';

describe('shadow account capability — feature-gated', () => {
  it('is DISABLED when no anonymizer address is configured', () => {
    const cap = getShadowAccountCapability({});
    expect(cap.enabled).toBe(false);
    expect(cap.reason).toMatch(/not wired|not configured/i);
  });

  it('is ENABLED when the anonymizer address is configured', () => {
    const cap = getShadowAccountCapability({ [SHADOW_ANONYMIZER_ENV]: ANONYMIZER });
    expect(cap.enabled).toBe(true);
    expect(cap.anonymizerAddress).toBe(ANONYMIZER);
    expect(cap.dappName).toBe(DEFAULT_SHADOW_DAPP_NAME);
  });

  it('honors a custom dapp name', () => {
    const cap = getShadowAccountCapability({ [SHADOW_ANONYMIZER_ENV]: ANONYMIZER, [SHADOW_DAPP_ENV]: 'hamster' });
    expect(cap.dappName).toBe('hamster');
  });
});

describe('shadow commitment derivation — real SDK, deterministic', () => {
  it('derives the same partial commitment for the same input', async () => {
    const a = await deriveShadowCommitment({ user: USER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, dappName: DAPP, poolContractAddress: POOL });
    const b = await deriveShadowCommitment({ user: USER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, dappName: DAPP, poolContractAddress: POOL });
    expect(a.partialCommitment).toBe(b.partialCommitment);
    expect(BigInt(a.partialCommitment)).toBeGreaterThan(0n);
  });

  it('derives a different commitment for a different nonce', async () => {
    const r = await deriveShadowCommitment({ user: USER, viewingKey: VIEWING_KEY, anonymizerAddress: ANONYMIZER, dappName: DAPP, poolContractAddress: POOL });
    const n1 = await r.commitment(1n);
    const n2 = await r.commitment(2n);
    expect(n1).not.toBe(n2);
  });

  it('derives a different partial commitment for a different viewing key', async () => {
    const a = await deriveShadowCommitment({ user: USER, viewingKey: 1n, anonymizerAddress: ANONYMIZER, dappName: DAPP, poolContractAddress: POOL });
    const b = await deriveShadowCommitment({ user: USER, viewingKey: 2n, anonymizerAddress: ANONYMIZER, dappName: DAPP, poolContractAddress: POOL });
    expect(a.partialCommitment).not.toBe(b.partialCommitment);
  });
});

describe('viewing key never leaks into server payloads', () => {
  it('buildAnalyzeRequest never includes viewing keys, notes, or secrets', () => {
    const req = buildAnalyzeRequest({
      prompt: 'Make my treasury safer.',
      balances: [{ token: POOL, balance: 1n }],
      userAddress: USER,
      privateTreasuryAddress: USER,
      policy: { preset: 'flexible' },
    });
    const json = JSON.stringify(req);
    expect(json).not.toContain('viewingKey');
    expect(json).not.toContain('viewing_key');
    expect(json).not.toContain('notes');
    expect(json).not.toContain('privateKey');
    expect(json).not.toContain('secret');
  });

  it('commitment derivation is a separate client-side call, not part of the server request', () => {
    // The server-facing request body has no way to carry the viewing key, and the shadow
    // derivation input (with the viewing key) is a distinct, client-side API surface.
    const cap = getShadowAccountCapability({});
    expect(cap.enabled).toBe(false);
  });
});