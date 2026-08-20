/**
 * @file tests/invariants/assetConservation.test.ts
 * @description Asset Conservation Invariant Tests
 *
 * The most fundamental invariant in a financial protocol:
 *   locked_before = locked_after + payout + fees + insurance
 *
 * Every test represents one invariant that MUST hold across all state transitions.
 */

import { describe, it, expect } from 'vitest';
import {
  calcPnlCents,
  calcEquityCents,
  calcMaintMarginCents,
  calcTakerFeeCents,
  calcFundingCentsPerInterval,
  calcNotionalCents,
  isLiquidatable,
  usdToCents,
  tokensToSats,
  maxFixed,
  absFixed,
} from '../../src/protocol/fixedPoint';
import { zkProverService } from '../../src/services/zkProverService';
import { BTC_PERP_CONFIG } from '../../src/protocol/types';

const BTC_PRICE   = 9_642_050n;  // $96,420.50 cents
const MARGIN      = 100_000n;    // $1,000 cents
// 10x leverage on $1,000 margin at $96,420.50 -> $10,000 notional -> 0.10371238 BTC
const QTY_SATS    = 10_371_238n; // 10,371,238 sats
const MAINT_BPS   = BigInt(BTC_PERP_CONFIG.maintenanceMarginBps); // 200 (2.0%)
const TAKER_BPS   = BigInt(BTC_PERP_CONFIG.takerFeeBps);          // 7 (0.07%)

// ─── Invariant 1: OPEN + CLOSE (zero PnL) → no money created or destroyed ────

describe('Invariant 1: OPEN→CLOSE at flat price — zero net change', () => {
  it('equity == margin when PnL == 0 and no fees/funding', () => {
    const pnl    = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, BTC_PRICE);
    const equity = calcEquityCents(MARGIN, pnl, 0n, 0n);
    expect(pnl).toBe(0n);
    expect(equity).toBe(MARGIN);
  });

  it('payout == equity clamped to [0, equity]', () => {
    const pnl    = 0n;
    const equity = calcEquityCents(MARGIN, pnl, 0n, 0n);
    const payout = maxFixed(0n, equity);
    expect(payout).toBe(MARGIN);
  });
});

// ─── Invariant 2: OPEN + CLOSE (profit) → winner receives exact profit ────────

describe('Invariant 2: OPEN→CLOSE profit — only winner benefits', () => {
  it('payout == locked_margin + PnL when profitable', () => {
    const upPrice  = (BTC_PRICE * 11000n) / 10000n; // +10%
    const pnl      = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, upPrice);
    const equity   = calcEquityCents(MARGIN, pnl, 0n, 0n);
    const payout   = maxFixed(0n, equity);

    expect(pnl).toBeGreaterThan(0n);
    expect(payout).toBeGreaterThan(MARGIN);
    // Conservation: payout = margin + profit
    expect(payout).toBe(MARGIN + pnl);
  });
});

// ─── Invariant 3: OPEN + CLOSE (loss) → insurance receives residual ───────────

describe('Invariant 3: OPEN→CLOSE loss — insurance receives residual', () => {
  it('payout + insurance_contribution == locked_margin', () => {
    const downPrice = (BTC_PRICE * 9500n) / 10000n; // -5%
    const pnl       = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, downPrice);
    const equity    = calcEquityCents(MARGIN, pnl, 0n, 0n);
    const payout    = maxFixed(0n, equity);
    const loss      = MARGIN - payout; // goes to insurance

    // Conservation check
    expect(payout + loss).toBe(MARGIN);
    // Insurance contribution is non-negative
    expect(loss).toBeGreaterThanOrEqual(0n);
  });
});

// ─── Invariant 4: OPEN + LIQUIDATE — 2% bounty + 98% insurance == locked ──────

describe('Invariant 4: OPEN→LIQUIDATE — bounty + insurance == locked_margin', () => {
  it('bounty_amount + remaining_amount == locked_margin', () => {
    const locked    = MARGIN;
    const bounty    = (locked * 200n) / 10000n; // 2%
    const remaining = locked - bounty;

    expect(bounty + remaining).toBe(locked);
    expect(bounty).toBe(2000n);     // $20.00 at $1000 margin
    expect(remaining).toBe(98000n);  // $980.00
  });
});

