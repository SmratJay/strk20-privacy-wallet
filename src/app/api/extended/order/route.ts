import { NextRequest, NextResponse } from 'next/server';
import { ExtendedServerClient } from '@/extended/server';
import type { PlaceOrderParams } from '@/extended/adapter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/extended/order
 * Places a real order on Extended, signed server-side with the Stark L2 key.
 * The Stark private key is never exposed to the client.
 */
export async function POST(req: NextRequest) {
  const server = new ExtendedServerClient();
  if (!server.configured.trade) {
    return NextResponse.json(
      { error: 'Extended trading credentials are not configured on the server (EXTENDED_* env).' },
      { status: 501 },
    );
  }

  let params: PlaceOrderParams;
  try {
    params = (await req.json()) as PlaceOrderParams;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!params.market || !params.side || !params.qty || !params.price) {
    return NextResponse.json(
      { error: 'Missing required order fields (market, side, qty, price).' },
      { status: 400 },
    );
  }

  try {
    const placed = await server.placeOrder(params);
    return NextResponse.json(placed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * DELETE /api/extended/order?id={orderId}
 * Cancels an order by its Extended-assigned id.
 */
export async function DELETE(req: NextRequest) {
  const server = new ExtendedServerClient();
  if (!server.configured.trade) {
    return NextResponse.json(
      { error: 'Extended trading credentials are not configured on the server (EXTENDED_* env).' },
      { status: 501 },
    );
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'A numeric order id is required (?id=).' }, { status: 400 });
  }

  try {
    await server.cancelOrder(Number(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cancel failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}