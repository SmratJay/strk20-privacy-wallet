import { PrivyClient } from "@privy-io/server-auth";

let client: PrivyClient | null = null;

export function getPrivyServerClient(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("PRIVY_APP_ID and PRIVY_APP_SECRET are not configured.");
  }
  client = new PrivyClient(appId, appSecret);
  return client;
}