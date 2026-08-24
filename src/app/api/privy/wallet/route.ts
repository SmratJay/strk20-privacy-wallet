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
 * Get (or create) the authenticated user's Starknet embedded wallet.
 *
 * Idempotent: reuses an existing user-owned Starknet wallet if present, otherwise creates
 * one. Returns `{ id, address, publicKey }` — the on-chain Ready account address is DERIVED
 * from `publicKey` client-side (see src/privacy/privy/ready.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const privy = getPrivyServerClient();
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const claims = await privy.verifyAuthToken(token);
    const userId = claims.userId;

    try {
      const user: any = await privy.getUserById(userId);
      const accounts: any[] = user?.linkedAccounts || user?.linked_accounts || [];
      const stark = accounts.find(
        (a: any) =>
          a?.type === "wallet" &&
          (a?.chain_type === "starknet" || a?.chainType === "starknet"),
      );
      if (stark?.id) {
        const wallet: any = await privy.walletApi.getWallet({ id: stark.id });
        return NextResponse.json({ wallet: toWallet(wallet) });
      }
    } catch {
      // If the lookup fails, fall through to creating a wallet.
    }

    const created: any = await privy.walletApi.createWallet({
      chainType: "starknet",
      owner: { userId },
    });
    return NextResponse.json({ wallet: toWallet(created) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "wallet resolution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}