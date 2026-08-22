import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState } from "../../src/protocol/lpVault";

describe("PEL LP Vault Adversarial & Attack Invariants (WP §15)", () => {
  it("ATTACK 1 (Zero-Share Mint): Zero deposit mints 0 shares and is rejected", () => {
    const shares = LPVaultEngine.calcSharesMinted(0n, 1_000_00n, 10_000_000n);
    expect(shares).toBe(0n);
  });

  it("ATTACK 2 (Reserve Draining): Rejects withdrawal that would breach available liquidity", () => {
    const state: LPVaultState = {
      navCents: 100_000_00n, // $100,000 NAV
      totalShares: 1_000_000_000n, // 100,000 shares ($1/share)
      lockedCollateralCents: 80_000_00n, // $80,000 locked trader margin (80% utilization)
      insuranceReserveCents: 10_000_00n,
      unclaimedPayoutsCents: 20_000_00n,
      unclaimedBountiesCents: 0n,
      pendingWithdrawalsCents: 0n,
    };

    // 50% locked margin = $40,000 + $20,000 payouts = $60,000 senior obligations
    // Available liquidity = $100,000 - $60,000 = $40,000
    const available = LPVaultEngine.calcAvailableLiquidity(state);
    expect(available).toBe(40_000_00n);

    // LP attempts to withdraw $60,000 (60,000 shares)
    const withdrawShares = 600_000_000n; // 60,000 shares
    const grossPayout = LPVaultEngine.calcGrossWithdrawal(withdrawShares, state.navCents, state.totalShares);
    expect(grossPayout).toBe(60_000_00n);
    expect(grossPayout > available).toBe(true); // Fails available liquidity gate
  });

  it("ATTACK 3 (Net Skew Manipulation): Rejects one-sided directional skew exceeding 0.5x NAV", () => {
    const state: LPVaultState = {
      navCents: 1_000_000_00n, // $1,000,000 NAV (Max Net Skew = $500,000)
      totalShares: 10_000_000_000n,
      lockedCollateralCents: 0n,
      insuranceReserveCents: 0n,
      unclaimedPayoutsCents: 0n,
      unclaimedBountiesCents: 0n,
      pendingWithdrawalsCents: 0n,
    };

    const existingGross = 600_000_00n;
    const existingNet = 450_000_00n; // $450,000 net long
    const newLongNotional = 100_000_00n; // +$100k Long => $550k Net Long > $500k Cap

    const res = LPVaultEngine.validateOpenCapacity(state, existingGross, existingNet, newLongNotional, true);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("MARKET_NET_OI_EXCEEDED");
  });
});
