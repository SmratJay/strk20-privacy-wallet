import type { PrivySigningClient } from "./types";

export function normalizeStarkPublicKey(publicKey: unknown): string {
  if (publicKey === undefined || publicKey === null || publicKey === "") {
    throw new Error("Privy Starknet wallet returned no public key.");
  }
  const raw = String(publicKey);
  if (/^0x/i.test(raw)) return raw;
  return "0x" + BigInt(raw).toString(16);
}

/**
 * Decode a Privy `raw_sign` Starknet signature into `[r, s]`.
 *
 * Documented + live-verified format: the response is `{ data: { signature: "0x…", encoding: "hex" } }`
 * where the signature is a single 64-byte hex string (128 hex chars) encoding `r || s`,
 * each 32 bytes, big-endian. Split in half after stripping `0x`.
 */
export function normalizePrivySignature(sig: unknown): [string, string] {
  if (typeof sig !== "string" || sig === "") {
    throw new Error("Privy raw_sign returned a non-hex signature.");
  }
  const body = /^0x/i.test(sig) ? sig.slice(2) : sig;
  if (body.length !== 128) {
    throw new Error(`Unrecognized Privy Starknet signature length (${body.length} hex chars).`);
  }
  return ["0x" + body.slice(0, 64), "0x" + body.slice(64, 128)];
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
