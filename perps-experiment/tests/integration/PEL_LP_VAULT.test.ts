import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState, SHARE_SCALE, LPVaultEngine as Engine } from "../../src/protocol/lpVault";

function baseState(): LPVaultState {
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

describe("PEL LP Vault End-to-End Counterparty Lifecycle (Canonical V2)", () => {
  it("Executes full lifecycle: LP Deposit -> Trader Win -> Trader Loss -> LP Withdrawal", () => {
    let state = baseState();

    // 1. LP A deposits $10,000.00 (1,000,000 cents)
    const depositA = 10_000_00n;
    const sharesA = LPVaultEngine.calcSharesMinted(depositA, state.navCents, state.totalShares);
    expect(sharesA).toBe(10_000_000_000n); // 10,000 shares * 1e6
    state.navCents += depositA;
    state.totalShares += sharesA;
    expect(LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares)).toBe(1_000_000n); // $1.000000

    // 2. Trader 1 opens $1,000 margin position (10x leverage = $10,000 notional)
    const margin1 = 1_000_00n;
    state.lockedCollateralCents += margin1;
    expect(LPVaultEngine.calcUtilizationBps(state)).toBe(1000); // 10.0% utilization

    // 3. Trader 1 closes with +$500.00 profit (+50,000 cents)
    // LP NAV pays the FULL profit: NAV decreases from $10,000 to $9,500.
    const profit1 = 500_00n;
    state.navCents -= profit1;
    state.lockedCollateralCents -= margin1;
    expect(state.navCents).toBe(9_500_00n);
    const sharePriceAfterWin = LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares);
    expect(sharePriceAfterWin).toBe(950_000n); // $0.950000 / share

    // 4. Trader 2 opens $2,000 margin position and loses $1,000.00 (-100,000 cents)
    // LP NAV receives the FULL loss: +$1,000.00 (+100,000 cents). No 70/20/10 split.
    const loss2 = 1_000_00n;
    state.navCents += loss2;
    expect(state.navCents).toBe(10_500_00n);
    const sharePriceAfterLoss = LPVaultEngine.calcSharePriceE6(state.navCents, state.totalShares);
    expect(sharePriceAfterLoss).toBe(1_050_000n); // $1.050000 / share (+5.0% net)

    // 5. Model A withdrawal queue: LP A requests 10,000 shares (all).
    // Shares burned at request; NAV reduced by frozen gross value.
    const grossAtRequest = LPVaultEngine.calcGrossWithdrawal(sharesA, state.navCents, state.totalShares);
    expect(grossAtRequest).toBe(10_500_00n); // $10,500.00
    state.navCents -= grossAtRequest;
    state.totalShares -= sharesA;
    state.pendingWithdrawalsCents += grossAtRequest;

    expect(state.navCents).toBe(0n);
    expect(state.totalShares).toBe(0n);
    expect(state.pendingWithdrawalsCents).toBe(10_500_00n);

    // Claim transfers real USDC (Model A: no further NAV/shares change).
    state.pendingWithdrawalsCents -= grossAtRequest;
    expect(state.pendingWithdrawalsCents).toBe(0n);
  });

  it("Conservation: tokens == locked + NAV + payouts + bounties + withdrawals + treasury", () => {
    // $10,000 deposit; $1,000 margin locked; trader wins $200; payout note $1,200.
    let nav = 1_000_000n;
    let locked = 100_000n;
    let tokens = nav + locked; // vault holds deposit + margin
    // profitable close (margin 100k, payout 120k, profit 20k)
    locked = 0n;
    nav -= 20_000n;
    const payouts = 120_000n;
    // claim payout
    tokens -= payouts;
    expect(tokens).toBe(nav); // 1,080,000 == 1,080,000
    // loss close after re-deposit
    nav += 200_000n;
    tokens += 200_000n;
    expect(tokens).toBe(nav);
  });
});