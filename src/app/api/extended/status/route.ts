import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest, sessionFromRequest, hasSessionToken } from '@/extended/server';
import type { ExtendedStatus } from '@/extended/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/status
 * Reports whether the server has Extended credentials configured (env) or an active
 * onboarded session. Never returns secrets.
 *
 * When the client sends a session token that is stale/unknown/expired (e.g. after a
 * server restart), the response includes `sessionExpired: true` so the client can clear
 * its local token and offer native onboarding again instead of silently falling back to
 * env credentials.
 */
export async function GET(req: NextRequest) {
  const tokenProvided = hasSessionToken(req);
  const session = sessionFromRequest(req);

  if (tokenProvided && !session) {
    // Stale / expired / unknown session token.
    const fallback = serverClientForRequest(req);
    const status: ExtendedStatus = fallback.configured;
    return NextResponse.json({ ...status, sessionExpired: true });
  }

  if (session) {
    const trade = Boolean(
      session.vaultId !== undefined &&
      session.l2Key?.privateKey &&
      session.l2Key?.publicKey,
    );
    const status: ExtendedStatus = { read: Boolean(session.cookies.length > 0), trade };
    return NextResponse.json({
      ...status,
      session: {
        wallet: session.wallet,
        read: status.read,
        trade,
        accountId: session.accountId ?? null,
        vaultId: session.vaultId ?? null,
      },
    });
  }

  const client = serverClientForRequest(req);
  const status: ExtendedStatus = client.configured;
  return NextResponse.json(status);
}