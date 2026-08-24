import { NextRequest, NextResponse } from "next/server";
import { generateAuthorizationSignature } from "@privy-io/server-auth/wallet-api";
import { getPrivyServerClient } from "@/privacy/privy/server";

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Privy `raw_sign` for a USER-OWNED Starknet wallet.
 *
 * Follows the official starknet-privy-demo flow: verify the user JWT, generate a user
 * authorization key, sign the request with `generateAuthorizationSignature`, and call the
 * Wallet API raw_sign REST endpoint. Returns the raw 64-byte hex signature (r||s).
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

    const { authorizationKey } = await privy.walletApi.generateUserSigner({ userJwt: token });
    const url = `https://api.privy.io/v1/wallets/${walletId}/raw_sign`;
    const requestBody = { params: { hash } };
    const authorizationSignature = generateAuthorizationSignature({
      input: {
        version: 1,
        method: "POST",
        url,
        body: requestBody,
        headers: { "privy-app-id": appId },
      },
      authorizationPrivateKey: authorizationKey,
    });
    if (!authorizationSignature) {
      throw new Error("Failed to build Privy authorization signature.");
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "privy-app-id": appId,
        "privy-authorization-signature": authorizationSignature,
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = (await resp.json().catch(() => null)) as { data?: { signature?: unknown }; signature?: unknown } | null;
    const signature = data?.data?.signature ?? data?.signature;
    if (!resp.ok || typeof signature !== "string") {
      const message = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(message);
    }
    return NextResponse.json({ signature });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "signing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}