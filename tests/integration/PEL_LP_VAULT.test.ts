import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState } from "../../src/protocol/lpVault";

describe("PEL LP Vault End-to-End Counterparty Lifecycle (WP §4, §6)", () => {
  it("Executes full lifecycle: LP Deposit -> Trader Win -> Trader Loss -> LP Withdrawal", () => {
    // 1. Initial State: Empty Pool
    let state: LPVaultState = {
      navCents: 0n,
      totalShares: 0n,
      lockedCollateralCents: 0n,
      insuranceReserveCents: 0n,
      unclaimedPayoutsCents: 0n,
      unclaimedBountiesCents: 0n,
      pendingWithdrawalsCents: 0n,
    };

    // 2. LP A deposits $10,000.00 (1,000,000 cents)
    const depositA = 10_000_00n;
    const sharesA = LPVaultEngine.calcSharesMinted(depositA, state.navCents, state.totalShares);
    expect(sharesA).toBe(10_000_000_000n); // 10,000 shares * 1e4
    state.navCents += depositA;
    state.totalShares += sharesA;
    expect(LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares)).toBe(1_000_000n); // $1.000000

    // 3. Trader 1 opens $1,000 margin position (10x leverage = $10,000 notional)
    const margin1 = 1_000_00n;
    state.lockedCollateralCents += margin1;
    expect(LPVaultEngine.calcUtilizationBps(state)).toBe(1000); // 10.0% utilization

    // 4. Trader 1 closes with +$500.00 profit (+50,000 cents)
    // LP NAV pays the profit: NAV decreases from $10,000 to $9,500
    const profit1 = 500_00n;
    state.navCents -= profit1;
    state.lockedCollateralCents -= margin1;
    expect(state.navCents).toBe(9_500_00n);
    const sharePriceAfterWin = LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares);
    expect(sharePriceAfterWin).toBe(950_000n); // $0.950000 / share

    // 5. Trader 2 opens $2,000 margin position and loses $1,000.00 (-100,000 cents)
    // LP NAV receives 70% of loss = +$700.00 (+70,000 cents); 20% to Insurance = +$200.00
    const loss2 = 1_000_00n;
    const lpGain = (loss2 * 7000n) / 10000n;
    const insuranceGain = (loss2 * 2000n) / 10000n;
    state.navCents += lpGain; // $9,500 + $700 = $10,200
    state.insuranceReserveCents += insuranceGain; // $200

    expect(state.navCents).toBe(10_200_00n);
    expect(state.insuranceReserveCents).toBe(200_00n);
    const sharePriceAfterLoss = LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares);
    expect(sharePriceAfterLoss).toBe(1_020_000n); // $1.020000 / share (+2.0% net gain)

    // 6. LP A withdraws all 10,000 shares
    const grossPayout = LPVaultEngine.calcGrossWithdrawal(sharesA, state.navCents, state.totalShares);
    expect(grossPayout).toBe(10_200_00n); // Receives $10,200.00 USDC exactly
  });
});
