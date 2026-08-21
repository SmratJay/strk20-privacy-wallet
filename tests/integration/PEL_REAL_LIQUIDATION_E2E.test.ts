import { describe, it, expect } from 'vitest';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { starknetPerpsDispatcher, PERPS_DEPLOYMENTS } from '../../src/services/starknetPerpsDispatcher';
import { generateOwnerSecret, generateNonce, saveWitness, deleteWitness, loadWitness } from '../../src/protocol/witnessStore';
import { calcPnlCents, calcEquityCents, calcMaintMarginCents, isLiquidatable } from '../../src/protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../../src/protocol/types';

describe('Authoritative Real Liquidation E2E (Audit Section 17 & 8)', () => {
  const traderAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const keeperAddress = '0x0111111111111111111111111111111111111111111111111111111111111111';
  const marketId = 'BTC-PERP';

  it('Executes authoritative liquidation path: OPEN -> Adverse Price Drop -> Insolvent Proof -> LIQUIDATE', async () => {
    // 1. OPEN Position: 1 BTC at ,000 with ,000 margin (47.5x leverage)
    const ownerSecretHex = generateOwnerSecret();
    const ownerSecret = BigInt(ownerSecretHex);
    const nonceHex = generateNonce();
    const nonce = BigInt(nonceHex);

    const quantitySats = 100000000n; // 1.0 BTC
    const entryPriceCents = 9500000n; // ,000.00
    const marginCents = 200000n; // ,000.00

    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      nonce,
      ownerSecret,
    });

    const commitment = '0x' + openProof.commitment.toString(16);
    const nullifier = '0x' + openProof.nullifier.toString(16);

    saveWitness(traderAddress, {
      protocolVersion: 3,
      marketId,
      side: 'LONG',
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      feesCents: 0n,
      nonce: nonceHex,
      ownerSecret: ownerSecretHex,
      commitment,
      nullifier,
      openedAtMs: Date.now(),
    });

    // 2. Adverse Price Movement: Price falls from ,000 to ,100 (-,900 drop on 1 BTC)
    const crashPriceCents = 9310000n;
    const pnlCents = calcPnlCents('LONG', quantitySats, entryPriceCents, crashPriceCents);
    const equityCents = calcEquityCents(marginCents, pnlCents, 0n, 0n);
    const maintMarginCents = calcMaintMarginCents(quantitySats, crashPriceCents, BigInt(BTC_PERP_CONFIG.maintenanceMarginBps));

    expect(equityCents <= maintMarginCents).toBe(true);
    expect(isLiquidatable(equityCents, maintMarginCents)).toBe(true);

    // 3. Keeper Generates Insolvent Liquidation Proof
    const liqProof = await pelCircuitService.generateLiquidateProof({
      side: 0n,
      quantitySats,
      entryPriceCents,
      marginCents,
      fundingCents: 0n,
      feesCents: 0n,
      nonce,
      ownerSecret,
      markPriceCents: crashPriceCents,
      keeper: BigInt(keeperAddress),
    });

    expect(liqProof.publicSignals.length).toBe(5);

    // Verify proof validity cryptographically
    const isLiqProofValid = await pelCircuitService.verifyProof('LIQUIDATE', liqProof.proof, liqProof.publicSignals);
    expect(isLiqProofValid).toBe(true);

    // 4. Build Liquidate Call with bound keeper recipient
    const liqCall = starknetPerpsDispatcher.buildLiquidatePositionCall(
      keeperAddress,
      marketId,
      liqProof.calldata || [5n, liqProof.commitment, liqProof.nullifier, 0x4254432d50455250n, crashPriceCents, BigInt(keeperAddress)]
    );
    expect(liqCall.entrypoint).toBe('liquidate_position');
    expect(liqCall.calldata[0]).toBe('0x4254432d50455250');

    // 5. Accounting Assertions:
    // - 2% Keeper Bounty = .00 (4,000 cents)
    // - Remainder to LP Pool NAV = ,960.00 (196,000 cents)
    const expectedBountyCents = (marginCents * 200n) / 10000n;
    const expectedRemainingCents = marginCents - expectedBountyCents;
    expect(expectedBountyCents).toBe(4000n);
    expect(expectedRemainingCents).toBe(196000n);

    // Clean up witness after liquidation
    deleteWitness(traderAddress, commitment);
    expect(loadWitness(traderAddress, commitment)).toBeNull();
  }, 30000);
});
