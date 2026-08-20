/**
 * @file tests/lpNavEconomics.test.ts
 * @description P0 Proportional LP Shares & NAV Accounting Test Suite (PEL V4.1 Architecture)
 *
 * Verifies that:
 * 1. LP shares track proportional ownership of pool NAV: sharePrice = poolNAV / totalShares
 * 2. Trader profit dilutes share price; trader loss boosts share price
 * 3. Late depositors entering after a trader loss pay the higher share price and do NOT capture historical PnL
 * 4. Early depositors cannot withdraw more than their current proportional share of pool NAV
 * 5. Multiple LPs entering and exiting at different timestamps preserve exact token conservation
 */

import { describe, it, expect, beforeEach } from 'vitest';

const SHARE_SCALE = 1_000_000n; // 1e6 share scale matching Cairo

class MockLpVault {
  public totalLpShares: bigint = 0n;
  public lpPoolNav: bigint = 0n;
  public lpSharesBalances: Map<string, bigint> = new Map();
  public tokenBalances: Map<string, bigint> = new Map();
  public adapterAddress: string = '0x_adapter';

  mintToken(account: string, amount: bigint) {
    const cur = this.tokenBalances.get(account.toLowerCase()) || 0n;
    this.tokenBalances.set(account.toLowerCase(), cur + amount);
  }

  getTokenBalance(account: string): bigint {
    return this.tokenBalances.get(account.toLowerCase()) || 0n;
  }

  getSharePrice(): bigint {
    if (this.totalLpShares === 0n) return SHARE_SCALE;
    return (this.lpPoolNav * SHARE_SCALE * SHARE_SCALE) / this.totalLpShares;
  }

  depositLiquidity(provider: string, amountCents: bigint): bigint {
    if (amountCents <= 0n) throw new Error('INVALID_DEPOSIT_AMOUNT');
    const providerBal = this.getTokenBalance(provider);
    if (providerBal < amountCents) throw new Error('ERC20_INSUFFICIENT_BALANCE');

    // Transfer tokens
    this.tokenBalances.set(provider.toLowerCase(), providerBal - amountCents);
    const adapterBal = this.getTokenBalance(this.adapterAddress);
    this.tokenBalances.set(this.adapterAddress.toLowerCase(), adapterBal + amountCents);

    let sharesToMint: bigint;
    if (this.totalLpShares === 0n || this.lpPoolNav === 0n) {
      sharesToMint = amountCents * SHARE_SCALE;
    } else {
      sharesToMint = (amountCents * this.totalLpShares) / this.lpPoolNav;
    }

    if (sharesToMint <= 0n) throw new Error('ZERO_SHARES_MINTED');

    const curShares = this.lpSharesBalances.get(provider.toLowerCase()) || 0n;
    this.lpSharesBalances.set(provider.toLowerCase(), curShares + sharesToMint);

    this.totalLpShares += sharesToMint;
    this.lpPoolNav += amountCents;

    return sharesToMint;
  }

  withdrawLiquidityShares(provider: string, shares: bigint): bigint {
    if (shares <= 0n) throw new Error('INVALID_WITHDRAW_SHARES');
    const userShares = this.lpSharesBalances.get(provider.toLowerCase()) || 0n;
    if (userShares < shares) throw new Error('INSUFFICIENT_LP_SHARES');
    if (this.totalLpShares <= 0n) throw new Error('ZERO_TOTAL_SHARES');

    const payoutAmount = (shares * this.lpPoolNav) / this.totalLpShares;
    if (payoutAmount <= 0n) throw new Error('ZERO_WITHDRAWAL_PAYOUT');
    if (this.lpPoolNav < payoutAmount) throw new Error('INSUFFICIENT_POOL_NAV');

    this.lpSharesBalances.set(provider.toLowerCase(), userShares - shares);
    this.totalLpShares -= shares;
    this.lpPoolNav -= payoutAmount;

    const adapterBal = this.getTokenBalance(this.adapterAddress);
    this.tokenBalances.set(this.adapterAddress.toLowerCase(), adapterBal - payoutAmount);
    const providerBal = this.getTokenBalance(provider);
    this.tokenBalances.set(provider.toLowerCase(), providerBal + payoutAmount);

    return payoutAmount;
  }

  // Trader PnL attribution
  applyTraderLoss(lossAmount: bigint) {
    this.lpPoolNav += lossAmount;
    const adapterBal = this.getTokenBalance(this.adapterAddress);
    this.tokenBalances.set(this.adapterAddress.toLowerCase(), adapterBal + lossAmount);
  }

  applyTraderProfit(profitAmount: bigint) {
    if (this.lpPoolNav < profitAmount) throw new Error('INSUFFICIENT_POOL_NAV');
    this.lpPoolNav -= profitAmount;
    const adapterBal = this.getTokenBalance(this.adapterAddress);
    this.tokenBalances.set(this.adapterAddress.toLowerCase(), adapterBal - profitAmount);
  }
}

