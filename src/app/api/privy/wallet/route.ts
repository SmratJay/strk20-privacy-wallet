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
    const claims = await privy.verifyAuthToken(token);

    const wallet = await privy.wallets().create({
      chain_type: "starknet",
      user_id: claims.userId,
    });

    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        publicKey: wallet.public_key ?? wallet.publicKey ?? null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "wallet creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
