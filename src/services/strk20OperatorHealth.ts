/**
 * @file src/services/strk20OperatorHealth.ts
 * @description Deterministic STRK20 operator-infrastructure health check.
 *
 * The real STRK20 shield/unshield/private-invoke path depends on two operator-side
 * services (see infra/strk20-operator/README.md):
 *   - Transaction prover  (NEXT_PUBLIC_STRK20_PROVER_URL)     — Stwo validity proofs
 *   - Discovery service   (NEXT_PUBLIC_STRK20_DISCOVERY_URL)  — note/channel indexer
 *
 * The app uses this module to report honest infrastructure status: HEALTHY, UNCONFIGURED,
 * or UNAVAILABLE. It NEVER silently fabricates privacy behavior when the operator is
 * missing — the UI surfaces the exact state and fails closed for privacy operations.
 */

import { normalizeEndpointUrl } from '@/config/networks';

export interface Strk20OperatorStatus {
  proverConfigured: boolean;
  discoveryConfigured: boolean;
  proverReachable: boolean;
  discoveryReachable: boolean;
  sdkAvailable: boolean;
  healthy: boolean;
}

function isNonEmpty(v: string | undefined): boolean {
  return !!v && v.trim().length > 0 && !v.includes('your-prover') && !v.includes('your-discovery');
}

export async function checkStrk20OperatorStatus(): Promise<Strk20OperatorStatus> {
  const proverUrl = normalizeEndpointUrl(process.env.NEXT_PUBLIC_STRK20_PROVER_URL);
  const discoveryUrl = normalizeEndpointUrl(process.env.NEXT_PUBLIC_STRK20_DISCOVERY_URL);

  const proverConfigured = isNonEmpty(proverUrl);
  const discoveryConfigured = isNonEmpty(discoveryUrl);

  let proverReachable = false;
  let discoveryReachable = false;

  if (proverConfigured) {
    const proverBaseUrl = proverUrl as string;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      // The transaction prover is a JSON-RPC endpoint — its health is
      // `starknet_specVersion`, NOT `GET /health` (which is the discovery service's
      // health check). The SDK's ProvingService.isHealthy() calls starknet_specVersion.
      const res = await fetch(proverBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'starknet_specVersion', params: [] }),
        signal: controller.signal,
      });
      clearTimeout(t);
      proverReachable = res.ok;
    } catch {
      proverReachable = false;
    }
  }

  if (discoveryConfigured) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${discoveryUrl}/health`, { signal: controller.signal });
      clearTimeout(t);
      discoveryReachable = res.ok;
    } catch {
      discoveryReachable = false;
    }
  }

  let sdkAvailable = true;
  try {
    const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as Record<string, unknown>;
    sdkAvailable = typeof mod?.createPrivateTransfers === 'function';
  } catch {
    sdkAvailable = false;
  }

  return {
    proverConfigured,
    discoveryConfigured,
    proverReachable,
    discoveryReachable,
    sdkAvailable,
    healthy: proverConfigured && discoveryConfigured && proverReachable && discoveryReachable && sdkAvailable,
  };
}

/** Short human label for the status (used by the UI without leaking URLs). */
export function operatorStatusLabel(s: Strk20OperatorStatus): 'HEALTHY' | 'UNAVAILABLE' | 'UNCONFIGURED' {
  if (!s.proverConfigured || !s.discoveryConfigured || !s.sdkAvailable) return 'UNCONFIGURED';
  if (!s.proverReachable || !s.discoveryReachable) return 'UNAVAILABLE';
  return 'HEALTHY';
}