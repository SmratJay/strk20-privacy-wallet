import { NextResponse } from 'next/server';
import { ExtendedServerClient } from '@/extended/server';
import type { ExtendedAccountSnapshot } from '@/extended/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/account
 * Returns balance / positions / open orders / order history for the server-configured
 * Extended account (uses the server-side API key; never exposes it).
 */
export async function GET() {
  const server = new ExtendedServerClient();
  if (!server.configured.read) {
    return NextResponse.json(
      { error: 'Extended API key is not configured on the server (EXTENDED_API_KEY).' },
      { status: 501 },
    );
  }

  try {
    const snapshot: ExtendedAccountSnapshot = await server.getAccountSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read Extended account.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}