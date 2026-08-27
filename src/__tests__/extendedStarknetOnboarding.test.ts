/**
 * @file src/__tests__/extendedStarknetOnboarding.test.ts
 * @description Verifies the native Starknet-wallet onboarding flow (traced from the
 * current Extended web app): SNIP-12 typed-data construction, signature serialization,
 * L2 key derivation, and the `/auth/register` / `/auth/login` payloads.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  accountCreationTypedData,
  accountRegistrationTypedData,
  loginTypedData,
  buildStarknetDomain,
  serializeStarknetSignature,
  deriveStarknetKeyPair,
  buildStarknetRegisterPayload,
  buildStarknetLoginPayload,
  registerStarknetWallet,
  loginStarknetWallet,
} from '../extended/onboarding';
import { privateKeyFromEthSignature } from '../extended/crypto';

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: 1 };
const HOST = 'starknet.sepolia.extended.exchange';
const WALLET = '0x4796c6b81b78a353d00aecbd015f3ce15a77c6df41b824e943e127563ec4515';
const TIME = '2026-08-27T22:53:33Z';

describe('native Starknet onboarding', () => {
  it('builds the StarkNet domain with revision as a shortstring string', () => {
    expect(buildStarknetDomain(DOMAIN)).toEqual({ name: 'Perpetuals', version: 'v0', chainId: 'SN_SEPOLIA', revision: '1' });
  });

  it('builds the AccountCreation typed data exactly like the web app', () => {
    const td = accountCreationTypedData(WALLET, DOMAIN) as any;
    expect(td.primaryType).toBe('AccountCreation');
    expect(td.types.StarknetDomain).toEqual([
      { name: 'name', type: 'shortstring' },
      { name: 'version', type: 'shortstring' },
      { name: 'chainId', type: 'shortstring' },
      { name: 'revision', type: 'shortstring' },
    ]);
    expect(td.types.AccountCreation).toEqual([
      { name: 'accountIndex', type: 'felt' },
      { name: 'wallet', type: 'string' },
      { name: 'tosAccepted', type: 'bool' },
    ]);
    expect(td.message).toEqual({ accountIndex: 0, wallet: WALLET, tosAccepted: true });
    expect(td.domain.revision).toBe('1');
  });

  it('builds the AccountRegistration typed data with REGISTER action + host', () => {
    const td = accountRegistrationTypedData(WALLET, HOST, TIME, DOMAIN) as any;
    expect(td.primaryType).toBe('AccountRegistration');
    expect(td.types.AccountRegistration).toEqual([
      { name: 'accountIndex', type: 'felt' },
      { name: 'wallet', type: 'string' },
      { name: 'tosAccepted', type: 'bool' },
      { name: 'time', type: 'string' },
      { name: 'action', type: 'string' },
      { name: 'host', type: 'string' },
    ]);
    expect(td.message).toEqual({ accountIndex: 0, wallet: WALLET, tosAccepted: true, time: TIME, action: 'REGISTER', host: HOST });
  });

  it('builds the Login typed data', () => {
    const td = loginTypedData(HOST, TIME, DOMAIN) as any;
    expect(td.primaryType).toBe('Login');
    expect(td.message).toEqual({ host: HOST, action: 'LOGIN', time: TIME });
  });

  it('serializes a Starknet signature as JSON of decimal strings', () => {
    expect(serializeStarknetSignature({ r: 123n, s: 456n })).toBe('["123","456"]');
    expect(serializeStarknetSignature(['0x1f4', '0x1c8'])).toBe('["500","456"]');
  });

  it('derives the L2 key pair from a Starknet signature (grindKey over r)', () => {
    // Known Rust reference vector: ethSigToPrivate(0x9ef64d…) => 3554363360756768076148116215296798451844584215587910826843139626172125285444
    const r = '0x9ef64d5936681edf44b4a7ad713f3bc24065d4039562af03fccf6a08d6996eab';
    const s = '0x367df11439169b417b6a6d8ce81d409edb022597ce193916757c7d5d9cbf9730';
    const keyPair = deriveStarknetKeyPair({ r, s });
    expect(BigInt(keyPair.privateKey).toString()).toBe(
      '3554363360756768076148116215296798451844584215587910826843139626172125285444',
    );
    expect(keyPair.publicKey).toMatch(/^0x/);
  });

  it('derives the same private key as privateKeyFromEthSignature over r||s||v', () => {
    const r = '0x9ef64d5936681edf44b4a7ad713f3bc24065d4039562af03fccf6a08d6996eab';
    const s = '0x367df11439169b417b6a6d8ce81d409edb022597ce193916757c7d5d9cbf9730';
    const keyPair = deriveStarknetKeyPair({ r, s });
    const viaEther = '0x' + privateKeyFromEthSignature('0x' + r.slice(2) + s.slice(2) + '1c');
    expect(keyPair.privateKey).toBe(viaEther);
  });

  it('builds the /auth/register payload for a native Starknet wallet', () => {
    const keyPair = deriveStarknetKeyPair({ r: '0x1', s: '0x2' });
    const payload = buildStarknetRegisterPayload({
      wallet: WALLET,
      l1Signature: '["123","456"]',
      keyPair,
      host: HOST,
      time: TIME,
      referralCode: null,
    });
    expect(payload.walletType).toBe('STARKNET');
    expect(payload.l1Signature).toBe('["123","456"]');
    expect(payload.l2Key).toBe(keyPair.publicKey);
    expect(payload.l2Signature).toHaveProperty('r');
    expect(payload.l2Signature).toHaveProperty('s');
    expect(payload.accountCreation).toEqual({
      host: HOST,
      accountIndex: 0,
      wallet: WALLET,
      tosAccepted: true,
      action: 'REGISTER',
      time: TIME,
    });
  });

  it('builds the /auth/login payload for a native Starknet wallet', () => {
    const payload = buildStarknetLoginPayload({ walletAddress: WALLET, l1Signature: '["1","2"]', host: HOST, time: TIME });
    expect(payload).toEqual({
      l1Signature: '["1","2"]',
      login: { host: HOST, action: 'LOGIN', time: TIME },
      walletType: 'STARKNET',
      walletAddress: WALLET,
    });
  });

  it('POSTs to /auth/register with the native Starknet payload and captures cookies', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => '"Registered"',
        headers: { getSetCookie: () => ['x10_access_token=abc; Path=/', 'x10_refresh_token=def; Path=/'] },
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await registerStarknetWallet({ walletType: 'STARKNET' }, { rememberMe: true });
    expect(result.status).toBe('Registered');
    expect(result.cookies[0]).toContain('x10_access_token=abc');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/auth/register');
    expect(String(url)).toContain('rememberMe=true');
  });

  it('POSTs to /auth/login for re-auth', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: true, status: 200, text: async () => '"Logged in"', headers: { getSetCookie: () => [] } } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await loginStarknetWallet({ walletType: 'STARKNET' });
    expect(result.status).toBe('Logged in');
    expect(String((fetchMock.mock.calls[0] as unknown as string[])[0])).toContain('/auth/login');
  });

  it('throws a clear error when register fails', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 500, text: async () => '' } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(registerStarknetWallet({ walletType: 'STARKNET' })).rejects.toThrow(/500/);
  });
});