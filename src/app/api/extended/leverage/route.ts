import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest } from '@/extended/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/leverage?market=BTC-USD
 * Returns the current leverage for a market.
 */
export async function GET(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.read) {
    return NextResponse.json(
      { error: 'No Extended account is configured.' },
      { status: 501 },
    );
  }
  const market = req.nextUrl.searchParams.get('market');
  if (!market) return NextResponse.json({ error: 'market is required.' }, { status: 400 });
  try {
    const result = await server.getLeverage(market);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read leverage.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * PATCH /api/extended/leverage
 * Updates the leverage for a market (server-side; requires trading credentials).
 * Body: { market, leverage }
 */
export async function PATCH(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.trade) {
    return NextResponse.json(
      { error: 'Extended trading credentials are not configured (EXTENDED_* env or an onboarded wallet session).' },
      { status: 501 },
    );
  }

  let body: { market?: string; leverage?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.market || !body.leverage) {
    return NextResponse.json({ error: 'market and leverage are required.' }, { status: 400 });
  }

  try {
    const result = await server.updateLeverage(body.market, body.leverage);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Leverage update failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}