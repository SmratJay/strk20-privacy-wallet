/**
 * @file src/__tests__/extendedWithdrawal.test.ts
 * @description Verifies the Starknet withdrawal request builder (signed server-side),
 * matching the official Python SDK (`withdrawal_object.py`) and docs wire format:
 *   POST /api/v1/user/withdrawal with accountId/amount/chainId/asset + settlement
 *   {recipient, positionId, collateralId, amount, expiration{seconds}, salt, signature}.
 */

import { describe, it, expect } from 'vitest';
import { buildWithdrawalRequest, withdrawalExpiration } from '../extended/withdrawal';
import { ec } from 'starknet';

const DOMAIN = { name: 'Perpetuals', version: 'v0', chainId: 'SN_MAIN', revision: 1 };
const PRIV = '0x' + Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString('hex');
const PUB = ec.starkCurve.getStarkKey(PRIV);
const VAULT = 300006;
const RECIPIENT = '0x019ec96d4aea6fdc6f0b5f393fec3f186aefa8f0b8356f43d07b921ff48aa5da';

describe('Extended Starknet withdrawal request', () => {
  it('builds the documented request shape', () => {
    const req = buildWithdrawalRequest({
      amount: '2',
      vaultId: VAULT,
      accountId: 100006,
      privateKey: PRIV,
      publicKey: PUB,
      recipient: RECIPIENT,
      domain: DOMAIN,
      expirationSeconds: 1755690249,
      salt: 93763903,
    }) as Record<string, any>;

    expect(req.accountId).toBe(100006);
    expect(req.amount).toBe('2');
    expect(req.chainId).toBe('STRK');
    expect(req.asset).toBe('USD');
    expect(req.settlement.positionId).toBe(VAULT);
    expect(req.settlement.collateralId).toBe('0x1');
    expect(req.settlement.amount).toBe('2000000'); // 2 * 1e6
    expect(req.settlement.expiration).toEqual({ seconds: 1755690249 });
    expect(req.settlement.salt).toBe(93763903);
    expect(req.settlement.recipient).toBe(RECIPIENT);
    expect(req.settlement.signature).toHaveProperty('r');
    expect(req.settlement.signature).toHaveProperty('s');
    expect(String(req.settlement.signature.r)).toMatch(/^0x/);
  });

  it('quantizes the amount by the USDC resolution', () => {
    const req = buildWithdrawalRequest({
      amount: '0.5',
      vaultId: VAULT,
      accountId: VAULT,
      privateKey: PRIV,
      publicKey: PUB,
      recipient: RECIPIENT,
      domain: DOMAIN,
      expirationSeconds: 1755690249,
      salt: 1,
    }) as Record<string, any>;
    expect(req.settlement.amount).toBe('500000');
  });

  it('rounds fractional quanta DOWN (never over-withdraws)', () => {
    const req = buildWithdrawalRequest({
      amount: '1.0000009',
      vaultId: VAULT,
      accountId: VAULT,
      privateKey: PRIV,
      publicKey: PUB,
      recipient: RECIPIENT,
      domain: DOMAIN,
      expirationSeconds: 1755690249,
      salt: 1,
    }) as Record<string, any>;
    expect(req.settlement.amount).toBe('1000000');
  });

  it('computes the settlement expiration = now + 15 days (ceil seconds)', () => {
    const now = 1755690000000;
    const exp = withdrawalExpiration(now);
    expect(exp).toBe(1755690000 + 15 * 86400);
  });

  it('requires a recipient', () => {
    expect(() =>
      buildWithdrawalRequest({
        amount: '2',
        vaultId: VAULT,
        accountId: VAULT,
        privateKey: PRIV,
        publicKey: PUB,
        domain: DOMAIN,
      }),
    ).toThrow('recipient');
  });

  it('signs the same hash deterministically for identical inputs', () => {
    const opts = {
      amount: '2',
      vaultId: VAULT,
      accountId: VAULT,
      privateKey: PRIV,
      publicKey: PUB,
      recipient: RECIPIENT,
      domain: DOMAIN,
      expirationSeconds: 1755690249,
      salt: 93763903,
    };
    const a = buildWithdrawalRequest(opts) as Record<string, any>;
    const b = buildWithdrawalRequest(opts) as Record<string, any>;
    expect(a.settlement.signature).toEqual(b.settlement.signature);
  });
});