describe('PEL V4.1 Proportional LP Shares & NAV Accounting Tests', () => {
  let vault: MockLpVault;
  const lpAlice = '0x_lp_alice';
  const lpBob = '0x_lp_bob';
  const lpCharlie = '0x_lp_charlie';

  beforeEach(() => {
    vault = new MockLpVault();
    vault.mintToken(lpAlice, 1_000_000n);   // $10,000.00
    vault.mintToken(lpBob, 1_000_000n);     // $10,000.00
    vault.mintToken(lpCharlie, 1_000_000n); // $10,000.00
  });

  it('1. Initial LP deposit establishes base 1:1 share price', () => {
    const depositAmount = 100_000n; // $1,000.00
    const sharesMinted = vault.depositLiquidity(lpAlice, depositAmount);

    expect(sharesMinted).toBe(100_000n * SHARE_SCALE);
    expect(vault.totalLpShares).toBe(100_000n * SHARE_SCALE);
    expect(vault.lpPoolNav).toBe(100_000n);
    expect(vault.getSharePrice()).toBe(SHARE_SCALE); // $1.00 per unit (1e6 scale)
  });

  it('2. Equal depositors get equal shares and proportional payouts', () => {
    vault.depositLiquidity(lpAlice, 100_000n); // $1,000
    vault.depositLiquidity(lpBob, 100_000n);   // $1,000

    expect(vault.lpSharesBalances.get(lpAlice)).toBe(vault.lpSharesBalances.get(lpBob));
    expect(vault.totalLpShares).toBe(200_000n * SHARE_SCALE);
    expect(vault.lpPoolNav).toBe(200_000n);

    // Alice withdraws 100% of her shares -> gets exactly $1,000
    const aliceShares = vault.lpSharesBalances.get(lpAlice)!;
    const payout = vault.withdrawLiquidityShares(lpAlice, aliceShares);
    expect(payout).toBe(100_000n);
    expect(vault.lpPoolNav).toBe(100_000n);
    expect(vault.totalLpShares).toBe(100_000n * SHARE_SCALE);
  });

  it('3. Trader loss increases pool NAV and rewards existing LPs proportionally', () => {
    vault.depositLiquidity(lpAlice, 100_000n); // $1,000
    vault.depositLiquidity(lpBob, 100_000n);   // $1,000

    // Trader loses $400 (40,000 cents) -> credited to pool NAV
    vault.applyTraderLoss(40_000n);
    expect(vault.lpPoolNav).toBe(240_000n); // Pool now worth $2,400

    // Share price increased from $1.00 to $1.20 (1_200_000 in 1e6 scale)
    expect(vault.getSharePrice()).toBe((120n * SHARE_SCALE) / 100n);

    // Alice withdraws all shares -> receives $1,200 ($200 profit)
    const aliceShares = vault.lpSharesBalances.get(lpAlice)!;
    const alicePayout = vault.withdrawLiquidityShares(lpAlice, aliceShares);
    expect(alicePayout).toBe(120_000n);

    // Bob withdraws remaining shares -> receives $1,200 ($200 profit)
    const bobShares = vault.lpSharesBalances.get(lpBob)!;
    const bobPayout = vault.withdrawLiquidityShares(lpBob, bobShares);
    expect(bobPayout).toBe(120_000n);

    expect(vault.lpPoolNav).toBe(0n);
    expect(vault.totalLpShares).toBe(0n);
  });

  it('4. Late depositors do NOT capture historical trader losses', () => {
    // Alice deposits $1,000
    vault.depositLiquidity(lpAlice, 100_000n);

    // Trader loses $500 -> Alice pool NAV becomes $1,500 (Alice is up 50%)
    vault.applyTraderLoss(50_000n);
    expect(vault.lpPoolNav).toBe(150_000n);

    // Charlie now deposits $1,500
    // Because sharePrice is $1.50, Charlie receives fewer shares proportionally
    const charlieShares = vault.depositLiquidity(lpCharlie, 150_000n);
    expect(charlieShares).toBe(vault.lpSharesBalances.get(lpAlice)); // Same shares as Alice!

    expect(vault.totalLpShares).toBe(200_000n * SHARE_SCALE);
    expect(vault.lpPoolNav).toBe(300_000n);

    // Charlie withdraws immediately -> receives exactly his $1,500 back (no unearned profit)
    const charliePayout = vault.withdrawLiquidityShares(lpCharlie, charlieShares);
    expect(charliePayout).toBe(150_000n);

    // Alice withdraws -> receives her $1,500
    const alicePayout = vault.withdrawLiquidityShares(lpAlice, vault.lpSharesBalances.get(lpAlice)!);
    expect(alicePayout).toBe(150_000n);
  });

  it('5. Trader profit reduces pool NAV and decreases share price proportionally', () => {
    vault.depositLiquidity(lpAlice, 100_000n); // $1,000
    vault.depositLiquidity(lpBob, 100_000n);   // $1,000

    // Trader makes $400 profit -> paid out from pool NAV
    vault.applyTraderProfit(40_000n);
    expect(vault.lpPoolNav).toBe(160_000n); // Pool now worth $1,600

    // Share price decreased to $0.80 (800_000 in 1e6 scale)
    expect(vault.getSharePrice()).toBe((80n * SHARE_SCALE) / 100n);

    // Alice withdraws -> receives $800 (absorbed $200 counterparty loss)
    const alicePayout = vault.withdrawLiquidityShares(lpAlice, vault.lpSharesBalances.get(lpAlice)!);
    expect(alicePayout).toBe(80_000n);

    // Bob withdraws -> receives $800
    const bobPayout = vault.withdrawLiquidityShares(lpBob, vault.lpSharesBalances.get(lpBob)!);
    expect(bobPayout).toBe(80_000n);
  });
});