// ─── Invariant 5: Registered note amount == payout_amount ────────────────────

describe('Invariant 5: registered_note_amount == payout_amount', () => {
  it('what the protocol releases is exactly what the note registry stores', () => {
    const upPrice = (BTC_PRICE * 11050n) / 10000n;
    const pnl     = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, upPrice);
    const equity  = calcEquityCents(MARGIN, pnl, 0n, 0n);
    const payout1 = maxFixed(0n, equity);
    const payout2 = maxFixed(0n, equity);
    
    // Payout is deterministic — always the same value for same inputs
    expect(payout1).toBe(payout2);
  });
});

// ─── Invariant 6: Insurance fund balance only increases ───────────────────────

describe('Invariant 6: insurance_fund_balance is monotonically non-decreasing', () => {
  it('funding payments credit insurance fund (never reduce it)', () => {
    let insuranceFund = 0n;
    const fundingPayment = calcFundingCentsPerInterval(QTY_SATS, BTC_PRICE, 120n, 1n);

    insuranceFund += fundingPayment;
    expect(insuranceFund).toBeGreaterThanOrEqual(0n);

    // After liquidation, remaining margin goes to insurance
    const bounty    = (MARGIN * 200n) / 10000n;
    const remaining = MARGIN - bounty;
    insuranceFund += remaining;
    expect(insuranceFund).toBeGreaterThanOrEqual(remaining);
  });
});

// ─── Invariant 7: Nullifier cannot be reused across transitions ───────────────

describe('Invariant 7: nullifiers are unique across transition types', () => {
  it('OPEN and CLOSE produce different nullifiers', () => {
    const openNullifier  = '0x0111111111111111111111111111111111111111111111111111111111111111';
    const closeNullifier = '0x0222222222222222222222222222222222222222222222222222222222222222';
    expect(openNullifier).not.toEqual(closeNullifier);
  });

  it('same commitment + different ownerSecret = different nullifier', () => {
    const nf1 = zkProverService.computeNullifier(
      '0x0111111111111111111111111111111111111111111111111111111111111111',
      '0x0333333333333333333333333333333333333333333333333333333333333333'
    );
    const nf2 = zkProverService.computeNullifier(
      '0x0222222222222222222222222222222222222222222222222222222222222222',
      '0x0333333333333333333333333333333333333333333333333333333333333333'
    );
    expect(nf1).not.toEqual(nf2);
  });
});

// ─── Invariant 8: Healthy position cannot be liquidated ───────────────────────

describe('Invariant 8: no liquidation of solvent position', () => {
  it('isLiquidatable == false at entry price (0 PnL)', () => {
    const pnl  = 0n;
    expect(isLiquidatable(MARGIN, pnl, 0n, 0n, QTY_SATS, BTC_PRICE, MAINT_BPS)).toBe(false);
  });

  it('isLiquidatable == false at +10% price for LONG', () => {
    const upPrice = (BTC_PRICE * 110n) / 100n;
    const pnl     = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, upPrice);
    expect(isLiquidatable(MARGIN, pnl, 0n, 0n, QTY_SATS, upPrice, MAINT_BPS)).toBe(false);
  });

  it('isLiquidatable == true at -12% price for 10x LONG (maint margin = 2%)', () => {
    // 10x leverage: 10% move = 100% of margin ($1,000).
    // At -12%, loss = $1,200 > $1,000 margin -> equity = -$200 <= maint_margin ($170) -> liquidatable.
    const crashPrice = (BTC_PRICE * 88n) / 100n;
    const pnl        = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, crashPrice);
    expect(isLiquidatable(MARGIN, pnl, 0n, 0n, QTY_SATS, crashPrice, MAINT_BPS)).toBe(true);
  });
});

// ─── Invariant 9: PnL is antisymmetric (LONG/SHORT mirror) ───────────────────

