import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest } from '@/extended/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/extended/withdraw
 * Creates a Starknet withdrawal, signed server-side with the session/env L2 key.
 * Body: { amount, asset? } (asset defaults to USD collateral).
 */
export async function POST(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.trade) {
    return NextResponse.json(
      { error: 'Extended trading credentials are not configured (EXTENDED_* env or an onboarded wallet session).' },
      { status: 501 },
    );
  }

  let body: { amount?: string; asset?: string; recipient?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const amount = body.amount?.trim();
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
  }

  try {
    const result = await server.createWithdrawal({ amount, asset: body.asset, recipient: body.recipient });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Withdrawal failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}