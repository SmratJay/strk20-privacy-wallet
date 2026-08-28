import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest, sessionFromRequest } from '@/extended/server';
import type { ExtendedStatus } from '@/extended/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/status
 * Reports whether the server has Extended credentials configured (env) or an active
 * onboarded session. Never returns secrets.
 */
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (session) {
    const client = serverClientForRequest(req);
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