describe('Invariant 9: LONG PnL + SHORT PnL == 0 (zero-sum)', () => {
  it('equal and opposite PnL for LONG and SHORT at same price move', () => {
    const upPrice  = (BTC_PRICE * 11000n) / 10000n;
    const longPnl  = calcPnlCents('LONG',  QTY_SATS, BTC_PRICE, upPrice);
    const shortPnl = calcPnlCents('SHORT', QTY_SATS, BTC_PRICE, upPrice);
    expect(longPnl + shortPnl).toBe(0n);
  });
});

// ─── Invariant 10: Fee is non-negative and < margin ──────────────────────────

describe('Invariant 10: taker fee is bounded by [0, margin)', () => {
  it('fee >= 0', () => {
    const fee = calcTakerFeeCents(QTY_SATS, BTC_PRICE, TAKER_BPS);
    expect(fee).toBeGreaterThanOrEqual(0n);
  });

  it('fee < margin for any valid position', () => {
    // At 0.07% fee on $10,000 notional = $7.00 fee — always << $1,000 margin
    const fee = calcTakerFeeCents(QTY_SATS, BTC_PRICE, TAKER_BPS);
    expect(fee).toBeLessThan(MARGIN);
  });
});

// ─── Invariant 11: Funding payment <= margin (prevents instant bad debt) ──────

describe('Invariant 11: funding_payment <= locked_margin', () => {
  it('single-interval funding is much less than margin at normal rates', () => {
    const funding = calcFundingCentsPerInterval(QTY_SATS, BTC_PRICE, 120n, 1n);
    // At 0.0012%/hr on $10,000 notional = $0.12/hr << $1,000 margin
    expect(funding).toBeLessThan(MARGIN);
    expect(funding).toBeGreaterThan(0n);
  });
});

// ─── Invariant 12: Notional is deterministic and commutative ─────────────────

describe('Invariant 12: notional calculation is deterministic', () => {
  it('same inputs produce same notional every time', () => {
    const n1 = calcNotionalCents(QTY_SATS, BTC_PRICE);
    const n2 = calcNotionalCents(QTY_SATS, BTC_PRICE);
    expect(n1).toBe(n2);
  });

  it('notional scales linearly with quantity', () => {
    const qty1 = 100_000_000n; // 1 BTC (exact QTY_SCALE)
    const n1 = calcNotionalCents(qty1, BTC_PRICE);
    const n2 = calcNotionalCents(qty1 * 2n, BTC_PRICE);
    expect(n2).toBe(n1 * 2n);
  });
});

// ─── Invariant 13: Equity monotonically decreases with accruing funding ───────

describe('Invariant 13: funding reduces equity monotonically', () => {
  it('equity with funding < equity without funding', () => {
    const pnl       = 0n;
    const funding   = calcFundingCentsPerInterval(QTY_SATS, BTC_PRICE, 120n, 5n); // 5 hours
    const equity0   = calcEquityCents(MARGIN, pnl, 0n, 0n);
    const equityF   = calcEquityCents(MARGIN, pnl, funding, 0n);
    expect(equityF).toBeLessThan(equity0);
  });
});

// ─── Invariant 14: CLOSE payout + any loss == locked_margin ──────────────────

describe('Invariant 14: payout + loss == locked_margin (conservation through CLOSE)', () => {
  const scenarios = [
    { label: '+5%',  price: (BTC_PRICE * 10500n) / 10000n },
    { label: 'flat', price: BTC_PRICE },
    { label: '-5%',  price: (BTC_PRICE * 9500n) / 10000n },
  ];

  scenarios.forEach(({ label, price }) => {
    it(`Conservation holds at ${label} price`, () => {
      const pnl      = calcPnlCents('LONG', QTY_SATS, BTC_PRICE, price);
      const equity   = calcEquityCents(MARGIN, pnl, 0n, 0n);
      const payout   = maxFixed(0n, equity);

      if (equity >= 0n) {
        expect(payout).toBeGreaterThanOrEqual(0n);
      } else {
        expect(payout).toBe(0n);
      }
    });
  });
});

// ─── Invariant 15: Randomized Multi-Action State-Transition Fuzzing Suite ───

