import { NextRequest, NextResponse } from "next/server";
import { getPrivyServerClient } from "@/privacy/privy/server";

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Privy `raw_sign` for a SERVER-MANAGED Starknet wallet.
 *
 * Signs the hash with app-secret Basic auth only (no user-JWT authorization exchange), so it
 * works without Privy enabling the `user_signers/authenticate` feature. Returns the raw
 * 64-byte hex signature (r||s). The caller must present a valid Privy session token (gate),
 * and should only ever pass its own walletId.
 */
export async function POST(req: NextRequest) {
  try {
    const privy = getPrivyServerClient();
    const appId = process.env.PRIVY_APP_ID as string;
    const appSecret = process.env.PRIVY_APP_SECRET as string;

    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    await privy.verifyAuthToken(token);

    const body = (await req.json().catch(() => null)) as { walletId?: unknown; hash?: unknown } | null;
    const walletId = body?.walletId;
    const hash = body?.hash;
    if (typeof walletId !== "string" || typeof hash !== "string") {
      return NextResponse.json({ error: "walletId and hash are required" }, { status: 400 });
    }

    const url = `https://api.privy.io/v1/wallets/${walletId}/raw_sign`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "privy-app-id": appId,
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ params: { hash } }),
    });
    const data = (await resp.json().catch(() => null)) as { data?: { signature?: unknown }; signature?: unknown; error?: { message?: string } } | null;
    const signature = data?.data?.signature ?? data?.signature;
    if (!resp.ok || typeof signature !== "string") {
      const message = data?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(message);
    }
    return NextResponse.json({ signature });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "signing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}