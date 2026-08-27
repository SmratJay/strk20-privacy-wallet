/**
 * @file tests/helpers/legacyFactModel.ts
 * @description Isolated Legacy Fact Model Helper for Invariant Mock Tests (Audit Section 9 & P0-03)
 *
 * NOTE: This is strictly for legacy mock test assertions.
 * Production execution ONLY uses typed fact builders in zkProverService.ts.
 */

import { hash, num } from 'starknet';
import { ProofType, TransitionFact } from '../../src/services/zkProverService';

export function computeLegacyPublicInputsHash(
  proofType: ProofType,
  marketId: string,
  commitment: string,
  nullifier: string,
  amountCents: bigint,
  oraclePriceCents: bigint,
  recipientOrCaller: string = '0x0'
): string {
  const proofTypeFelt = '0x' + Buffer.from(proofType).toString('hex');
  const marketFelt = '0x' + Buffer.from(marketId).toString('hex');
  return hash.computePoseidonHashOnElements([
    proofTypeFelt,
    marketFelt,
    commitment,
    nullifier,
    num.toHex(amountCents),
    num.toHex(oraclePriceCents),
    recipientOrCaller || '0x0',
  ]);
}

export function computeLegacyFactHash(publicInputsHash: string): string {
  return hash.computePoseidonHashOnElements([publicInputsHash, '0x5354574f5f534e495033365f50524f4f465f5632']);
}

export function buildLegacyFact(
  proofType: ProofType,
  marketId: string,
  commitment: string,
  nullifier: string,
  amountCents: bigint,
  oraclePriceCents: bigint,
  recipientOrCaller: string = '0x0'
): TransitionFact {
  const publicInputsHash = computeLegacyPublicInputsHash(
    proofType,
    marketId,
    commitment,
    nullifier,
    amountCents,
    oraclePriceCents,
    recipientOrCaller
  );
  const factHash = computeLegacyFactHash(publicInputsHash);

  return {
    proofType,
    factHash,
    publicInputsHash,
    commitment,
    nullifier,
    amountCents,
    oraclePriceCents,
    timestamp: Date.now(),
  };
}
