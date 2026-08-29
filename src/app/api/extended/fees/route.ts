import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest } from '@/extended/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/fees?market=BTC-USD
 * Returns the maker/taker/builder fee schedule for the authenticated account.
 * Fee rates come live from Extended (`/user/fees`) — never invented locally.
 */
export async function GET(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.read) {
    return NextResponse.json(
      { error: 'No Extended account is configured. Connect your wallet first.' },
      { status: 501 },
    );
  }
  const market = req.nextUrl.searchParams.get('market');
  if (!market) return NextResponse.json({ error: 'market is required.' }, { status: 400 });
  try {
    const fees = await server.getFees(market);
    return NextResponse.json(fees);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read fees.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}