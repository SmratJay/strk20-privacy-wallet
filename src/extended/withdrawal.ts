/**
 * @file src/extended/withdrawal.ts
 * @description Builds and signs Extended Starknet withdrawal settlements.
 *
 * Ports the official Python SDK's `withdrawal_object.py`:
 *   - `WithdrawArgs` SNIP-12 struct hash (verified against the Rust reference vectors)
 *   - settlement expiration = now + 15 days (ceil to seconds)
 *   - L2 Stark ECDSA signature over poseidon("StarkNet Message", domain, pubkey, hash)
 *
 * The resulting body matches `POST /api/v1/user/withdrawal` exactly (camelCase aliases,
 * HexValue serialization for recipient/collateralId/signature, decimal for amounts).
 */

import { getExtendedEnvironment } from './config';
import type { ExtendedStarknetDomain } from './crypto';
import { withdrawalMessageHash, starkSign } from './crypto';
import { mulDecInt, roundToInt } from './amount';
import { generateNonce } from './settlement';

const WITHDRAWAL_EXPIRATION_BUFFER_DAYS = 15;
const USD_STARKEX_ID = '0x1';
const USD_RESOLUTION = 1_000_000;

export interface WithdrawalRequestInput {
  amount: string;
  /** Asset symbol to withdraw. Defaults to the collateral asset (USD). */
  asset?: string;
  vaultId: number;
  privateKey: string;
  publicKey: string;
  accountId?: number;
  domain: ExtendedStarknetDomain;
  recipient?: string;
  expirationSeconds?: number;
  salt?: number;
  chainId?: string;
}

export interface WithdrawalRequestResult {
  withdrawalHash: bigint;
  request: Record<string, unknown>;
  /** Signed Stark quantities (for debugging). */
  starkAmount: bigint;
  expirationSeconds: number;
  salt: number;
}

/** Compute the settlement expiration timestamp (epoch seconds) = now + 15 days. */
export function withdrawalExpiration(nowMs = Date.now()): number {
  const bufferedMs =
    BigInt(nowMs) + BigInt(WITHDRAWAL_EXPIRATION_BUFFER_DAYS) * 86_400_000n;
  return Number((bufferedMs + 999n) / 1000n); // ceil to seconds
}

/** Build and sign a `POST /api/v1/user/withdrawal` body for a Starknet withdrawal. */
export function buildWithdrawalRequest(input: WithdrawalRequestInput): Record<string, unknown> {
  const {
    amount,
    asset = 'USD',
    vaultId,
    privateKey,
    publicKey,
    domain,
  } = input;

  const starkAmount = roundToInt(mulDecInt(amount, USD_RESOLUTION), 'DOWN');
  const expirationSeconds = input.expirationSeconds ?? withdrawalExpiration();
  const salt = input.salt ?? generateNonce();
  const recipient = input.recipient ?? '';

  if (!recipient) {
    throw new Error('A Starknet recipient address is required to build a withdrawal.');
  }

  const withdrawalHash = withdrawalMessageHash(
    {
      recipient,
      positionId: vaultId,
      collateralId: USD_STARKEX_ID,
      amount: starkAmount,
      expiration: BigInt(expirationSeconds),
      salt: BigInt(salt),
    },
    publicKey,
    domain,
  );

  const { r, s } = starkSign(withdrawalHash, privateKey);

  const request = {
    accountId: input.accountId ?? vaultId,
    amount,
    description: undefined,
    chainId: input.chainId ?? 'STRK',
    asset,
    settlement: {
      recipient,
      positionId: vaultId,
      collateralId: USD_STARKEX_ID,
      amount: starkAmount.toString(),
      expiration: { seconds: expirationSeconds },
      salt,
      signature: { r, s },
    },
  };
  // Drop undefined keys (matches the SDK's exclude_none serialization).
  for (const key of Object.keys(request) as (keyof typeof request)[]) {
    if (request[key] === undefined) delete request[key];
  }

  return request;
}

/** Convenience: build the withdrawal settlement for the current environment. */
export function buildWithdrawalForEnvironment(input: Omit<WithdrawalRequestInput, 'domain'>): Record<string, unknown> {
  return buildWithdrawalRequest({ ...input, domain: getExtendedEnvironment().starknetDomain });
}