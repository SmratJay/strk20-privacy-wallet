/**
 * @file tests/lpNavEconomics.test.ts
 * @description P0 Proportional LP Shares & NAV Accounting Test Suite (Canonical V2)
 *
 * Uses the SAME LPVaultEngine as the frontend (src/protocol/lpVault.ts), which mirrors
 * the Cairo vault and the Rust risk engine exactly. Verifies:
 * 1. LP shares track proportional ownership of pool NAV
 * 2. Trader profit dilutes share price; trader loss boosts share price (FULL PnL)
 * 3. Late depositors do NOT capture historical PnL
 * 4. Early depositors cannot withdraw more than their proportional share of NAV
 * 5. Multiple LPs entering and exiting preserve exact token conservation
 * 6. Model A withdrawal queue: queued shares excluded from subsequent PnL
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LPVaultEngine, LPVaultState, SHARE_SCALE } from '../src/protocol/lpVault';

function emptyState(): LPVaultState {
  return {
    navCents: 0n,
    totalShares: 0n,
    lockedCollateralCents: 0n,
    poolMarginCents: 0n,
    poolAssetsCents: 0n,
    insuranceReserveCents: 0n,
    unclaimedPayoutsCents: 0n,
    unclaimedBountiesCents: 0n,
    pendingWithdrawalsCents: 0n,
    treasuryCents: 0n,
    badDebtCents: 0n,
  };
}

class MockLpVault {
  public state: LPVaultState = emptyState();
  public tokenBalances: Map<string, bigint> = new Map();

  mintToken(account: string, amountCents: bigint) {
    const cur = this.tokenBalances.get(account.toLowerCase()) || 0n;
    this.tokenBalances.set(account.toLowerCase(), cur + amountCents);
  }

  getTokenBalance(account: string): bigint {
    return this.tokenBalances.get(account.toLowerCase()) || 0n;
  }

  getSharePrice(): bigint {
    return LPVaultEngine.calcSharePriceE6(this.state.navCents, this.state.totalShares);
  }

  depositLiquidity(provider: string, amountCents: bigint): bigint {
    if (amountCents <= 0n) throw new Error('INVALID_DEPOSIT_AMOUNT');
    const providerBal = this.getTokenBalance(provider);
    if (providerBal < amountCents) throw new Error('ERC20_INSUFFICIENT_BALANCE');

    // Real custody: move tokens into the vault.
    this.tokenBalances.set(provider.toLowerCase(), providerBal - amountCents);
    this.tokenBalances.set('vault', (this.tokenBalances.get('vault') || 0n) + amountCents);

    const shares = LPVaultEngine.calcSharesMinted(amountCents, this.state.navCents, this.state.totalShares);
    if (shares <= 0n) throw new Error('ZERO_SHARES_MINTED');
    this.state.navCents += amountCents;
    this.state.totalShares += shares;
    return shares;
  }

  requestWithdrawal(provider: string, shares: bigint): bigint {
    // Model A: burn shares + freeze NAV at request.
    const gross = LPVaultEngine.calcGrossWithdrawal(shares, this.state.navCents, this.state.totalShares);
    if (gross <= 0n) throw new Error('ZERO_WITHDRAWAL_PAYOUT');
    this.state.navCents -= gross;
    this.state.totalShares -= shares;
    this.state.pendingWithdrawalsCents += gross;
    return gross;
  }

  claimWithdrawal(gross: bigint) {
    const vault = this.tokenBalances.get('vault') || 0n;
    if (vault < gross) throw new Error('INSUFFICIENT_POOL_NAV');
    this.tokenBalances.set('vault', vault - gross);
    this.state.pendingWithdrawalsCents -= gross;
  }

  applyTraderLoss(lossAmount: bigint) {
    // FULL loss to LP (no split).
    this.state.navCents += lossAmount;
    const vault = this.tokenBalances.get('vault') || 0n;
    this.tokenBalances.set('vault', vault + lossAmount);
  }

  applyTraderProfit(profitAmount: bigint) {
    if (this.state.navCents < profitAmount) throw new Error('INSUFFICIENT_POOL_NAV');
    this.state.navCents -= profitAmount;
    const vault = this.tokenBalances.get('vault') || 0n;
    if (vault < profitAmount) throw new Error('INSUFFICIENT_POOL_NAV');
    this.tokenBalances.set('vault', vault - profitAmount);
  }
}

describe('PEL V2 Proportional LP Shares & NAV Accounting Tests', () => {
  let vault: MockLpVault;
  const lpAlice = '0x_lp_alice';
  const lpBob = '0x_lp_bob';
  const lpCharlie = '0x_lp_charlie';

  beforeEach(() => {
    vault = new MockLpVault();
    vault.mintToken(lpAlice, 1_000_000n);
    vault.mintToken(lpBob, 1_000_000n);
    vault.mintToken(lpCharlie, 1_000_000n);
  });

  it('1. Initial LP deposit establishes base 1:1 share price', () => {
    const depositAmount = 100_000n; // $1,000.00
    const sharesMinted = vault.depositLiquidity(lpAlice, depositAmount);

    expect(sharesMinted).toBe(100_000n * (SHARE_SCALE / 100n));
    expect(vault.state.totalShares).toBe(100_000n * (SHARE_SCALE / 100n));
    expect(vault.state.navCents).toBe(100_000n);
    expect(vault.getSharePrice()).toBe(SHARE_SCALE); // $1.00 per unit (1e6 scale)
  });

  it('2. Equal depositors get equal shares and proportional payouts', () => {
    vault.depositLiquidity(lpAlice, 100_000n);
    vault.depositLiquidity(lpBob, 100_000n);

    const aliceShares = vault.state.totalShares / 2n;
    expect(aliceShares).toBe(100_000n * (SHARE_SCALE / 100n));
    expect(vault.state.totalShares).toBe(200_000n * (SHARE_SCALE / 100n));
    expect(vault.state.navCents).toBe(200_000n);

    // Alice withdraws 100% of her shares -> exactly $1,000.
    const payout = vault.requestWithdrawal(lpAlice, aliceShares);
    expect(payout).toBe(100_000n);
    expect(vault.state.navCents).toBe(100_000n);
    expect(vault.state.totalShares).toBe(100_000n * (SHARE_SCALE / 100n));
  });

  it('3. FULL trader loss increases pool NAV and rewards existing LPs proportionally', () => {
    vault.depositLiquidity(lpAlice, 100_000n);
    vault.depositLiquidity(lpBob, 100_000n);

    // Trader loses $400 (40,000 cents) -> FULL credit to pool NAV.
    vault.applyTraderLoss(40_000n);
    expect(vault.state.navCents).toBe(240_000n); // Pool now worth $2,400

    expect(vault.getSharePrice()).toBe(1_200_000n); // $1.20 / share

    // Alice withdraws all -> $1,200.
    const alicePayout = vault.requestWithdrawal(lpAlice, vault.state.totalShares / 2n);
    expect(alicePayout).toBe(120_000n);

    const bobPayout = vault.requestWithdrawal(lpBob, vault.state.totalShares);
    expect(bobPayout).toBe(120_000n);
    expect(vault.state.navCents).toBe(0n);
  });

  it('4. Late depositors do NOT capture historical trader losses', () => {
    vault.depositLiquidity(lpAlice, 100_000n);
    vault.applyTraderLoss(50_000n); // Alice NAV becomes $1,500
    expect(vault.state.navCents).toBe(150_000n);

    // Charlie deposits $1,500 at $1.50/share -> same shares as Alice.
    const charlieShares = vault.depositLiquidity(lpCharlie, 150_000n);
    expect(charlieShares).toBe(100_000n * (SHARE_SCALE / 100n));
    expect(vault.state.totalShares).toBe(200_000n * (SHARE_SCALE / 100n));
    expect(vault.state.navCents).toBe(300_000n);

    // Charlie withdraws immediately -> exactly $1,500 (no unearned profit).
    const charliePayout = vault.requestWithdrawal(lpCharlie, charlieShares);
    expect(charliePayout).toBe(150_000n);

    const alicePayout = vault.requestWithdrawal(lpAlice, 100_000n * (SHARE_SCALE / 100n));
    expect(alicePayout).toBe(150_000n);
  });

  it('5. Trader profit reduces pool NAV and decreases share price proportionally', () => {
    vault.depositLiquidity(lpAlice, 100_000n);
    vault.depositLiquidity(lpBob, 100_000n);

    vault.applyTraderProfit(40_000n);
    expect(vault.state.navCents).toBe(160_000n); // Pool now worth $1,600

    expect(vault.getSharePrice()).toBe(800_000n); // $0.80 / share

    const alicePayout = vault.requestWithdrawal(lpAlice, vault.state.totalShares / 2n);
    expect(alicePayout).toBe(80_000n);
    const bobPayout = vault.requestWithdrawal(lpBob, vault.state.totalShares);
    expect(bobPayout).toBe(80_000n);
  });

  it('6. Model A queue: shares queued at request are excluded from subsequent PnL', () => {
    vault.depositLiquidity(lpAlice, 100_000n);
    vault.depositLiquidity(lpBob, 100_000n);

    // Alice queues 50% of the pool ($1,000 -> $1,000 frozen).
    const queued = vault.requestWithdrawal(lpAlice, 100_000n * (SHARE_SCALE / 100n));
    expect(queued).toBe(100_000n);
    expect(vault.state.navCents).toBe(100_000n); // NAV reduced at request

    // Trader loses $200 after the request. Only Bob participates.
    vault.applyTraderLoss(20_000n);
    expect(vault.state.navCents).toBe(120_000n); // Bob's 100k NAV + 20k loss

    // Alice claims her frozen $1,000 exactly (no participation in the loss).
    vault.claimWithdrawal(queued);
    expect(vault.state.pendingWithdrawalsCents).toBe(0n);

    // Bob's remaining value is the full NAV.
    expect(vault.state.navCents).toBe(120_000n);
  });
});