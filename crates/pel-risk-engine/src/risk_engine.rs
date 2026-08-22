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

    /// Calculate trader equity: E = m + PnL - f - fees
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

            let lp_gain = (net_seized * LP_FEE_SHARE_BPS) / BPS_DIVISOR;
            let insurance_gain = (net_seized * INSURANCE_FEE_SHARE_BPS) / BPS_DIVISOR;

            let bad_debt = if equity < 0 { (-equity) as u128 } else { 0 };

            LiquidationResult {
                is_liquidatable: true,
                equity_cents: equity,
                maintenance_margin_cents: maint,
                seized_collateral_cents: seized,
                keeper_bounty_cents: keeper_bounty,
                lp_gain_cents: lp_gain,
                insurance_gain_cents: insurance_gain,
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
                bad_debt_cents: 0,
            }
        }
    }

    /// Calculate pool share price in 1e6 scale: SharePrice = (NAV * 1e6) / totalShares
    pub fn calc_share_price_e6(nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 {
            SHARE_SCALE
        } else {
            (nav_cents * SHARE_SCALE) / total_shares
        }
    }

    /// Calculate shares minted for deposit: shares = (amount * totalShares) / NAV
    pub fn calc_shares_minted(amount_cents: u128, nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 || nav_cents == 0 {
            amount_cents * (SHARE_SCALE / 100)
        } else {
            (amount_cents * total_shares) / nav_cents
        }
    }

    /// Calculate gross withdrawal payout: payout = (shares * NAV) / totalShares
    pub fn calc_gross_withdrawal(shares: u128, nav_cents: u128, total_shares: u128) -> u128 {
        if total_shares == 0 {
            0
        } else {
            (shares * nav_cents) / total_shares
        }
    }

    /// Calculate available withdrawable liquidity ensuring 50% locked margin reserve
    pub fn calc_available_liquidity(
        nav_cents: u128,
        locked_collateral_cents: u128,
        unclaimed_payouts_cents: u128,
        unclaimed_bounties_cents: u128,
        pending_withdrawals_cents: u128,
    ) -> u128 {
        let reserve_buffer = (locked_collateral_cents * 5000) / BPS_DIVISOR;
        let total_senior = reserve_buffer + unclaimed_payouts_cents + unclaimed_bounties_cents + pending_withdrawals_cents;
        if nav_cents > total_senior {
            nav_cents - total_senior
        } else {
            0
        }
    }

    /// Check capacity for opening a new position: Gross OI, Net OI, Utilization
    pub fn check_open_capacity(
        pool: &PoolState,
        positions: &[Position],
        new_quantity_sats: u128,
        new_side: Side,
        oracle_price_cents: u128,
    ) -> Result<(), &'static str> {
        let mut gross_oi: u128 = 0;
        let mut long_oi: u128 = 0;
        let mut short_oi: u128 = 0;

        for p in positions.iter().filter(|p| p.is_active) {
            let notional = (p.quantity_sats * oracle_price_cents) / QTY_SCALE;
            gross_oi += notional;
            match p.side {
                Side::Long => long_oi += notional,
                Side::Short => short_oi += notional,
            }
        }

        let new_notional = (new_quantity_sats * oracle_price_cents) / QTY_SCALE;
        gross_oi += new_notional;
        match new_side {
            Side::Long => long_oi += new_notional,
            Side::Short => short_oi += new_notional,
        }

        let net_oi = if long_oi >= short_oi {
            (long_oi - short_oi) as i64
        } else {
            -((short_oi - long_oi) as i64)
        };

        let max_gross_oi = (pool.nav_cents * MAX_GROSS_OI_RATIO_E2) / 100;
        if gross_oi > max_gross_oi {
            return Err("MARKET_GROSS_OI_EXCEEDED");
        }

        let max_net_oi = (pool.nav_cents * MAX_NET_OI_RATIO_E2) / 100;
        if (net_oi.abs() as u128) > max_net_oi {
            return Err("MARKET_NET_OI_EXCEEDED");
        }

        Ok(())
    }
}
