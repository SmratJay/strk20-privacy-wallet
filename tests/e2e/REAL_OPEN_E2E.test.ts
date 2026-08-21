/**
 * @file tests/e2e/REAL_OPEN_E2E.test.ts
 * @description Authoritative Real OPEN E2E On-Chain Pipeline Test Suite
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RpcProvider, hash, uint256 } from 'starknet';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../../src/services/starknetPerpsDispatcher';
import { generateOwnerSecret, generateNonce, saveWitness, loadWitness } from '../../src/protocol/witnessStore';
import { bn254ToStorageKey, BN254_R } from '../../src/protocol/canonical';
import { executeRealOpenPipeline, RealOpenExecutionResult } from '../../scripts/deploy_open_e2e';
import * as fs from 'fs';
import * as garaga from 'garaga';
import * as path from 'path';

describe('Authoritative Real OPEN E2E On-Chain Pipeline', () => {
  let executionResult: RealOpenExecutionResult;

  beforeAll(async () => {
    await garaga.init();
    executionResult = await executeRealOpenPipeline();
  }, 120000);

  it('STEP 1: Generates real Groth16 proof with valid public signals layout', () => {
    expect(executionResult.proof.signals.length).toBe(5);
    expect(executionResult.proof.signals[2]).toBe(BigInt('0x4254432d50455250').toString());
    expect(executionResult.proof.signals[3]).toBe('500000');
  });

  it('STEP 2: Generates real 1992-felt Garaga BN254 calldata for on-chain verifier', () => {
    expect(executionResult.proof.calldataLength).toBe(1992);
  });

  it('STEP 3: Submits and confirms real Starknet transaction with status SUCCEEDED', () => {
    expect(executionResult.transaction.transactionHash).toMatch(/^0x[0-9a-fA-F]+/);
    expect(['SUCCEEDED', 'ACCEPTED_ON_L2']).toContain(executionResult.transaction.status);
  });

  it('STEP 4: Verifies real collateral movement on-chain ($5,000.00 USDC locked)', () => {
    expect(BigInt(executionResult.collateral.collateralMovedUnits)).toBe(5000000000n);
    expect(BigInt(executionResult.collateral.balanceBefore) - BigInt(executionResult.collateral.balanceAfter)).toBe(5000000000n);
  });

  it('STEP 5: Verifies active position record in PELPerpsCore on-chain storage', () => {
    expect(executionResult.position.isActive).toBe(true);
    expect(executionResult.position.marketId).toBe('BTC-PERP');
    expect(executionResult.position.lockedMargin).toBe('500000');
  });

  it('STEP 6 (Adversarial): Proves replay attack reverts on-chain (NULLIFIER_ALREADY_SPENT)', () => {
    expect(executionResult.attacks.replayReverted).toBe(true);
  });

  it('STEP 7 (Adversarial): Proves tampered commitment reverts on-chain', () => {
    expect(executionResult.attacks.tamperedCommitmentReverted).toBe(true);
  });

  it('STEP 8 (Adversarial): Proves tampered margin claim reverts on-chain', () => {
    expect(executionResult.attacks.tamperedMarginReverted).toBe(true);
  });

  it('STEP 9: Verifies encrypted client witness storage persistence', async () => {
    const loaded = await loadWitness(executionResult.accounts.trader, executionResult.proof.commitment, '');
    expect(loaded).not.toBeNull();
    expect(loaded?.marketId).toBe('BTC-PERP');
    expect(loaded?.marginCents).toBe(500000n);
  });
});
