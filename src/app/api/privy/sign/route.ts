import { NextRequest, NextResponse } from "next/server";
import { getPrivyServerClient } from "@/privacy/privy/server";

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function POST(req: NextRequest) {
  try {
    const privy = await getPrivyServerClient();
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

    const result = await privy.wallets().rawSign(walletId, { params: { hash } });
    return NextResponse.json({ signature: result.signature });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "signing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
