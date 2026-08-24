import type { PrivyServerClient } from "./types";

const PRIVY_SERVER_PACKAGE = "@privy-io/server-auth";

let clientPromise: Promise<PrivyServerClient> | null = null;

export function getPrivyServerClient(): Promise<PrivyServerClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const appId = process.env.PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET are not configured.");
    }
    const mod = (await import(/* webpackIgnore: true */ PRIVY_SERVER_PACKAGE)) as {
      PrivyClient: new (cfg: { appId: string; appSecret: string }) => PrivyServerClient;
    };
    return new mod.PrivyClient({ appId, appSecret });
  })();
  return clientPromise;
}
