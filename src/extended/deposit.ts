/**
 * @file src/extended/deposit.ts
 * @description Builds the on-chain USDC deposit calldata for Extended (Starknet-native).
 *
 * For Starknet wallets, Extended accepts deposits by invoking the core perpetuals
 * contract (see GET /info/settings → starknetContractAddress):
 *
 *   1. approve(spender = depositContract, amount = quantizedAmount) on the USDC token
 *   2. deposit(position_id = l2Vault, quantized_amount, salt) on the deposit contract
 *
 * The `position_id` is the account's L2 vault id (from GET /user/account/info →
 * `l2Vault`). `quantized_amount` is the human amount × collateral resolution (1e6 for
 * USDC). `salt` is a random felt. These calls are executed by the connected Starknet
 * wallet; no server credential is involved.
 */

import { hash } from 'starknet';
import { getExtendedEnvironment } from './config';
import { mulDecInt, roundToInt } from './amount';
import type { DepositCalldata } from './types';

function getSelector(name: string): string {
  return BigInt(hash.getSelectorFromName(name)).toString();
}

/** Generate a random felt salt (bounded, deterministic-friendly). */
export function generateDepositSalt(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return BigInt('0x' + Buffer.from(bytes).toString('hex')).toString();
}

/**
 * Build the approve + deposit calldata for a native Starknet USDC deposit.
 *
 * @param amount Human-readable USDC amount (decimal string, e.g. "10.5").
 * @param positionId The Extended account's L2 vault id (number).
 * @param opts Optional overrides for contract addresses / resolution / salt.
 */
export function buildDepositCalldata(
  amount: string,
  positionId: number | string,
  opts?: {
    depositContract?: string;
    usdcToken?: string;
    collateralResolution?: number;
    salt?: string;
  },
): DepositCalldata {
  const env = getExtendedEnvironment();
  const depositContract = opts?.depositContract ?? env.depositContractAddress;
  const usdcToken = opts?.usdcToken ?? env.usdcTokenAddress;
  const resolution = opts?.collateralResolution ?? 1_000_000;
  const salt = opts?.salt ?? generateDepositSalt();

  const quantizedAmount = roundToInt(mulDecInt(amount, resolution), 'DOWN').toString();

  return {
    approve: {
      contractAddress: usdcToken,
      entrypoint: 'approve',
      calldata: [
        depositContract,
        quantizedAmount,
        '0', // u256 high word
      ],
    },
    deposit: {
      contractAddress: depositContract,
      entrypoint: 'deposit',
      calldata: [
        String(positionId),
        quantizedAmount,
        salt,
      ],
    },
    quantizedAmount,
    amount,
    salt,
    positionId: String(positionId),
  };
}

/** Selector for the deposit entrypoint (exported for tests). */
export function depositSelector(): string {
  return getSelector('deposit');
}

/** Selector for the approve entrypoint (exported for tests). */
export function approveSelector(): string {
  return getSelector('approve');
}