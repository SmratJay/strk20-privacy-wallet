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
 * Get (or create) the authenticated user's SERVER-MANAGED Starknet wallet.
 *
 * Stable per user: the walletId is recorded in the Privy user's custom metadata
 * (`starknetWalletId`), so every session/device for the same Google account resolves the SAME
 * wallet. (Previously a new wallet was minted each time the client cache was missing — hence
 * duplicate wallets in the Privy dashboard.) Signing uses app-secret Basic auth, avoiding the
 * user-signer gate.
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

    // 1) Reuse the user's existing wallet (stable mapping in Privy custom metadata).
    try {
      const user: any = await privy.getUserById(userId);
      const walletId = user?.customMetadata?.starknetWalletId;
      if (typeof walletId === "string" && walletId) {
        const wallet: any = await privy.walletApi.getWallet({ id: walletId });
        if (wallet?.id) return NextResponse.json({ wallet: toWallet(wallet) });
      }
    } catch {
      // Lookup failed — fall through to create.
    }

    // 2) Create a server-managed Starknet wallet and record the mapping.
    const created: any = await privy.walletApi.createWallet({ chainType: "starknet" });
    try {
      await privy.setCustomMetadata(userId, { starknetWalletId: String(created.id) });
    } catch {
      // Metadata write is best-effort; the wallet is still returned and cached client-side.
    }
    return NextResponse.json({ wallet: toWallet(created) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "wallet resolution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}