import { NextRequest, NextResponse } from "next/server";
import { getPrivyServerClient } from "@/privacy/privy/server";

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

interface ResolvedWallet {
  id: string;
  address: string;
  publicKey: string;
}

function toWallet(w: any): ResolvedWallet {
  const publicKey = w.public_key ?? w.publicKey ?? "";
  return { id: String(w.id), address: String(w.address ?? ""), publicKey };
}

/**
 * Create a SERVER-MANAGED Starknet wallet for the authenticated user.
 *
 * Server-managed wallets are signed with app-secret Basic auth (no user JWT exchange), which
 * avoids Privy's `user_signers/authenticate` gate ("Invalid JWT token provided" when the
 * user-signer feature is not enabled for the app). The userId -> walletId mapping is kept
 * client-side (encrypted localStorage) since there is no server DB; see the compatibility
 * audit for the DB-backed / user-owned alternative.
 */
export async function POST(req: NextRequest) {
  try {
    const privy = getPrivyServerClient();
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    // Gate on a valid Privy session (prevents anonymous wallet creation). The Starknet
    // wallet itself is created server-managed (no owner), so it is not tied to the user
    // in Privy's model — PEL maintains the mapping.
    await privy.verifyAuthToken(token);

    const created: any = await privy.walletApi.createWallet({ chainType: "starknet" });
    return NextResponse.json({ wallet: toWallet(created) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "wallet creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}