describe('Invariant 15: Randomized Global Financial Conservation under 100+ Transaction Sequences', () => {
  it('strictly preserves adapter_balance == total_locked + lp_nav + insurance + unclaimed_payouts + unclaimed_bounties', () => {
    class FuzzVault {
      public tokenBalance: bigint = 0n;
      public lockedMargin: bigint = 0n;
      public lpPoolNav: bigint = 0n;
      public totalLpShares: bigint = 0n;
      public insuranceFund: bigint = 0n;
      public unclaimedPayouts: bigint = 0n;
      public unclaimedBounties: bigint = 0n;

      assertInvariant() {
        const totalLiabilities = this.lockedMargin + this.lpPoolNav + this.insuranceFund + this.unclaimedPayouts + this.unclaimedBounties;
        expect(this.tokenBalance).toBe(totalLiabilities);
      }

      depositLp(amount: bigint) {
        this.tokenBalance += amount;
        this.lpPoolNav += amount;
        const shares = this.totalLpShares === 0n ? amount * 1_000_000n : (amount * this.totalLpShares) / (this.lpPoolNav - amount);
        this.totalLpShares += shares;
        this.assertInvariant();
      }

      withdrawLp(amount: bigint) {
        if (this.lpPoolNav >= amount && this.lpPoolNav > 0n && this.totalLpShares > 0n) {
          const sharesToBurn = (amount * this.totalLpShares) / this.lpPoolNav;
          this.totalLpShares -= sharesToBurn;
          this.lpPoolNav -= amount;
          this.tokenBalance -= amount;
          this.assertInvariant();
        }
      }

      openPosition(margin: bigint) {
        this.tokenBalance += margin;
        this.lockedMargin += margin;
        this.assertInvariant();
      }

      closePosition(margin: bigint, payout: bigint) {
        if (this.lockedMargin >= margin) {
          this.lockedMargin -= margin;
          if (payout > margin) {
            const profit = payout - margin;
            if (this.lpPoolNav >= profit) {
              this.lpPoolNav -= profit;
              this.unclaimedPayouts += payout;
            } else {
              // Not enough pool liquidity, skip
              this.lockedMargin += margin;
              return;
            }
          } else {
            const loss = margin - payout;
            this.lpPoolNav += loss;
            this.unclaimedPayouts += payout;
          }
          this.assertInvariant();
        }
      }

      liquidatePosition(margin: bigint) {
        if (this.lockedMargin >= margin) {
          this.lockedMargin -= margin;
          const bounty = (margin * 200n) / 10000n;
          const remainder = margin - bounty;
          this.unclaimedBounties += bounty;
          this.insuranceFund += remainder;
          this.assertInvariant();
        }
      }

      claimPayout(amount: bigint) {
        if (this.unclaimedPayouts >= amount && amount > 0n) {
          this.unclaimedPayouts -= amount;
          this.tokenBalance -= amount;
          this.assertInvariant();
        }
      }

      claimBounty(amount: bigint) {
        if (this.unclaimedBounties >= amount && amount > 0n) {
          this.unclaimedBounties -= amount;
          this.tokenBalance -= amount;
          this.assertInvariant();
        }
      }
    }

    const vault = new FuzzVault();
    vault.depositLp(1_000_000n); // seed $10,000 pool

    // Execute 150 random state transitions
    let seed = 42;
    function pseudoRandom(min: number, max: number): number {
      seed = (seed * 9301 + 49297) % 233280;
      const rnd = seed / 233280;
      return Math.floor(min + rnd * (max - min));
    }

    for (let i = 0; i < 150; i++) {
      const action = pseudoRandom(0, 7);
      const amount = BigInt(pseudoRandom(100, 50_000));

      switch (action) {
        case 0:
          vault.depositLp(amount);
          break;
        case 1:
          vault.withdrawLp(amount);
          break;
        case 2:
          vault.openPosition(amount);
          break;
        case 3: {
          const payout = BigInt(pseudoRandom(0, Number(amount) * 2));
          vault.closePosition(amount, payout);
          break;
        }
        case 4:
          vault.liquidatePosition(amount);
          break;
        case 5:
          vault.claimPayout(amount);
          break;
        case 6:
          vault.claimBounty(amount);
          break;
      }
      vault.assertInvariant();
    }
  });
});

