import { NextRequest, NextResponse } from 'next/server';
import { serverClientForRequest } from '@/extended/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/account/info
 * Returns the account's id, L2 vault id and bridge address. The vault id is required
 * to build the on-chain USDC deposit. Only account ids are returned — no secrets.
 */
export async function GET(req: NextRequest) {
  const server = serverClientForRequest(req);
  if (!server.configured.read) {
    return NextResponse.json(
      { error: 'No Extended account is configured. Set EXTENDED_API_KEY on the server or onboard a wallet.' },
      { status: 501 },
    );
  }
  try {
    const info = await server.getAccountInfo();
    return NextResponse.json({
      accountId: info.accountId,
      l2Vault: info.l2Vault,
      bridgeStarknetAddress: info.bridgeStarknetAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read account info.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}