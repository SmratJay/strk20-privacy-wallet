/**
 * @file src/extended/walletStatus.ts
 * @description On-chain Starknet wallet checks used to make native Extended onboarding
 * robust. Server-only — reads the mainnet RPC server-side so no RPC key ever needs to
 * reach the browser.
 *
 * Extended verifies the connected Starknet wallet on-chain (the account's
 * `is_valid_signature`), so a wallet that is not yet deployed on Starknet Mainnet cannot
 * onboard. We surface that cleanly BEFORE asking the user to sign anything.
 */

import { getNetworkConfig } from '@/config/networks';

/** Resolve the Starknet Mainnet RPC URL used for deployment checks. */
export function getExtendedRpcUrl(): string {
  const mainnet = getNetworkConfig('mainnet');
  for (const url of mainnet.rpcUrls) {
    if (url && url.length > 0) return url;
  }
  return 'https://api.cartridge.gg/x/starknet/mainnet';
}

export interface WalletDeploymentStatus {
  deployed: boolean;
  classHash?: string;
  /** True when the RPC call itself failed (network / node error) — not "not deployed". */
  unknown?: boolean;
  rpcError?: string;
}

/**
 * Check whether a Starknet account is deployed on Mainnet by reading its class hash.
 * A `ContractNotFound` (code 20) means "not deployed"; any other error is reported as
 * `unknown` so callers never confuse a node outage with a non-deployed wallet.
 */
export async function checkWalletDeployment(
  address: string,
  opts?: { rpcUrl?: string; fetchFn?: typeof fetch },
): Promise<WalletDeploymentStatus> {
  const rpcUrl = opts?.rpcUrl ?? getExtendedRpcUrl();
  const fetcher = opts?.fetchFn ?? fetch;
  if (!/^0x[0-9a-fA-F]{2,64}$/.test(address)) {
    return { deployed: false, unknown: true, rpcError: 'Invalid Starknet address.' };
  }

  try {
    const res = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'starknet_getClassHashAt',
        params: ['latest', address],
      }),
    });
    if (!res.ok) return { deployed: false, unknown: true, rpcError: `RPC HTTP ${res.status}` };
    const json = (await res.json()) as {
      result?: { class_hash?: string } | string;
      error?: { code?: number; message?: string };
    };
    if (json.error) {
      const code = Number(json.error.code);
      if (code === 20) return { deployed: false }; // ContractNotFound
      return { deployed: false, unknown: true, rpcError: json.error.message };
    }
    const classHash =
      typeof json.result === 'string'
        ? json.result
        : json.result?.class_hash;
    if (!classHash) return { deployed: false, unknown: true, rpcError: 'Empty class hash response.' };
    return { deployed: true, classHash };
  } catch (err) {
    return {
      deployed: false,
      unknown: true,
      rpcError: err instanceof Error ? err.message : 'RPC request failed.',
    };
  }
}