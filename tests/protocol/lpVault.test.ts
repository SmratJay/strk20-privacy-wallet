import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState, SHARE_SCALE, MAX_UTILIZATION_BPS } from "../../src/protocol/lpVault";

function baseState(overrides: Partial<LPVaultState> = {}): LPVaultState {
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
    ...overrides,
  };
}

describe("PEL LP Vault & Proportional Counterparty Economics (WP §6, §14)", () => {
  it("BOOTSTRAP: Mints initial shares at exactly 1.000000 USD/share", () => {
    const depositCents = 1_000_00n; // $1,000.00
    const shares = LPVaultEngine.calcSharesMinted(depositCents, 0n, 0n);
    expect(shares).toBe(1_000_000_000n); // 1,000 shares * 1e6/100 share scale
    const sharePrice = LPVaultEngine.calcSharePriceE6(depositCents, shares);
    expect(sharePrice).toBe(1_000_000n); // $1.000000
  });

  it("PROPORTIONAL PRICING: Share price increases proportionally on FULL trader loss", () => {
    const initialNav = 1_000_00n; // $1,000.00
    const totalShares = 1_000_000_000n; // 1,000 shares

    // Trader loses $200.00 -> LP receives the FULL loss (no 70/20/10 split).
    const traderLoss = 200_00n;
    const newNav = initialNav + traderLoss; // $1,200.00

    const newSharePrice = LPVaultEngine.calcSharePriceE6(newNav, totalShares);
    expect(newSharePrice).toBe(1_200_000n); // $1.200000 / share
  });

  it("LATE DEPOSITOR FAIRNESS: New LP does NOT capture historical trader losses", () => {
    const initialNav = 1_500_00n; // Pool grew from $1,000 to $1,500
    const totalShares = 1_000_000_000n; // 1,000 shares (Share price = $1.50)

    // New LP deposits $1,500.00
    const newDeposit = 1_500_00n;
    const sharesMinted = LPVaultEngine.calcSharesMinted(newDeposit, initialNav, totalShares);
    expect(sharesMinted).toBe(1_000_000_000n); // Gets exactly 1,000 shares

    const updatedNav = initialNav + newDeposit; // $3,000.00
    const updatedShares = totalShares + sharesMinted; // 2,000 shares
    const updatedSharePrice = LPVaultEngine.calcSharePriceE6(updatedNav, updatedShares);
    expect(updatedSharePrice).toBe(1_500_000n); // Share price remains $1.500000
  });

  it("RESERVE BUFFER: Available liquidity = NAV - 50% locked margin reserve", () => {
    const state = baseState({
      navCents: 1_000_00n, // $1,000.00
      totalShares: 10_000_000n,
      lockedCollateralCents: 400_00n, // $400.00 locked trader margin
    });

    // 50% of $400 = $200 reserve buffer. Available = $1,000 - $200 = $800.00.
    // Payouts/bounties/withdrawals are ALREADY deducted from NAV (they are not
    // double-counted obligations in the canonical model).
    const available = LPVaultEngine.calcAvailableLiquidity(state);
    expect(available).toBe(800_00n);
  });

  it("UTILIZATION GATE: Rejects a position that would breach the 85% utilization cap", () => {
    // $1,000,000 NAV with $850,000 already locked (85%). Single-position cap for this
    // pool is $1,000 margin; a $100 margin (10,000 cents) keeps us under the cap while
    // breaching utilization once locked hits 85.01%.
    const state = baseState({
      navCents: 1_000_000_00n,
      lockedCollateralCents: 850_000_00n,
    });
    const res = LPVaultEngine.validateOpenCapacity(state, 10_000n); // $100
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("UTILIZATION_LIMIT_EXCEEDED");
  });

  it("SINGLE POSITION CAP: Rejects a position whose margin implies >5% NAV notional", () => {
    const state = baseState({
      navCents: 1_000_000_00n, // $1,000,000 NAV
    });
    // Max single-position margin = 5% * NAV / 50x = $1,000.
    const maxSingle = LPVaultEngine.maxSinglePositionMargin(state.navCents);
    expect(maxSingle).toBe(1_000_00n);

    // $1,001 exceeds the cap.
    const res = LPVaultEngine.validateOpenCapacity(state, 1_001_00n);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("SINGLE_POSITION_CAP_EXCEEDED");

    // Exactly at cap is allowed.
    const ok = LPVaultEngine.validateOpenCapacity(state, 1_000_00n);
    expect(ok.allowed).toBe(true);
  });

  it("REVENUE SPLIT: liquidation remnant routes 70/20/10 with every cent destined", () => {
    const split = LPVaultEngine.splitRevenue(10_000n);
    expect(split.lp).toBe(7_000n);
    expect(split.insurance).toBe(2_000n);
    expect(split.treasury).toBe(1_000n);
    expect(split.lp + split.insurance + split.treasury).toBe(10_000n);

    // Rounding: remainder flows to treasury so nothing is discarded.
    const split2 = LPVaultEngine.splitRevenue(10_001n);
    expect(split2.lp + split2.insurance + split2.treasury).toBe(10_001n);
  });
});