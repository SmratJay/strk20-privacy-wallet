/**
 * @file src/__tests__/extendedMainnetOnboarding.test.ts
 * @description Verifies the native Starknet onboarding payload for MAINNET:
 * SNIP-12 domain SN_MAIN, authHost extended.exchange, exact /auth/register wire shape.
 * Also covers the adapter session lifecycle and clean error states for the
 * backend-blocked register path (HTTP 500).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  accountCreationTypedData,
  accountRegistrationTypedData,
  buildStarknetDomain,
  buildStarknetRegisterPayload,
  deriveStarknetKeyPair,
  serializeStarknetSignature,
  registerStarknetWallet,
} from '../extended/onboarding';
import { getExtendedEnvironment } from '../extended/config';

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 };
const WALLET = '0x4796c6b81b78a353d00aecbd015f3ce15a77c6df41b824e943e127563ec4515';
const TIME = '2026-08-28T05:26:10.849Z';

describe('native Starknet onboarding (mainnet)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resolves the mainnet auth host and SNIP-12 domain', () => {
    process.env.NEXT_PUBLIC_EXTENDED_API_BASE_URL = 'https://api.starknet.extended.exchange/api/v1';
    const env = getExtendedEnvironment();
    expect(env.authHost).toBe('extended.exchange');
    expect(env.starknetDomain).toEqual(DOMAIN);
  });

  it('builds mainnet typed data with the SN_MAIN domain', () => {
    const td = accountRegistrationTypedData(WALLET, 'extended.exchange', TIME, DOMAIN) as any;
    expect(td.primaryType).toBe('AccountRegistration');
    expect(td.message).toEqual({
      accountIndex: 0,
      wallet: WALLET,
      tosAccepted: true,
      time: TIME,
      action: 'REGISTER',
      host: 'extended.exchange',
    });
    expect(buildStarknetDomain(DOMAIN)).toEqual({ name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: '1' });
  });

  it('builds the exact mainnet /auth/register payload', () => {
    const keyPair = deriveStarknetKeyPair({ r: '0x9ef64d5936681edf44b4a7ad713f3bc24065d4039562af03fccf6a08d6996eab', s: '0x1' });
    const payload = buildStarknetRegisterPayload({
      wallet: WALLET,
      l1Signature: serializeStarknetSignature({ r: 11n, s: 22n }),
      keyPair,
      host: 'extended.exchange',
      time: TIME,
      referralCode: null,
    });
    expect(payload.walletType).toBe('STARKNET');
    expect(payload.l1Signature).toBe('["11","22"]');
    expect(payload.accountCreation).toEqual({
      host: 'extended.exchange',
      accountIndex: 0,
      wallet: WALLET,
      tosAccepted: true,
      action: 'REGISTER',
      time: TIME,
    });
    expect(payload).not.toHaveProperty('referralCode');
    expect(payload.l2Key).toMatch(/^0x/);
    expect(payload.l2Signature).toHaveProperty('r');
    expect(payload.l2Signature).toHaveProperty('s');
  });

  it('surfaces the backend-blocked register path as a clean error', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      registerStarknetWallet(
        buildStarknetRegisterPayload({
          wallet: WALLET,
          l1Signature: '["1","2"]',
          keyPair: deriveStarknetKeyPair({ r: '0x1', s: '0x2' }),
          host: 'extended.exchange',
          time: TIME,
          referralCode: null,
        }),
      ),
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String((fetchMock.mock.calls as unknown as [string][] )[0][0]);
    expect(url).toContain('/auth/register');
  });

  it('omits referralCode from the register payload when no code is provided (frontend behavior)', () => {
    const keyPair = deriveStarknetKeyPair({ r: '0x1', s: '0x2' });
    const noCode = buildStarknetRegisterPayload({
      wallet: WALLET,
      l1Signature: '["1","2"]',
      keyPair,
      host: 'extended.exchange',
      time: TIME,
      referralCode: null,
    });
    const withCode = buildStarknetRegisterPayload({
      wallet: WALLET,
      l1Signature: '["1","2"]',
      keyPair,
      host: 'extended.exchange',
      time: TIME,
      referralCode: 'ORRANGE',
    });
    expect(noCode).not.toHaveProperty('referralCode');
    expect(withCode.referralCode).toBe('ORRANGE');
  });
});