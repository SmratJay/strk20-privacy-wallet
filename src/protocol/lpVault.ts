/**
 * @file src/protocol/lpVault.ts
 * @description Canonical LP Counterparty Vault & Share Accounting Mathematics
 *
 * THE SINGLE SOURCE OF TRUTH for LP share math, matching EXACTLY:
 *   - contracts/src/pel_liquidity_vault.cairo   (Cairo = economic law)
 *   - crates/pel-risk-engine/src/risk_engine.rs  (Rust = risk brain)
 *
 * Canonical unit system:
 *   - NAV units:        integer USD cents ($1.00 = 100 cents)
 *   - ERC20 base units: collateral token base units (USDC: 6 decimals)
 *   - Token multiplier: 1 cent = 10,000 base units (TOKEN_DECIMAL_MULTIPLIER)
 *   - Share units:      1 USD at bootstrap = SHARE_SCALE (1e6) shares
 *                        1 cent at bootstrap = SHARE_SCALE / 100 = 10,000 shares
 *   - Share price:      e6 fixed point of USD per share:
 *                         sharePriceE6 = NAV_cents * 1e6 * 1e4 / total_shares
 *
 * Economic model (V2):
 *   - Trader loss   -> LP receives the FULL loss (NAV += loss) — no 70/20/10 split
 *   - Trader profit -> LP pays the FULL profit (NAV -= profit)
 *   - Protocol revenue (liquidation remnants/fees) -> 70% LP / 20% insurance /
 *     10% treasury — every cent has a destination.
 *   - Conservation: token_balance_cents == locked + NAV + payouts + bounties
 *     + withdrawals + treasury (public custody path).
 *   - Withdrawal queue (Model A): shares burned at request, NAV reduced at request,
 *     queued shares never participate in subsequent PnL.
 */

export const SHARE_SCALE = 1_000_000n;         // 1e6 fixed point scale (1 USD = 1e6 shares)
export const TOKEN_DECIMAL_MULTIPLIER = 10_000n; // 1 cent = 10,000 micro-USDC (6 decimals)
export const RESERVE_BUFFER_BPS = 5000n;       // 50% locked margin reserve buffer
export const WITHDRAWAL_COOLDOWN_MS = 3600_000; // 1 hour (1 funding epoch) cooldown
export const MAX_UTILIZATION_BPS = 8500n;      // 85% max pool utilization cap
export const MAX_LEVERAGE = 50n;               // nominal max leverage
export const MAX_SINGLE_POSITION_BPS = 500n;   // 5% LP NAV single-position notional cap
export const LP_FEE_SHARE_BPS = 7000n;         // 70% protocol revenue -> LP NAV
export const INSURANCE_FEE_SHARE_BPS = 2000n;  // 20% protocol revenue -> insurance
export const TREASURY_FEE_SHARE_BPS = 1000n;   // 10% protocol revenue -> treasury
export const KEEPER_BOUNTY_BPS = 200n;         // 2% liquidation bounty
export const KEEPER_BOUNTY_CAP_CENTS = 50_000n; // $500.00 cap

