import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest } from '@/extended/server';

export const dynamic = 'force-dynamic';

/** GET /api/extended/deposits — deposit history for the active account. */
export async function GET(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.read) {
    return NextResponse.json(
      { error: 'No Extended account is configured. Set EXTENDED_API_KEY on the server or onboard a wallet.' },
      { status: 501 },
    );
  }
  try {
    const deposits = await server.getDeposits();
    return NextResponse.json(deposits);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read deposits.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}