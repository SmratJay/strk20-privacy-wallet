/**
 * @file relayerSecurity.ts
 * @description Security validation and allowlist guards for the PEL Relayer Execution service
 */

import { Call } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';

export const ALLOWED_ENTRYPOINTS = [
  'open_position',
  'close_position',
  'liquidate_position',
  'claim_keeper_bounty',
] as const;

export function getAllowlistedContracts(): Set<string> {
  const allowed = new Set<string>();

  const sepoliaConfig = PERPS_DEPLOYMENTS.sepolia;
  if (sepoliaConfig.pelCoreAddress) allowed.add(sepoliaConfig.pelCoreAddress.toLowerCase());
  if (sepoliaConfig.strk20AdapterAddress) allowed.add(sepoliaConfig.strk20AdapterAddress.toLowerCase());

  if (process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA) {
    allowed.add(process.env.NEXT_PUBLIC_PEL_CORE_SEPOLIA.toLowerCase());
  }
  if (process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA) {
    allowed.add(process.env.NEXT_PUBLIC_STRK20_ADAPTER_SEPOLIA.toLowerCase());
  }

  return allowed;
}

export function validateRelayerCalls(calls: Call[]): { isValid: boolean; error?: string } {
  if (!Array.isArray(calls) || calls.length === 0) {
    return { isValid: false, error: 'INVALID_CALLS: Array must be non-empty' };
  }

  const allowedContracts = getAllowlistedContracts();

  for (const call of calls) {
    const target = call.contractAddress?.toLowerCase();
    if (!target || !allowedContracts.has(target)) {
      return {
        isValid: false,
        error: `UNAUTHORIZED_CONTRACT: Relayer will not execute calls to ${call.contractAddress}`,
      };
    }

    const entrypoint = call.entrypoint;
    if (!ALLOWED_ENTRYPOINTS.includes(entrypoint as any)) {
      return {
        isValid: false,
        error: `UNAUTHORIZED_SELECTOR: Entrypoint '${entrypoint}' is not in relayer allowlist`,
      };
    }

    if (!Array.isArray(call.calldata)) {
      return { isValid: false, error: `MALFORMED_CALLDATA: calldata must be an array for ${entrypoint}` };
    }
  }

  return { isValid: true };
}
