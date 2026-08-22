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

    expect(liqProof.publicSignals.length).toBe(7);
    expect(liqProof.seizedCollateral).toBe(10000n); // $100.00 equity seized
    expect(liqProof.badDebt).toBe(0n); // $0 bad debt

    // Verify proof validity cryptographically
    const isLiqProofValid = await pelCircuitService.verifyProof('LIQUIDATE', liqProof.proof, liqProof.publicSignals);
    expect(isLiqProofValid).toBe(true);

    // 4. Build Liquidate Call with bound keeper recipient
    const liqCall = starknetPerpsDispatcher.buildLiquidatePositionCall(
      keeperAddress,
      marketId,
      liqProof.calldata || [7n, liqProof.commitment, liqProof.nullifier, 0x4254432d50455250n, crashPriceCents, BigInt(keeperAddress), 10000n, 0n]
    );
    expect(liqCall.entrypoint).toBe('liquidate_position');
    expect(liqCall.calldata[0]).toBe('0x4254432d50455250');

    // 5. Accounting Assertions:
    // - Trader Loss = $1,900.00 (190,000 cents) -> credited to LP NAV
    // - Seized Collateral = $100.00 (10,000 cents)
    // - 2% Keeper Bounty = $2.00 (200 cents) on seized collateral
    // - Remnant = $98.00 (9,800 cents) split: 70% LP ($68.60), 20% Ins ($19.60), 10% Treasury ($9.80)
    // - Total accounted for = 190,000 + 200 + 6,860 + 1,960 + 980 = 200,000 cents ($2,000.00)
    const expectedBountyCents = (liqProof.seizedCollateral * 200n) / 10000n;
    const netRemnantCents = liqProof.seizedCollateral - expectedBountyCents;
    const lpShareCents = (netRemnantCents * 7000n) / 10000n;
    const insuranceShareCents = (netRemnantCents * 2000n) / 10000n;
    const treasuryShareCents = netRemnantCents - lpShareCents - insuranceShareCents;
    const traderLossCents = marginCents - liqProof.seizedCollateral;

    expect(expectedBountyCents).toBe(200n);
    expect(traderLossCents).toBe(190000n);
    expect(lpShareCents).toBe(6860n);
    expect(insuranceShareCents).toBe(1960n);
    expect(treasuryShareCents).toBe(980n);
    expect(expectedBountyCents + lpShareCents + insuranceShareCents + treasuryShareCents + traderLossCents).toBe(marginCents);

    // Clean up witness after liquidation
    await deleteWitness(traderAddress, commitment, '');
    expect(await loadWitness(traderAddress, commitment, '')).toBeNull();
  }, 30000);
});
