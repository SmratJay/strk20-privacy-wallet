import { describe, it, expect } from "vitest";
import { LPVaultEngine, LPVaultState } from "../../src/protocol/lpVault";

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

describe("PEL LP Vault Adversarial & Attack Invariants (WP §15)", () => {
  it("ATTACK 1 (Zero-Share Mint): Zero deposit mints 0 shares and is rejected", () => {
    const shares = LPVaultEngine.calcSharesMinted(0n, 1_000_00n, 10_000_000n);
    expect(shares).toBe(0n);
  });

  it("ATTACK 2 (Reserve Draining): Rejects withdrawal that would breach available liquidity", () => {
    const state = baseState({
      navCents: 100_000_00n, // $100,000 NAV
      totalShares: 1_000_000_000n, // 100,000 shares ($1/share)
      lockedCollateralCents: 80_000_00n, // $80,000 locked trader margin (80% utilization)
    });

    // Canonical: available = NAV - 50% locked margin reserve = $100k - $40k = $60k.
    const available = LPVaultEngine.calcAvailableLiquidity(state);
    expect(available).toBe(60_000_00n);

    // Withdrawing 80,000 shares = $80,000 gross > $60,000 available -> rejected.
    const withdrawShares = 800_000_000n;
    const grossPayout = LPVaultEngine.calcGrossWithdrawal(withdrawShares, state.navCents, state.totalShares);
    expect(grossPayout).toBe(80_000_00n);
    expect(grossPayout > available).toBe(true); // Fails available liquidity gate
  });

  it("ATTACK 3 (Utilization Limit): One-sided deployment is capped by 85% utilization", () => {
    // $1,000,000 NAV; single-position cap = $1,000 margin (5% NAV / 50x).
    const full = baseState({ navCents: 1_000_000_00n, lockedCollateralCents: 850_000_00n });
    // $100 margin pushes utilization to 85.01% > 85% -> rejected.
    const res = LPVaultEngine.validateOpenCapacity(full, 10_000n);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("UTILIZATION_LIMIT_EXCEEDED");

    // At 84% utilization a $100 margin passes.
    const ok = baseState({ navCents: 1_000_000_00n, lockedCollateralCents: 840_000_00n });
    expect(LPVaultEngine.validateOpenCapacity(ok, 10_000n).allowed).toBe(true);
  });

  it("ATTACK 4 (Single Whale): Position margin cannot imply >5% NAV notional", () => {
    const state = baseState({ navCents: 2_000_000_00n }); // $2M NAV
    // max single margin = 5% * 2M / 50 = $2,000
    expect(LPVaultEngine.maxSinglePositionMargin(state.navCents)).toBe(2_000_00n);
    expect(LPVaultEngine.validateOpenCapacity(state, 2_001_00n).allowed).toBe(false);
  });
});