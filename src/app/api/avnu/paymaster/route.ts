import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/avnu/paymaster
 * Server-side proxy for AVNU's privacy paymaster (JSON-RPC).
 *
 * Private swaps are gas-sponsored by AVNU's paymaster, which authenticates with
 * an API key. Anything bundled into the browser is publicly readable, so the key
 * is attached here, server-side, and never reaches the client bundle.
 *
 * The AVNU SDK's paymaster client (`buildPrivateSwapFee` / `submitPrivateSwap` /
 * `executePrivateSwap`) POSTs JSON-RPC to the configured `paymasterBaseUrl`. Point
 * it at this route (`/api/avnu/paymaster?network=mainnet|sepolia`) and the key is
 * injected here.
 */
const PAYMASTER_URLS: Record<string, string> = {
  mainnet: 'https://starknet.paymaster.avnu.fi',
  sepolia: 'https://sepolia.paymaster.avnu.fi',
};

export async function POST(req: NextRequest) {
  const network = req.nextUrl.searchParams.get('network') || 'mainnet';
  const upstream = PAYMASTER_URLS[network] ?? PAYMASTER_URLS.mainnet;

  const key = process.env.AVNU_PAYMASTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'AVNU paymaster proxy is not configured on the server (missing AVNU_PAYMASTER_API_KEY).' },
      { status: 503 },
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const upstreamRes = await fetch(upstream, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-paymaster-api-key': key,
    },
    body: bodyText,
  });

  const upstreamBody = await upstreamRes.text();
  return new NextResponse(upstreamBody, {
    status: upstreamRes.status,
    headers: {
      'content-type': upstreamRes.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
}