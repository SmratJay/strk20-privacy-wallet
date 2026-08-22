use crate::types::*;

pub struct RiskEngine;

impl RiskEngine {
    /// Calculate linear PnL in cents matching Cairo and Circom integer arithmetic:
    /// Long:  PnL = (q * (P - e)) / QTY_SCALE
    /// Short: PnL = (q * (e - P)) / QTY_SCALE
    pub fn calc_pnl_cents(side: Side, quantity_sats: u128, entry_price_cents: u128, mark_price_cents: u128) -> i64 {
        match side {
            Side::Long => {
                if mark_price_cents >= entry_price_cents {
                    let diff = mark_price_cents - entry_price_cents;
                    let prod = quantity_sats * diff;
                    (prod / QTY_SCALE) as i64
                } else {
                    let diff = entry_price_cents - mark_price_cents;
                    let prod = quantity_sats * diff;
                    -((prod / QTY_SCALE) as i64)
                }
            }
            Side::Short => {
                if entry_price_cents >= mark_price_cents {
                    let diff = entry_price_cents - mark_price_cents;
                    let prod = quantity_sats * diff;
                    (prod / QTY_SCALE) as i64
                } else {
                    let diff = mark_price_cents - entry_price_cents;
                    let prod = quantity_sats * diff;
                    -((prod / QTY_SCALE) as i64)
                }
            }
        }
    }

    /// Calculate trader equity: E = m + PnL - funding - fees
    pub fn calc_equity_cents(margin_cents: u128, pnl_cents: i64, funding_accrued_cents: i64, fee_cents: u128) -> i64 {
        let m = margin_cents as i64;
        let fees = fee_cents as i64;
        m + pnl_cents - funding_accrued_cents - fees
    }

    /// Calculate maintenance margin requirement in cents: M_maint = (q * P * maintenance_bps) / (QTY_SCALE * 10,000)
    pub fn calc_maintenance_margin_cents(quantity_sats: u128, mark_price_cents: u128, maintenance_bps: u128) -> u128 {
        let notional = (quantity_sats * mark_price_cents) / QTY_SCALE;
        (notional * maintenance_bps) / BPS_DIVISOR
    }

    /// Evaluate liquidation predicate: Liquidate iff Equity <= MaintenanceMargin
    pub fn evaluate_liquidation(
        position: &Position,
        mark_price_cents: u128,
        maintenance_bps: u128,
    ) -> LiquidationResult {
        let pnl = Self::calc_pnl_cents(position.side, position.quantity_sats, position.entry_price_cents, mark_price_cents);
        let equity = Self::calc_equity_cents(position.margin_cents, pnl, position.funding_accrued_cents, 0);
        let maint = Self::calc_maintenance_margin_cents(position.quantity_sats, mark_price_cents, maintenance_bps);

        if equity <= (maint as i64) {
            let seized = if equity > 0 {
                equity as u128
            } else {
                position.margin_cents
            };

            let raw_bounty = (seized * KEEPER_BOUNTY_BPS) / BPS_DIVISOR;
            let keeper_bounty = raw_bounty.min(KEEPER_BOUNTY_CAP_CENTS);
            let net_seized = if seized >= keeper_bounty { seized - keeper_bounty } else { 0 };

            // Revenue split (liquidation remnant) — every cent has a destination:
            // 70% LP / 20% insurance / 10% treasury (treasury takes the remainder).
            let lp_gain = (net_seized * LP_FEE_SHARE_BPS) / BPS_DIVISOR;
            let insurance_gain = (net_seized * INSURANCE_FEE_SHARE_BPS) / BPS_DIVISOR;
            let treasury_gain = net_seized - lp_gain - insurance_gain;

            let bad_debt = if equity < 0 { (-equity) as u128 } else { 0 };

            LiquidationResult {
                is_liquidatable: true,
                equity_cents: equity,
                maintenance_margin_cents: maint,
                seized_collateral_cents: seized,
                keeper_bounty_cents: keeper_bounty,
                lp_gain_cents: lp_gain,
                insurance_gain_cents: insurance_gain,
                treasury_gain_cents: treasury_gain,
                bad_debt_cents: bad_debt,
            }
        } else {
            LiquidationResult {
                is_liquidatable: false,
                equity_cents: equity,
                maintenance_margin_cents: maint,
                seized_collateral_cents: 0,
                keeper_bounty_cents: 0,
                lp_gain_cents: 0,
                insurance_gain_cents: 0,
                treasury_gain_cents: 0,
                bad_debt_cents: 0,
            }
        }
    }

