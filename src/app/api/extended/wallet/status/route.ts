import { NextRequest, NextResponse } from 'next/server';
import { checkWalletDeployment } from '@/extended/walletStatus';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/wallet/status?address=0x…
 * Returns whether the connected Starknet wallet is deployed on Starknet Mainnet.
 * Extended verifies the wallet on-chain during onboarding, so a deployed account is a
 * hard prerequisite. The check runs server-side; no RPC key reaches the browser.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address is required (?address=0x…).' }, { status: 400 });
  }
  try {
    const status = await checkWalletDeployment(address);
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Wallet check failed.';
    return NextResponse.json({ deployed: false, unknown: true, rpcError: message }, { status: 502 });
  }
}