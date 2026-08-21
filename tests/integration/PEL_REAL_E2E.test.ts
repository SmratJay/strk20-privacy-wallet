import { describe, it, expect } from 'vitest';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../../src/services/starknetPerpsDispatcher';
import { generateOwnerSecret, generateNonce, saveWitness, loadWitness, updateWitness, deleteWitness } from '../../src/protocol/witnessStore';
import { bn254ToStorageKey } from '../../src/protocol/canonical';

describe('Authoritative Real E2E State Machine Lifecycle (Audit Section 17)', () => {
  const traderAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const marketId = 'BTC-PERP';

  it('Executes authoritative full lifecycle: OPEN -> UPDATE -> FUND -> UPDATE -> CLOSE', async () => {
    // ─── 1. SETUP: Trader Generates Private Secret & Position Parameters ───
    const ownerSecretHex = generateOwnerSecret();
    const ownerSecret = BigInt(ownerSecretHex);
    const nonce0Hex = generateNonce();
    const nonce0 = BigInt(nonce0Hex);

    const quantitySats = 100000000n; // 1.0 BTC
    const entryPriceCents = 9500000n; // ,000.00
    const marginCents = 500000n; // ,000.00 (19x leverage on k)

    // ─── 2. TRANSITION 1: OPEN POSITION ────────────────────────────────────
    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      nonce: nonce0,
      ownerSecret,
    });

    expect(openProof.publicSignals.length).toBe(5);
    const commitment0 = '0x' + openProof.commitment.toString(16);
    const nullifier0 = '0x' + openProof.nullifier.toString(16);
    const storageKey0 = bn254ToStorageKey(openProof.commitment);

    // Save witness in encrypted store
    await saveWitness(traderAddress, {
      protocolVersion: 3,
      marketId,
      side: 'LONG',
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      feesCents: 0n,
      nonce: nonce0Hex,
      ownerSecret: ownerSecretHex,
      commitment: commitment0,
      nullifier: nullifier0,
      openedAtMs: Date.now(),
    }, '');

    const openCall = starknetPerpsDispatcher.buildOpenPositionCall(
      traderAddress,
      marketId,
      5000,
      openProof.calldata || [4n, openProof.commitment, openProof.nullifier, 0x4254432d50455250n, marginCents]
    );
    expect(openCall.entrypoint).toBe('open_position');
    expect(openCall.contractAddress).toBe(PERPS_DEPLOYMENTS.sepolia.pelCoreAddress);

    // Verify proof cryptographically
    const isOpenProofValid = await pelCircuitService.verifyProof('OPEN', openProof.proof, openProof.publicSignals);
    expect(isOpenProofValid).toBe(true);

    // ─── 3. TRANSITION 2: UPDATE (Rotate Nonce to prevent linkability) ─────
    const nonce1Hex = generateNonce();
    const nonce1 = BigInt(nonce1Hex);

    const updateProof1 = await pelCircuitService.generateUpdateProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      nonce: nonce0,
      newNonce: nonce1,
      ownerSecret,
    });

    expect(updateProof1.publicSignals.length).toBe(4);
    const commitment1 = '0x' + updateProof1.newCommitment.toString(16);
    const nullifier1 = '0x' + updateProof1.nullifier.toString(16);

    // Update witness in client store with ownerSecret preservation
    await updateWitness(traderAddress, commitment0, {
      protocolVersion: 3,
      marketId,
      side: 'LONG',
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      feesCents: 0n,
      nonce: nonce1Hex,
      ownerSecret: ownerSecretHex,
      commitment: commitment1,
      nullifier: nullifier1,
      openedAtMs: Date.now(),
    }, '');

    const updateCall1 = starknetPerpsDispatcher.buildUpdatePositionCall(
      marketId,
      updateProof1.calldata || [4n, openProof.commitment, updateProof1.newCommitment, updateProof1.nullifier, 0x4254432d50455250n]
    );
    expect(updateCall1.entrypoint).toBe('update_position');

    const isUpdate1Valid = await pelCircuitService.verifyProof('UPDATE', updateProof1.proof, updateProof1.publicSignals);
    expect(isUpdate1Valid).toBe(true);

    // ─── 4. TRANSITION 3: FUNDING CLEARING (1 interval at +120 bps/hr) ─────
    const nonce2Hex = generateNonce();
    const nonce2 = BigInt(nonce2Hex);
    const markPriceCents = 9600000n; // ,000.00
    const fundingRateBpsHr = 120n;
    const intervalsElapsed = 1n;

    const fundProof = await pelCircuitService.generateFundProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      nonce: nonce1,
      newNonce: nonce2,
      ownerSecret,
      markPriceCents,
      fundingRateBpsHr,
      intervalsElapsed,
    });

    expect(fundProof.publicSignals.length).toBe(9);
    const commitment2 = '0x' + fundProof.newCommitment.toString(16);
    const nullifier2 = '0x' + fundProof.nullifier.toString(16);

    await updateWitness(traderAddress, commitment1, {
      protocolVersion: 3,
      marketId,
      side: 'LONG',
      quantitySats,
      entryPriceCents,
      marginCents: fundProof.newMargin,
      fundingCents: fundProof.newFunding,
      feesCents: 0n,
      nonce: nonce2Hex,
      ownerSecret: ownerSecretHex,
      commitment: commitment2,
      nullifier: nullifier2,
      openedAtMs: Date.now(),
    }, '');

    const fundCall = starknetPerpsDispatcher.buildFundPositionCall(
      marketId,
      Number(fundProof.fundingPayment) / 100,
      true,
      fundProof.calldata || [9n, updateProof1.newCommitment, fundProof.newCommitment, fundProof.nullifier, 0x4254432d50455250n, markPriceCents, fundingRateBpsHr, intervalsElapsed, fundProof.fundingPayment, 1n]
    );
    expect(fundCall.entrypoint).toBe('fund_position');

    const isFundValid = await pelCircuitService.verifyProof('FUND', fundProof.proof, fundProof.publicSignals);
    expect(isFundValid).toBe(true);

    // ─── 5. TRANSITION 4: UPDATE (Rotate Nonce before Settlement) ─────────
    const nonce3Hex = generateNonce();
    const nonce3 = BigInt(nonce3Hex);

    const updateProof2 = await pelCircuitService.generateUpdateProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents: fundProof.newMargin,
      fundingCents: fundProof.newFunding,
      nonce: nonce2,
      newNonce: nonce3,
      ownerSecret,
    });

    expect(updateProof2.publicSignals.length).toBe(4);
    const commitment3 = '0x' + updateProof2.newCommitment.toString(16);
    const nullifier3 = '0x' + updateProof2.nullifier.toString(16);

    await updateWitness(traderAddress, commitment2, {
      protocolVersion: 3,
      marketId,
      side: 'LONG',
      quantitySats,
      entryPriceCents,
      marginCents: fundProof.newMargin,
      fundingCents: fundProof.newFunding,
      feesCents: 0n,
      nonce: nonce3Hex,
      ownerSecret: ownerSecretHex,
      commitment: commitment3,
      nullifier: nullifier3,
      openedAtMs: Date.now(),
    }, '');

    const isUpdate2Valid = await pelCircuitService.verifyProof('UPDATE', updateProof2.proof, updateProof2.publicSignals);
    expect(isUpdate2Valid).toBe(true);

    // ─── 6. TRANSITION 5: CLOSE POSITION (Close at ,000 for Profit) ─────
    const oracleClosePriceCents = 9800000n; // ,000.00 (+,000 PnL)
    const payoutNonce = BigInt(generateNonce());

    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents: fundProof.newMargin,
      fundingCents: fundProof.newFunding,
      feesCents: 0n,
      nonce: nonce3,
      ownerSecret,
      payoutNonce,
      oraclePriceCents: oracleClosePriceCents,
      recipient: BigInt(traderAddress),
    });

    expect(closeProof.publicSignals.length).toBe(7);
    expect(closeProof.payout > marginCents).toBe(true); // Profitable close

    const closeCall = starknetPerpsDispatcher.buildClosePositionCall(
      traderAddress,
      marketId,
      closeProof.calldata || [7n, closeProof.commitment, closeProof.nullifier, closeProof.payoutCommitment, closeProof.payout, 0x4254432d50455250n, oracleClosePriceCents, BigInt(traderAddress)]
    );
    expect(closeCall.entrypoint).toBe('close_position');

    const isCloseValid = await pelCircuitService.verifyProof('CLOSE', closeProof.proof, closeProof.publicSignals);
    expect(isCloseValid).toBe(true);

    // Clean up witness post-settlement
    await await deleteWitness(traderAddress, commitment3, '');
    expect(await await loadWitness(traderAddress, commitment3, '')).toBeNull();
  }, 30000);
});
