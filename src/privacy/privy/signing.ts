import type { PrivySigningClient } from "./types";

export function normalizeStarkPublicKey(publicKey: unknown): string {
  if (publicKey === undefined || publicKey === null || publicKey === "") {
    throw new Error("Privy Starknet wallet returned no public key.");
  }
  const raw = String(publicKey);
  if (/^0x/i.test(raw)) return raw;
  return "0x" + BigInt(raw).toString(16);
}

function toHexValue(v: string | bigint | number): string {
  if (typeof v === "string") return /^0x/i.test(v) ? v : "0x" + BigInt(v).toString(16);
  return "0x" + BigInt(v).toString(16);
}

export function normalizePrivySignature(sig: unknown): [string, string] {
  if (Array.isArray(sig)) {
    if (sig.length >= 2) return [String(sig[0]), String(sig[1])];
    throw new Error("Privy signature array has fewer than 2 elements.");
  }
  if (sig && typeof sig === "object") {
    const o = sig as { r?: unknown; s?: unknown };
    if (o.r !== undefined && o.r !== null && o.s !== undefined && o.s !== null) {
      return [toHexValue(o.r as string | bigint | number), toHexValue(o.s as string | bigint | number)];
    }
  }
  if (typeof sig === "string") {
    return splitHexSignature(sig);
  }
  throw new Error("Unsupported Privy signature format.");
}

function splitHexSignature(hex: string): [string, string] {
  const h = /^0x/i.test(hex) ? hex.slice(2) : hex;
  if (h.length === 128) {
    return ["0x" + h.slice(0, 64), "0x" + h.slice(64, 128)];
  }
  if (h.length === 130) {
    return ["0x" + h.slice(0, 64), "0x" + h.slice(64, 128)];
  }
  throw new Error(`Unrecognized Privy signature length (${h.length} hex chars).`);
}

export function fetchSigningClient(
  serverUrl: string,
  getAccessToken?: () => Promise<string | null>,
): PrivySigningClient {
  return {
    async signHash(walletId: string, hashHex: string): Promise<unknown> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (getAccessToken) {
        const token = await getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(serverUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ walletId, hash: hashHex }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Privy signing endpoint failed (${res.status}): ${body}`);
      }
      const json = (await res.json()) as { signature?: unknown };
      if (!json || json.signature === undefined) {
        throw new Error("Privy signing endpoint returned no signature.");
      }
      return json.signature;
    },
  };
}
