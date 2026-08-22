import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState, SHARE_SCALE } from "../../src/protocol/lpVault";

describe("PEL LP Vault & Proportional Counterparty Economics (WP §6, §14)", () => {
  it("BOOTSTRAP: Mints initial shares at exactly 1.000000 USD/share", () => {
    const depositCents = 1_000_00n; // $1,000.00
    const shares = LPVaultEngine.calcSharesMinted(depositCents, 0n, 0n);
    expect(shares).toBe(1_000_000_000n); // 1,000 shares * 1e4 scaling
    const sharePrice = LPVaultEngine.calcSharePriceE6(depositCents, shares);
    expect(sharePrice).toBe(1_000_000n); // $1.000000
  });

  it("PROPORTIONAL PRICING: Share price increases proportionally on trader loss (+20%)", () => {
    const initialNav = 1_000_00n; // $1,000.00
    const totalShares = 1_000_000_000n; // 1,000 shares

    // Trader loses $200.00 (70% goes to LP NAV = +$140.00)
    const traderLossToLP = 140_00n;
    const newNav = initialNav + traderLossToLP; // $1,140.00

    const newSharePrice = LPVaultEngine.calcSharePriceE6(newNav, totalShares);
    expect(newSharePrice).toBe(1_140_000n); // $1.140000 / share
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

  it("RESERVE BUFFER: Available liquidity strictly guards 50% locked margin", () => {
    const state: LPVaultState = {
      navCents: 1_000_00n, // $1,000.00
      totalShares: 10_000_000n,
      lockedCollateralCents: 400_00n, // $400.00 locked trader margin
      insuranceReserveCents: 100_00n,
      unclaimedPayoutsCents: 50_00n,
      unclaimedBountiesCents: 10_00n,
      pendingWithdrawalsCents: 0n,
    };

    // 50% of $400 = $200 reserve buffer + $50 payouts + $10 bounties = $260 senior obligations
    // Available = $1,000 - $260 = $740.00 (74,000 cents)
    const available = LPVaultEngine.calcAvailableLiquidity(state);
    expect(available).toBe(740_00n);
  });

  it("UTILIZATION & CAPACITY: Rejects position open when Gross OI exceeds 2.0x NAV", () => {
    const state: LPVaultState = {
      navCents: 1_000_000_00n, // $1,000,000 NAV (Max Gross OI = $2,000,000)
      totalShares: 10_000_000_000n,
      lockedCollateralCents: 0n,
      insuranceReserveCents: 0n,
      unclaimedPayoutsCents: 0n,
      unclaimedBountiesCents: 0n,
      pendingWithdrawalsCents: 0n,
    };

    const existingGross = 1_800_000_00n; // $1.8M OI
    const existingNet = 500_000_00n;
    const newNotional = 300_000_00n; // +$300k OI => Total $2.1M > $2.0M Cap

    const res = LPVaultEngine.validateOpenCapacity(state, existingGross, existingNet, newNotional, true);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("MARKET_GROSS_OI_EXCEEDED");
  });
});
