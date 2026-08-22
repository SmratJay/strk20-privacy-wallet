/**
 * @file src/protocol/lpVault.ts
 * @description Canonical LP Counterparty Vault & Share Accounting Mathematics
 *
 * Implements Whitepaper Sections 6, 7, 9 & 14:
 * - Proportional LP Share Pricing: sharePrice = (NAV * 1e6) / totalShares
 * - Deposit: sharesMinted = floor(depositAmount * totalShares / NAV)
 * - Withdrawal: grossWithdrawal = floor(sharesBurned * NAV / totalShares)
 * - Reserve Buffer: 50% locked margin requirement
 * - Solvency: Available Liquidity = NAV - LockedMarginBuffer - SeniorObligations
 * - Anti-Inflation Virtual Shares Bootstrap
 */

export const SHARE_SCALE = 1_000_000n;         // 1e6 fixed point scale
export const TOKEN_DECIMAL_MULTIPLIER = 10_000n; // 1 cent = 10,000 micro-USDC (6 decimals)
export const RESERVE_BUFFER_BPS = 5000n;       // 50% locked margin reserve buffer
export const WITHDRAWAL_COOLDOWN_MS = 3600_000; // 1 hour (1 funding epoch) cooldown
export const MAX_UTILIZATION_BPS = 8500n;      // 85% max pool utilization cap

export interface LPVaultState {
  navCents: bigint;
  totalShares: bigint;
  lockedCollateralCents: bigint;
  insuranceReserveCents: bigint;
  unclaimedPayoutsCents: bigint;
  unclaimedBountiesCents: bigint;
  pendingWithdrawalsCents: bigint;
}

export interface LPPosition {
  provider: string;
  shares: bigint;
  depositTimestampMs: number;
}

export interface LPWithdrawalRequest {
  requestId: bigint;
  provider: string;
  shares: bigint;
  grossCents: bigint;
  requestTimestampMs: number;
  isClaimed: boolean;
}

export class LPVaultEngine {
  /** Calculate current share price in 1e6 fixed point representation */
  static calcSharePriceE6(navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n) return SHARE_SCALE;
    return (navCents * SHARE_SCALE * 10_000n) / totalShares;
  }

  /** Calculate shares minted for a deposit amount in cents */
  static calcSharesMinted(amountCents: bigint, navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n || navCents <= 0n) {
      // 1 USD ( = 100 cents) = 1 share (scaled by 1e6 / 100 = 10,000)
      return amountCents * (SHARE_SCALE / 100n);
    }
    return (amountCents * totalShares) / navCents;
  }

  /** Calculate gross withdrawal payout for burned shares */
  static calcGrossWithdrawal(sharesBurned: bigint, navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n) return 0n;
    return (sharesBurned * navCents) / totalShares;
  }

  /** Calculate available withdrawable liquidity strictly respecting senior reserve requirements */
  static calcAvailableLiquidity(state: LPVaultState): bigint {
    const reserveBuffer = (state.lockedCollateralCents * RESERVE_BUFFER_BPS) / 10_000n;
    const totalSenior = reserveBuffer + state.unclaimedPayoutsCents + state.unclaimedBountiesCents + state.pendingWithdrawalsCents;
    if (state.navCents > totalSenior) {
      return state.navCents - totalSenior;
    }
    return 0n;
  }

  /** Calculate pool utilization ratio in basis points (100% = 10,000 bps) */
  static calcUtilizationBps(state: LPVaultState): number {
    if (state.navCents <= 0n) {
      return state.lockedCollateralCents > 0n ? 10_000 : 0;
    }
    const ratio = (state.lockedCollateralCents * 10_000n) / state.navCents;
    return Number(ratio > 10_000n ? 10_000n : ratio);
  }

  /** Validate if a new position can be opened against current capacity limits */
  static validateOpenCapacity(
    state: LPVaultState,
    existingGrossNotionalCents: bigint,
    existingNetNotionalCents: bigint,
    newNotionalCents: bigint,
    isLong: boolean
  ): { allowed: boolean; reason?: string } {
    const maxGrossOI = (state.navCents * 200n) / 100n; // 2.0x NAV
    const maxNetOI = (state.navCents * 50n) / 100n;    // 0.5x NAV

    const updatedGross = existingGrossNotionalCents + newNotionalCents;
    if (updatedGross > maxGrossOI) {
      return { allowed: false, reason: 'MARKET_GROSS_OI_EXCEEDED' };
    }

    const updatedNet = isLong
      ? existingNetNotionalCents + newNotionalCents
      : existingNetNotionalCents - newNotionalCents;

    const absNet = updatedNet < 0n ? -updatedNet : updatedNet;
    if (absNet > maxNetOI) {
      return { allowed: false, reason: 'MARKET_NET_OI_EXCEEDED' };
    }

    const avail = this.calcAvailableLiquidity(state);
    if (avail < newNotionalCents / 50n) { // margin requirement
      return { allowed: false, reason: 'INSUFFICIENT_POOL_LIQUIDITY' };
    }

    return { allowed: true };
  }
}
