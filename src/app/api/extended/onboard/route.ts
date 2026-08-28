import { NextRequest, NextResponse } from 'next/server';
import {
  deriveStarknetKeyPair,
  serializeStarknetSignature,
  buildStarknetRegisterPayload,
  registerStarknetWallet,
} from '@/extended/onboarding';
import { getExtendedEnvironment } from '@/extended/config';
import { createExtendedSession, updateExtendedSession } from '@/extended/session';
import { ExtendedClient } from '@/extended/client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/extended/onboard
 * Natively onboard a connected Starknet wallet to Extended.
 *
 * The wallet signs SNIP-12 "AccountCreation" + "AccountRegistration" typed data in the
 * browser; the signatures are sent here. The L2 Stark key pair is derived server-side
 * (never in the client bundle) and `/auth/register` is called with `walletType:
 * "STARKNET"`. On success a server-side session is created, its token returned, and the
 * account id / vault id are captured so the session can trade and receive deposits.
 *
 * Body: { wallet, accountCreationSig: {r,s}, accountRegistrationSig: {r,s}, time?, referralCode? }
 */
export async function POST(req: NextRequest) {
  let body: {
    wallet?: string;
    accountCreationSig?: { r?: unknown; s?: unknown };
    accountRegistrationSig?: { r?: unknown; s?: unknown };
    time?: string;
    referralCode?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { wallet, accountCreationSig, accountRegistrationSig } = body;
  if (!wallet || !accountCreationSig?.r || !accountCreationSig?.s || !accountRegistrationSig?.r || !accountRegistrationSig?.s) {
    return NextResponse.json(
      { error: 'wallet, accountCreationSig.{r,s} and accountRegistrationSig.{r,s} are required.' },
      { status: 400 },
    );
  }

  try {
    const env = getExtendedEnvironment();
    // Derive the L2 Stark key pair server-side from the "AccountCreation" signature.
    const keyPair = deriveStarknetKeyPair({
      r: BigInt(String(accountCreationSig.r)),
      s: BigInt(String(accountCreationSig.s)),
    });
    // Serialize the "AccountRegistration" signature exactly as the web app does.
    const l1Signature = serializeStarknetSignature({
      r: BigInt(String(accountRegistrationSig.r)),
      s: BigInt(String(accountRegistrationSig.s)),
    });

    const time = body.time ?? new Date().toISOString();
    const payload = buildStarknetRegisterPayload({
      wallet,
      l1Signature,
      keyPair,
      host: env.authHost,
      time,
      referralCode: body.referralCode ?? null,
    });

    const result = await registerStarknetWallet(payload, { rememberMe: true });

    const session = createExtendedSession({ wallet, l2Key: keyPair, cookies: result.cookies, status: result.status });

    // Capture account id / vault id so the session can trade and receive on-chain deposits.
    let accountId: number | undefined;
    let vaultId: number | undefined;
    try {
      const client = new ExtendedClient({ env, cookies: result.cookies });
      const info = await client.getAccountInfo();
      accountId = info.accountId;
      vaultId = info.l2Vault;
      updateExtendedSession(session.token, { accountId, vaultId });
    } catch {
      // Account info may not be immediately queryable; session still works once settled.
    }

    return NextResponse.json({
      token: session.token,
      status: result.status,
      wallet,
      accountId,
      vaultId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onboarding failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}