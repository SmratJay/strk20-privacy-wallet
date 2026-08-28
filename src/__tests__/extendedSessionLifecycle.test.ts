/**
 * @file src/__tests__/extendedSessionLifecycle.test.ts
 * @description Verifies server-side session lifecycle: TTL expiry, stale-token
 * detection (sessionExpired), wallet/session ownership, and session updates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  createExtendedSession,
  getExtendedSession,
  deleteExtendedSession,
  updateExtendedSession,
  SESSION_MAX_AGE_MS,
} from '../extended/session';
import { GET as statusGet } from '../app/api/extended/status/route';
import { credentialsFromSession } from '../extended/server';

const SESSION_INPUT = {
  wallet: '0xabc',
  l2Key: { privateKey: '0xpriv', publicKey: '0xpub' },
  cookies: ['x10_session=abc'],
  status: 'Registered',
};

function makeRequest(header?: string | null): NextRequest {
  const headers: Record<string, string> = { 'User-Agent': 'test' };
  if (header) headers['x-extended-session'] = header;
  return new Request('https://localhost/api/extended/status', { headers }) as unknown as NextRequest;
}

describe('Extended session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates and resolves a session', () => {
    const s = createExtendedSession(SESSION_INPUT);
    expect(getExtendedSession(s.token)?.wallet).toBe('0xabc');
    expect(getExtendedSession('bogus')).toBeNull();
  });

  it('expires a session after the TTL and purges it', () => {
    const s = createExtendedSession(SESSION_INPUT);
    vi.advanceTimersByTime(SESSION_MAX_AGE_MS + 1);
    expect(getExtendedSession(s.token)).toBeNull();
    // Second access stays null (purged).
    expect(getExtendedSession(s.token)).toBeNull();
  });

  it('refreshes lastAccessedAt on successful lookups', () => {
    const s = createExtendedSession(SESSION_INPUT);
    vi.advanceTimersByTime(SESSION_MAX_AGE_MS - 1000);
    expect(getExtendedSession(s.token)).not.toBeNull();
    vi.advanceTimersByTime(2000); // would exceed TTL if not refreshed
    expect(getExtendedSession(s.token)).not.toBeNull();
  });

  it('updateExtendedSession patches fields and keeps the session alive', () => {
    const s = createExtendedSession(SESSION_INPUT);
    updateExtendedSession(s.token, { accountId: 7, vaultId: 700 });
    const updated = getExtendedSession(s.token);
    expect(updated?.accountId).toBe(7);
    expect(updated?.vaultId).toBe(700);
  });

  it('deleteExtendedSession removes the session', () => {
    const s = createExtendedSession(SESSION_INPUT);
    deleteExtendedSession(s.token);
    expect(getExtendedSession(s.token)).toBeNull();
  });

  it('status route reports sessionExpired for a stale/unknown token', async () => {
    const res = await statusGet(makeRequest('sess_nonexistent'));
    const json = (await res.json()) as { sessionExpired?: boolean };
    expect(res.status).toBe(200);
    expect(json.sessionExpired).toBe(true);
  });

  it('status route reports an active session without leaking secrets', async () => {
    const s = createExtendedSession({ ...SESSION_INPUT, accountId: 5, vaultId: 500 });
    const res = await statusGet(makeRequest(s.token));
    const json = (await res.json()) as {
      read?: boolean;
      trade?: boolean;
      session?: { wallet?: string; accountId?: number | null; vaultId?: number | null; l2Key?: unknown; cookies?: unknown };
    };
    expect(json.read).toBe(true);
    expect(json.trade).toBe(true);
    expect(json.session?.wallet).toBe('0xabc');
    expect(json.session).not.toHaveProperty('l2Key');
    expect(json.session).not.toHaveProperty('cookies');
  });

  it('status route without a token falls back to env credentials', async () => {
    vi.stubEnv('EXTENDED_API_KEY', 'key-1');
    vi.stubEnv('EXTENDED_STARK_PRIVATE_KEY', '0xpriv');
    vi.stubEnv('EXTENDED_STARK_PUBLIC_KEY', '0xpub');
    vi.stubEnv('EXTENDED_VAULT_ID', '123');
    const res = await statusGet(makeRequest());
    const json = (await res.json()) as { read?: boolean; trade?: boolean; session?: unknown };
    expect(json.read).toBe(true);
    expect(json.session).toBeUndefined();
    delete process.env.EXTENDED_API_KEY;
    delete process.env.EXTENDED_STARK_PRIVATE_KEY;
    delete process.env.EXTENDED_STARK_PUBLIC_KEY;
    delete process.env.EXTENDED_VAULT_ID;
  });

  it('derives credentials from a session and exposes configured flags', () => {
    const s = createExtendedSession({ ...SESSION_INPUT, accountId: 9, vaultId: 900 });
    const creds = credentialsFromSession(s);
    expect(creds?.vaultId).toBe(900);
    expect(creds?.cookies).toEqual(['x10_session=abc']);
  });
});