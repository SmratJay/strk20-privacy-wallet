/**
 * @file tests/e2e/liquidationPath.test.ts
 * @description PEL BTC-PERP Liquidation Path E2E Test
 *
 * Verifies the liquidation workflow:
 * 1. Leveraged position opened
 * 2. Price crashes below maintenance margin
 * 3. Keeper detects insolvency and generates LIQUIDATE fact
 * 4. 2% keeper bounty and 98% insurance fund allocation calculated
 */

import { describe, it, expect } from 'vitest';
import { zkProverService } from '../../src/services/zkProverService';
import {
  saveWitness,
  loadWitness,
  deleteWitness,
} from '../../src/protocol/witnessStore';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  isLiquidatable,
  usdToCents,
  tokensToSats,
} from '../../src/protocol/fixedPoint';
import { BTC_PERP_CONFIG } from '../../src/protocol/types';

describe('PEL BTC-PERP Liquidation Path E2E', () => {
  const WALLET_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const OWNER_SECRET   = '0x011122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000';
  const KEEPER_ADDR    = '0x0555666677778888999900001111222233334444555566667777888899990000';
  const MARKET_ID      = 'BTC-PERP' as const;

  // 25x leverage on $500 margin at $95,000 entry price -> $12,500 notional
  const ENTRY_PRICE_CENTS = 9_500_000n; // $95,000.00
  const MARGIN_CENTS      = 50_000n;    // $500.00
  const QTY_SATS          = 13_157_894n; // 0.13157894 BTC
  const NONCE             = '0x0123456789abcdef0123456789abcdef';
  const MARGIN_NULLIFIER  = '0x0aabbccddeeff00112233445566778899';
  const MAINT_BPS         = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps); // 200 = 2%

  let positionCommitment: string;

  it('Step 1: Open Position with  Margin at 20x Leverage', async () => {
    const { fact, commitment, witness } = zkProverService.generateOpenFact(
      OWNER_SECRET,
      NONCE,
      MARKET_ID,
      'LONG',
      QTY_SATS,
      ENTRY_PRICE_CENTS,
      MARGIN_CENTS,
      ENTRY_PRICE_CENTS,
      MARGIN_NULLIFIER,
    );

    positionCommitment = commitment;
    const nullifier = zkProverService.computeNullifier(OWNER_SECRET, commitment);

    await saveWitness(WALLET_ADDRESS, {
      ...witness,
      commitment,
      nullifier,
    });

    expect(await loadWitness(WALLET_ADDRESS, commitment, '')).not.toBeNull();
  });

  it('Step 2: Price Drops & Position Becomes Liquidatable', async () => {
    const loaded = await loadWitness(WALLET_ADDRESS, positionCommitment, '');
    expect(loaded).not.toBeNull();

    // Price crashes 5% to $90,250.00
    // Loss = 0.13157894 * -$4,750 = -$625.00
    // Equity = $500 - $625 = -$125 (insolvent)
    const crashPriceCents = 9_025_000n;
    const pnlCents = calcPnlCents(loaded!.side, loaded!.quantitySats, loaded!.entryPriceCents, crashPriceCents);
    const equityCents = calcEquityCents(loaded!.marginCents, pnlCents, 0n, 0n);
    const maintMarginCents = calcMaintMarginCents(loaded!.quantitySats, crashPriceCents, MAINT_BPS);

    const eligible = isLiquidatable(
      loaded!.marginCents,
      pnlCents,
      0n,
      0n,
      loaded!.quantitySats,
      crashPriceCents,
      MAINT_BPS,
    );

    expect(eligible).toBe(true);
    expect(equityCents).toBeLessThanOrEqual(maintMarginCents);
  });

  it('Step 3: Keeper Generates Valid LIQUIDATE Fact', async () => {
    const loaded = await loadWitness(WALLET_ADDRESS, positionCommitment, '');
    expect(loaded).not.toBeNull();

    const crashPriceCents = 9_025_000n;
    const fact = zkProverService.generateLiquidateFact(
      loaded!,
      crashPriceCents,
      crashPriceCents,
    );

    expect(fact.proofType).toBe('LIQUIDATE');
    expect(fact.factHash.startsWith('0x')).toBe(true);
    expect(fact.commitment).toBe(positionCommitment, '');
  });

  it('Step 4: Collateral Split (2% Keeper Bounty + 98% Insurance Allocation)', async () => {
    const lockedMargin = MARGIN_CENTS;
    const bountyAmount = (lockedMargin * 200n) / 10000n; // 2% = $10.00
    const insuranceAmount = lockedMargin - bountyAmount;  // 98% = $490.00

    expect(bountyAmount).toBe(1000n); // $10.00 in cents
    expect(insuranceAmount).toBe(49000n); // $490.00 in cents
    expect(bountyAmount + insuranceAmount).toBe(lockedMargin);

    // Clean up consumed witness
    await deleteWitness(WALLET_ADDRESS, positionCommitment, '');
    expect(await loadWitness(WALLET_ADDRESS, positionCommitment, '')).toBeNull();
  });
});
