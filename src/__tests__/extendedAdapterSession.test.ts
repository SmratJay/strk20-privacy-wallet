/**
 * @file src/__tests__/extendedAdapterSession.test.ts
 * @description Verifies the client adapter's session handling: stale-token clearing on
 * `sessionExpired`, session persistence in localStorage, and wallet/session identity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtendedAdapter } from '../extended/adapter';

const STORAGE = 'extended_session_token';
const WALLET_KEY = 'extended_session_wallet';

function mockLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  vi.stubGlobal('localStorage', ls);
  return { ls, store };
}

describe('ExtendedAdapter session lifecycle', () => {
  beforeEach(() => {
    mockLocalStorage();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('loads a stored session token from localStorage', () => {
    localStorage.setItem(STORAGE, 'sess_abc');
    localStorage.setItem(WALLET_KEY, '0xwallet');
    const adapter = new ExtendedAdapter();
    expect(adapter.sessionToken).toBe('sess_abc');
    expect(adapter.sessionWallet).toBe('0xwallet');
    expect(adapter.hasStoredSession).toBe(true);
  });

  it('clears the local session when the server reports sessionExpired', async () => {
    localStorage.setItem(STORAGE, 'sess_stale');
    localStorage.setItem(WALLET_KEY, '0xwallet');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ read: false, trade: false, sessionExpired: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ExtendedAdapter();
    const status = await adapter.getStatus();
    expect(status.sessionExpired).toBe(true);
    // The stale token must be cleared so the app re-offers onboarding.
    expect(adapter.sessionToken).toBeNull();
    expect(adapter.hasStoredSession).toBe(false);
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });

  it('persists a session and exposes the owning wallet', () => {
    const adapter = new ExtendedAdapter();
    adapter.setSession({ token: 'sess_new', wallet: '0xwallet2' });
    expect(adapter.sessionToken).toBe('sess_new');
    expect(adapter.sessionWallet).toBe('0xwallet2');
    expect(localStorage.getItem(STORAGE)).toBe('sess_new');
    adapter.clearSession();
    expect(adapter.sessionToken).toBeNull();
    expect(localStorage.getItem(WALLET_KEY)).toBeNull();
  });

  it('sends the session token header on private requests', async () => {
    localStorage.setItem(STORAGE, 'sess_header');
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ balance: null, positions: [], openOrders: [], history: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ExtendedAdapter();
    await adapter.getAccountSnapshot();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Record<string, string> | Headers | undefined;
    const h = headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers ?? {});
    expect(h['X-Extended-Session']).toBe('sess_header');
  });

  it('does not send the session header when no session exists', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ balance: null, positions: [], openOrders: [], history: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ExtendedAdapter();
    await adapter.getAccountSnapshot();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Record<string, string> | Headers | undefined;
    const h = headers instanceof Headers ? Object.fromEntries(headers.entries()) : (headers ?? {});
    expect(h['X-Extended-Session']).toBeUndefined();
  });
});