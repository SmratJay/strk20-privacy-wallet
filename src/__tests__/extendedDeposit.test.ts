/**
 * @file src/__tests__/extendedDeposit.test.ts
 * @description Verifies the on-chain USDC deposit calldata for Extended (Starknet-native):
 * approve on the USDC token, then deposit(position_id, quantized_amount, salt) on the
 * core perpetuals contract. The deposit entrypoint/ABI was read live from the mainnet
 * contract class (GET starknet_getClassAt → IDeposit.deposit(position_id, u64, felt)).
 */

import { describe, it, expect } from 'vitest';
import { hash } from 'starknet';
import {
  buildDepositCalldata,
  generateDepositSalt,
  depositSelector,
  approveSelector,
} from '../extended/deposit';
import { getExtendedEnvironment } from '../extended/config';

const env = getExtendedEnvironment();

describe('Extended native USDC deposit calldata', () => {
  it('uses the mainnet deposit contract and USDC token by default', () => {
    const c = buildDepositCalldata('10', 300006, { salt: '123' });
    expect(c.approve.contractAddress).toBe(env.usdcTokenAddress);
    expect(c.deposit.contractAddress).toBe(env.depositContractAddress);
  });

  it('quantizes the amount by the collateral resolution (USDC 6 decimals)', () => {
    const c = buildDepositCalldata('10.25', 300006, { salt: '123' });
    expect(c.quantizedAmount).toBe('10250000');
    expect(c.approve.calldata[1]).toBe('10250000');
    expect(c.deposit.calldata[1]).toBe('10250000');
  });

  it('rounds DOWN fractional amounts below a quantum', () => {
    const c = buildDepositCalldata('0.0000005', 300006, { salt: '123' });
    expect(c.quantizedAmount).toBe('0');
  });

  it('builds the approve calldata as u256 (spender, low, high)', () => {
    const c = buildDepositCalldata('5', 300006, { salt: '123' });
    expect(c.approve.entrypoint).toBe('approve');
    expect(c.approve.calldata).toEqual([env.depositContractAddress, '5000000', '0']);
  });

  it('builds the deposit calldata as (position_id, quantized_amount, salt)', () => {
    const c = buildDepositCalldata('5', 300006, { salt: '42' });
    expect(c.deposit.entrypoint).toBe('deposit');
    expect(c.deposit.calldata).toEqual(['300006', '5000000', '42']);
    expect(c.positionId).toBe('300006');
  });

  it('uses selectors matching the on-chain ABI entrypoints', () => {
    expect(depositSelector()).toBe(BigInt(hash.getSelectorFromName('deposit')).toString());
    expect(approveSelector()).toBe(BigInt(hash.getSelectorFromName('approve')).toString());
    // The on-chain deposit selector is a well-known fixed value.
    expect(BigInt(depositSelector())).toBe(BigInt(hash.getSelectorFromName('deposit')));
  });

  it('generates a random salt felt', () => {
    const a = generateDepositSalt();
    const b = generateDepositSalt();
    expect(a).toMatch(/^\d+$/);
    expect(a).not.toBe(b);
  });
});