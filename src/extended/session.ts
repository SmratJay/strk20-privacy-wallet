/**
 * @file src/extended/session.ts
 * @description Server-side session store for natively onboarded Extended accounts.
 *
 * When a Starknet wallet is onboarded through our Dapp, the L2 Stark private key is
 * derived server-side from the wallet's "AccountCreation" signature and stored here —
 * never in the browser. The store also keeps the Extended auth cookies (and, once
 * queried, the account/vault ids) needed for authenticated trading.
 *
 * Sessions have a TTL and are lazily purged on access, so a stale token (e.g. after a
 * server restart or long inactivity) is detected and reported back to the client as
 * `sessionExpired` instead of silently falling back to env credentials.
 *
 * This is an in-memory store (single process). For multi-instance deploys it would move
 * to a database/Redis; the interface is intentionally tiny.
 */

export interface ExtendedSession {
  token: string;
  /** The connected Starknet wallet address. */
  wallet: string;
  /** The L2 Stark key pair (derived server-side from the wallet signature). */
  l2Key: { privateKey: string; publicKey: string };
  /** Extended auth session cookies (from `/auth/register`). */
  cookies: string[];
  /** Extended account ids (populated once queried). */
  accountId?: number;
  vaultId?: number;
  /** Registration status returned by Extended. */
  status?: string;
  createdAt: number;
  /** Last access time (refreshed on each successful lookup). */
  lastAccessedAt: number;
}

/** How long a server-side session is kept before it is considered expired. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const sessions = new Map<string, ExtendedSession>();

function generateToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'sess_' + Buffer.from(bytes).toString('hex');
}

export function createExtendedSession(input: Omit<ExtendedSession, 'token' | 'createdAt' | 'lastAccessedAt'>): ExtendedSession {
  const token = generateToken();
  const now = Date.now();
  const session: ExtendedSession = { ...input, token, createdAt: now, lastAccessedAt: now };
  sessions.set(token, session);
  return session;
}

/**
 * Resolve a session by token. Expired sessions are purged and returned as null so the
 * caller can report `sessionExpired` to the client.
 */
export function getExtendedSession(token: string | undefined | null): ExtendedSession | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.lastAccessedAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return null;
  }
  session.lastAccessedAt = Date.now();
  return session;
}

export function deleteExtendedSession(token: string): void {
  sessions.delete(token);
}

export function updateExtendedSession(token: string, patch: Partial<ExtendedSession>): ExtendedSession | null {
  const session = sessions.get(token);
  if (!session) return null;
  const updated = { ...session, ...patch, lastAccessedAt: Date.now() };
  sessions.set(token, updated);
  return updated;
}