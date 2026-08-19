/**
 * @file relayerSecurity.ts
 * @description Security validation, calldata schemas, rate limiting, and allowlist guards for the PEL Relayer Execution service
 */

import { Call } from 'starknet';
import { PERPS_DEPLOYMENTS } from './starknetPerpsDispatcher';

export const ALLOWED_ENTRYPOINTS = [
  'open_position',
  'close_position',
  'liquidate_position',
  'claim_keeper_bounty',
] as const;

export const ENTRYPOINT_CALLDATA_SCHEMAS: Record<string, { expectedLength: number; fieldNames: string[] }> = {
  open_position: {
    expectedLength: 5,
    fieldNames: ['market_id', 'commitment', 'margin_nullifier', 'margin_amount', 'fact_hash'],
  },
  close_position: {
    expectedLength: 6,
    fieldNames: ['market_id', 'commitment', 'final_nullifier', 'payout_commitment', 'payout_amount', 'fact_hash'],
  },
  liquidate_position: {
    expectedLength: 5,
    fieldNames: ['market_id', 'commitment', 'nullifier', 'fact_hash', 'keeper_recipient'],
  },
  claim_keeper_bounty: {
    expectedLength: 1,
    fieldNames: ['note_commitment'],
  },
};

// In-memory sliding window rate limiter (max 20 requests per 60 seconds per identifier)
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

// Anti-replay fingerprint store
const executedSignatures = new Set<string>();

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

export function checkRateLimit(clientId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = rateLimitMap.get(clientId) || [];
  const validTimestamps = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    rateLimitMap.set(clientId, validTimestamps);
    return { allowed: false, remaining: 0 };
  }

  validTimestamps.push(now);
  rateLimitMap.set(clientId, validTimestamps);
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - validTimestamps.length };
}

export function validateRelayerCalls(
  calls: Call[],
  clientId: string = 'default_client'
): { isValid: boolean; error?: string } {
  if (!Array.isArray(calls) || calls.length === 0) {
    return { isValid: false, error: 'INVALID_CALLS: Array must be non-empty' };
  }

  // Check rate limit
  const rate = checkRateLimit(clientId);
  if (!rate.allowed) {
    return { isValid: false, error: 'RATE_LIMIT_EXCEEDED: Maximum 20 requests per minute exceeded' };
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

    // Validate exact calldata schema (Workstream J)
    const schema = ENTRYPOINT_CALLDATA_SCHEMAS[entrypoint];
    if (schema) {
      if (call.calldata.length !== schema.expectedLength) {
        return {
          isValid: false,
          error: `SCHEMA_MISMATCH: Entrypoint '${entrypoint}' requires exactly ${schema.expectedLength} parameters (${schema.fieldNames.join(
            ', '
          )}), received ${call.calldata.length}`,
        };
      }

      // Ensure every parameter is a valid non-empty string / felt
      for (let i = 0; i < call.calldata.length; i++) {
        const item = call.calldata[i];
        if (item === undefined || item === null || item === '') {
          return {
            isValid: false,
            error: `INVALID_CALLDATA_ITEM: Parameter '${schema.fieldNames[i]}' at index ${i} is empty`,
          };
        }
      }
    }
  }

  return { isValid: true };
}