export interface LPVaultState {
  navCents: bigint;
  totalShares: bigint;
  lockedCollateralCents: bigint;
  poolMarginCents: bigint;
  poolAssetsCents: bigint;
  insuranceReserveCents: bigint;
  unclaimedPayoutsCents: bigint;
  unclaimedBountiesCents: bigint;
  pendingWithdrawalsCents: bigint;
  treasuryCents: bigint;
  badDebtCents: bigint;
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
  /** Calculate current share price in 1e6 fixed point representation. */
  static calcSharePriceE6(navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n) return SHARE_SCALE;
    return (navCents * SHARE_SCALE * 10_000n) / totalShares;
  }

  /** Calculate shares minted for a deposit amount in cents (canonical bootstrap). */
  static calcSharesMinted(amountCents: bigint, navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n || navCents <= 0n) {
      // 1 cent -> SHARE_SCALE/100 = 10,000 shares (1 USD = 1e6 shares)
      return amountCents * (SHARE_SCALE / 100n);
    }
    return (amountCents * totalShares) / navCents;
  }

  /** Calculate gross withdrawal payout for burned shares (cents). */
  static calcGrossWithdrawal(sharesBurned: bigint, navCents: bigint, totalShares: bigint): bigint {
    if (totalShares <= 0n) return 0n;
    return (sharesBurned * navCents) / totalShares;
  }

  /** Available liquidity = NAV - counterparty reserve buffer (50% of locked margin).
   *  Derived from the canonical conservation identity (tokens == locked + NAV +
   *  payouts + bounties + withdrawals + treasury), so obligations cancel and
   *  available == NAV - reserve_buffer. No double-counting. */
  static calcAvailableLiquidity(state: LPVaultState): bigint {
    const reserveBuffer = ((state.lockedCollateralCents + state.poolMarginCents) * RESERVE_BUFFER_BPS) / 10_000n;
    if (state.navCents > reserveBuffer) {
      return state.navCents - reserveBuffer;
    }
    return 0n;
  }

  /** Economic NAV = assets - obligations. */
  static calcEconomicNav(state: LPVaultState): bigint {
    const assets = state.navCents; // LP NAV is the share value
    const obligations =
      state.lockedCollateralCents +
      state.poolMarginCents +
      state.unclaimedPayoutsCents +
      state.unclaimedBountiesCents +
      state.pendingWithdrawalsCents +
      state.treasuryCents;
    // Economic NAV of the LP share book excludes the vault's own liability buckets:
    // LP value is already `navCents`. This reports overall solvency backing instead.
    return assets > obligations ? assets - obligations : 0n;
  }

  /** Calculate pool utilization ratio in basis points (100% = 10,000 bps). */
  static calcUtilizationBps(state: LPVaultState): number {
    const locked = state.lockedCollateralCents + state.poolMarginCents;
    if (state.navCents <= 0n) {
      return locked > 0n ? 10_000 : 0;
    }
    const ratio = (locked * 10_000n) / state.navCents;
    return Number(ratio > 10_000n ? 10_000n : ratio);
  }

  /** Conservative single-position cap on margin: margin * MAX_LEVERAGE <= 5% NAV. */
  static maxSinglePositionMargin(navCents: bigint): bigint {
    return (navCents * MAX_SINGLE_POSITION_BPS) / (10_000n * MAX_LEVERAGE);
  }

  /** Validate opening a new position against the authoritative protocol gates. */
  static validateOpenCapacity(
    state: LPVaultState,
    newMarginCents: bigint
  ): { allowed: boolean; reason?: string } {
    const maxSingle = this.maxSinglePositionMargin(state.navCents);
    if (newMarginCents > maxSingle) {
      return { allowed: false, reason: 'SINGLE_POSITION_CAP_EXCEEDED' };
    }

    const lockedAfter = state.lockedCollateralCents + state.poolMarginCents + newMarginCents;
    const ratio = (lockedAfter * 10_000n) / state.navCents;
    if (ratio > MAX_UTILIZATION_BPS) {
      return { allowed: false, reason: 'UTILIZATION_LIMIT_EXCEEDED' };
    }

    const avail = this.calcAvailableLiquidity(state);
    if (avail < newMarginCents) {
      return { allowed: false, reason: 'INSUFFICIENT_POOL_LIQUIDITY' };
    }

    return { allowed: true };
  }

  /** Protocol revenue split (liquidation remnants & fees). Every cent routed. */
  static splitRevenue(netCents: bigint): { lp: bigint; insurance: bigint; treasury: bigint } {
    const lp = (netCents * LP_FEE_SHARE_BPS) / 10_000n;
    const insurance = (netCents * INSURANCE_FEE_SHARE_BPS) / 10_000n;
    const treasury = netCents - lp - insurance; // treasury absorbs rounding
    return { lp, insurance, treasury };
  }
}