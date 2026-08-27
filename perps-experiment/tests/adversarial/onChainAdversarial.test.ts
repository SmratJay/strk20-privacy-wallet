import { describe, it, expect, beforeEach } from 'vitest';
import { pelCircuitService } from '../../src/services/pelCircuitService';
import { starknetPerpsDispatcher } from '../../src/services/starknetPerpsDispatcher';
import { generateOwnerSecret, generateNonce } from '../../src/protocol/witnessStore';
import { bn254ToStorageKey } from '../../src/protocol/canonical';

describe('Real On-Chain Negative & Adversarial Attack Matrix (Audit Section 14)', () => {
  const honestTrader = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const attackerAddress = '0x0deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567';
  const marketId = 'BTC-PERP';
  let ownerSecret: bigint;
  let nonce: bigint;

  beforeEach(() => {
    ownerSecret = BigInt(generateOwnerSecret());
    nonce = BigInt(generateNonce());
  });

  it('ATTACK 1: Mutated commitment in OPEN proof fails verification', async () => {
    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      nonce,
      ownerSecret,
    });

    const tampered = [...openProof.publicSignals];
    tampered[0] = (BigInt(tampered[0]) + 1n).toString(); // Mutate commitment
    const ok = await pelCircuitService.verifyProof('OPEN', openProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 2: Mutated marginNullifier in OPEN proof fails verification', async () => {
    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      nonce,
      ownerSecret,
    });

    const tampered = [...openProof.publicSignals];
    tampered[1] = (BigInt(tampered[1]) + 1n).toString(); // Mutate margin nullifier
    const ok = await pelCircuitService.verifyProof('OPEN', openProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 3: Mutated marketId in OPEN proof fails verification', async () => {
    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      nonce,
      ownerSecret,
    });

    const tampered = [...openProof.publicSignals];
    tampered[2] = BigInt('0x4554482d50455250').toString(); // ETH-PERP instead of BTC-PERP
    const ok = await pelCircuitService.verifyProof('OPEN', openProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 4: Mutated margin in OPEN proof fails verification', async () => {
    const openProof = await pelCircuitService.generateOpenProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      nonce,
      ownerSecret,
    });

    const tampered = [...openProof.publicSignals];
    tampered[3] = '10000'; // Lie: claim margin was 
    const ok = await pelCircuitService.verifyProof('OPEN', openProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 5: Recipient substitution in CLOSE proof fails verification', async () => {
    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      fundingCents: 0n,
      feesCents: 0n,
      nonce,
      ownerSecret,
      payoutNonce: 1111n,
      oraclePriceCents: 9800000n,
      recipient: BigInt(honestTrader),
    });

    const tampered = [...closeProof.publicSignals];
    tampered[6] = BigInt(attackerAddress).toString(); // Swap recipient to attacker
    const ok = await pelCircuitService.verifyProof('CLOSE', closeProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 6: Keeper bounty diversion in LIQUIDATE proof fails verification', async () => {
    const liqProof = await pelCircuitService.generateLiquidateProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 200000n,
      fundingCents: 0n,
      feesCents: 0n,
      nonce,
      ownerSecret,
      markPriceCents: 9000000n, // Insolvent: equity <= maint
      keeper: BigInt(honestTrader),
    });

    const tampered = [...liqProof.publicSignals];
    tampered[4] = BigInt(attackerAddress).toString(); // Swap keeper to attacker
    const ok = await pelCircuitService.verifyProof('LIQUIDATE', liqProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 7: Payout inflation in CLOSE proof fails verification', async () => {
    const closeProof = await pelCircuitService.generateCloseProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      fundingCents: 0n,
      feesCents: 0n,
      nonce,
      ownerSecret,
      payoutNonce: 1111n,
      oraclePriceCents: 9800000n,
      recipient: BigInt(honestTrader),
    });

    const tampered = [...closeProof.publicSignals];
    tampered[3] = (BigInt(tampered[3]) + 1000000n).toString(); // Inflate payout by ,000
    const ok = await pelCircuitService.verifyProof('CLOSE', closeProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 8: Funding amount distortion in FUND proof fails verification', async () => {
    const fundProof = await pelCircuitService.generateFundProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      fundingCents: 0n,
      nonce,
      newNonce: 2222n,
      ownerSecret,
      markPriceCents: 9600000n,
      fundingRateBpsHr: 120n,
      intervalsElapsed: 1n,
    });

    const tampered = [...fundProof.publicSignals];
    tampered[7] = '0'; // Lie: claim funding payment was 0
    const ok = await pelCircuitService.verifyProof('FUND', fundProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 9: Funding direction distortion in FUND proof fails verification', async () => {
    const fundProof = await pelCircuitService.generateFundProof({
      side: 0n,
      quantitySats: 100000000n,
      entryPriceCents: 9500000n,
      marginCents: 500000n,
      fundingCents: 0n,
      nonce,
      newNonce: 2222n,
      ownerSecret,
      markPriceCents: 9600000n,
      fundingRateBpsHr: 120n,
      intervalsElapsed: 1n,
    });

    const tampered = [...fundProof.publicSignals];
    tampered[8] = '0'; // Invert direction (claim shorts pay instead of longs pay)
    const ok = await pelCircuitService.verifyProof('FUND', fundProof.proof, tampered);
    expect(ok).toBe(false);
  });

  it('ATTACK 10: Reject liquidation of solvent healthy position in circuit', async () => {
    await expect(
      pelCircuitService.generateLiquidateProof({
        side: 0n,
        quantitySats: 100000000n,
        entryPriceCents: 9500000n,
        marginCents: 500000n,
        fundingCents: 0n,
        feesCents: 0n,
        nonce,
        ownerSecret,
        markPriceCents: 9600000n, // In profit (,000 > ,000) -> Healthy!
        keeper: BigInt(honestTrader),
      })
    ).rejects.toThrow();
  });
});