    // ─── CANONICAL LP SHARE MATH ─────────────────────────────────────────────
    // MUST match contracts/src/pel_liquidity_vault.cairo and src/protocol/lpVault.ts
    // exactly (verified by executable golden vectors):
    //   bootstrap: 1 cent -> SHARE_SCALE/100 = 10,000 shares (1 USD = 1e6 shares)
    //   sharePriceE6 = NAV_cents * SHARE_SCALE * 10_000 / total_shares
    //   grossWithdrawal = shares * NAV / total_shares

    /// Calculate pool share price in 1e6 fixed-point USD per share.
    pub fn calc_share_price_e6(nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 {
            SHARE_SCALE
        } else {
            (nav_cents * SHARE_SCALE * 10_000) / total_shares
        }
    }

    /// Calculate shares minted for a deposit (canonical bootstrap + proportional).
    pub fn calc_shares_minted(amount_cents: u128, nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 || nav_cents == 0 {
            amount_cents * (SHARE_SCALE / 100)
        } else {
            (amount_cents * total_shares) / nav_cents
        }
    }

    /// Calculate gross withdrawal payout in cents.
    pub fn calc_gross_withdrawal(shares: u128, nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 {
            0
        } else {
            (shares * nav_cents) / total_shares
        }
    }

    /// Available liquidity = NAV - counterparty reserve buffer (50% of locked margin).
    /// Derived from the canonical conservation identity
    /// (tokens == locked + NAV + payouts + bounties + withdrawals + treasury), so
    /// obligations cancel and available == NAV - reserve_buffer.
    pub fn calc_available_liquidity(
        nav_cents: u128,
        locked_collateral_cents: u128,
    ) -> u128 {
        let reserve_buffer = (locked_collateral_cents * 5000) / BPS_DIVISOR;
        if nav_cents > reserve_buffer {
            nav_cents - reserve_buffer
        } else {
            0
        }
    }

    /// Utilization in basis points: (locked margin) / NAV, capped at 10_000.
    pub fn calc_utilization_bps(nav_cents: u128, locked_collateral_cents: u128) -> u16 {
        if nav_cents == 0 {
            if locked_collateral_cents > 0 { 10_000 } else { 0 }
        } else {
            let ratio = (locked_collateral_cents * 10_000) / nav_cents;
            ratio.min(10_000) as u16
        }
    }

    /// Conservative single-position cap on margin: margin * MAX_LEVERAGE <= 5% NAV.
    /// Guarantees position notional <= 5% NAV for any leverage <= MAX_LEVERAGE.
    pub fn max_single_position_margin(nav_cents: u128) -> u128 {
        (nav_cents * MAX_SINGLE_POSITION_BPS) / (10_000 * (MAX_LEVERAGE as u128))
    }

    /// Check capacity for opening a new position: utilization + single-position cap.
    /// Off-chain advisory mirror of the vault's authoritative on-chain gates
    /// (contracts/src/pel_liquidity_vault.cairo). Gross/net notional OI remain
    /// monitoring-only for V1 until the OPEN circuit exposes notional publicly.
    pub fn check_open_capacity(
        pool: &PoolState,
        _positions: &[Position],
        new_margin_cents: u128,
        _new_quantity_sats: u128,
        _new_side: Side,
        _oracle_price_cents: u128,
    ) -> Result<(), &'static str> {
        if new_margin_cents > Self::max_single_position_margin(pool.nav_cents) {
            return Err("SINGLE_POSITION_CAP_EXCEEDED");
        }

        let util_after = Self::calc_utilization_bps(
            pool.nav_cents,
            pool.locked_collateral_cents + new_margin_cents,
        );
        if util_after > MAX_UTILIZATION_BPS {
            return Err("UTILIZATION_LIMIT_EXCEEDED");
        }

        Ok(())
    }

    /// Full solvency report for a pool (off-chain mirror of vault snapshots).
    pub fn build_solvency_report(
        pool: &PoolState,
        gross_oi_cents: u128,
        net_oi_cents: i64,
        is_solvent: bool,
    ) -> SolvencyReport {
        SolvencyReport {
            nav_cents: pool.nav_cents,
            total_shares: pool.total_shares,
            share_price_e6: Self::calc_share_price_e6(pool.nav_cents, pool.total_shares),
            available_liquidity_cents: Self::calc_available_liquidity(
                pool.nav_cents,
                pool.locked_collateral_cents,
            ),
            locked_collateral_cents: pool.locked_collateral_cents,
            utilization_bps: Self::calc_utilization_bps(pool.nav_cents, pool.locked_collateral_cents),
            gross_oi_cents,
            net_oi_cents,
            insurance_balance_cents: pool.insurance_reserve_cents,
            treasury_balance_cents: pool.treasury_cents,
            is_solvent,
        }
    }
}