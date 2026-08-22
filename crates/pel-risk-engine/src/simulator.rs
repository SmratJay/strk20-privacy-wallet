use crate::types::*;
use crate::risk_engine::RiskEngine;
use serde::{Serialize, Deserialize};

/// Stress scenario with an integer basis-point shock (100 bps = +1.0%).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressScenarioResult {
    pub scenario_name: String,
    pub btc_price_change_bps: i64,
    pub start_nav_cents: u128,
    pub end_nav_cents: u128,
    pub start_share_price_e6: u128,
    pub end_share_price_e6: u128,
    pub total_trader_pnl_cents: i64,
    pub liquidations_count: usize,
    pub bad_debt_incurred_cents: u128,
    pub insurance_drawn_cents: u128,
    pub end_insurance_cents: u128,
    pub end_treasury_cents: u128,
    pub gross_oi_cents: u128,
    pub net_oi_cents: i64,
    pub utilization_bps: u16,
    pub is_pool_solvent: bool,
}

pub struct StressSimulator;

impl StressSimulator {
    /// Integer fixed-point price shock: price * (10_000 + bps) / 10_000.
    pub fn shocked_price(base_price_cents: u128, shock_bps: i64) -> u128 {
        let adj = 10_000_i64 + shock_bps;
        if adj <= 0 {
            1
        } else {
            ((base_price_cents as i64) * adj / 10_000_i64).max(1) as u128
        }
    }

    /// Compute aggregate notional OI across active positions (monitoring only).
    pub fn compute_oi(positions: &[Position], price_cents: u128) -> (u128, i64) {
        let mut gross: u128 = 0;
        let mut long_oi: u128 = 0;
        let mut short_oi: u128 = 0;
        for p in positions.iter().filter(|p| p.is_active) {
            let notional = (p.quantity_sats * price_cents) / QTY_SCALE;
            gross += notional;
            match p.side {
                Side::Long => long_oi += notional,
                Side::Short => short_oi += notional,
            }
        }
        let net = if long_oi >= short_oi {
            (long_oi - short_oi) as i64
        } else {
            -((short_oi - long_oi) as i64)
        };
        (gross, net)
    }

    /// Run the canonical stress suite. Uses INTEGER fixed-point shocks only.
    /// Trader PnL is 100% counterparty PnL (no 70/20/10 split on PnL); liquidation
    /// remnants are split LP/insurance/treasury with every cent routed.
    pub fn run_comprehensive_stress_test(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> Vec<StressScenarioResult> {
        let price_shocks: Vec<(&str, i64)> = vec![
            ("BTC +1% Normal Tick", 100),
            ("BTC -1% Normal Tick", -100),
            ("BTC +5% Moderate Move", 500),
            ("BTC -5% Moderate Move", -500),
            ("BTC +20% Massive Bull Shock", 2_000),
            ("BTC -20% Massive Bear Shock", -2_000),
            ("BTC +40% Short Squeeze Event", 4_000),
            ("BTC -40% Flash Crash Event", -4_000),
        ];

        let mut results = Vec::new();
        for (name, shock_bps) in price_shocks {
            let shocked = Self::shocked_price(base_btc_price_cents, shock_bps);
            results.push(Self::run_scenario(name, initial_pool, positions, shocked, base_btc_price_cents));
        }

        // Structural scenarios (no single-price shock).
        results.push(Self::run_high_utilization_scenario(initial_pool, positions, base_btc_price_cents));
        results.push(Self::run_many_winners_scenario(initial_pool, positions, base_btc_price_cents, true));
        results.push(Self::run_many_winners_scenario(initial_pool, positions, base_btc_price_cents, false));
        results.push(Self::run_insurance_depletion_scenario(initial_pool, positions, base_btc_price_cents));
        results.push(Self::run_withdrawal_pressure_scenario(initial_pool, positions, base_btc_price_cents));
        results.push(Self::run_one_sided_oi_scenario(initial_pool, positions, base_btc_price_cents, Side::Long));
        results.push(Self::run_one_sided_oi_scenario(initial_pool, positions, base_btc_price_cents, Side::Short));
        results.push(Self::run_liquidation_cascade_scenario(initial_pool, positions, base_btc_price_cents));

        results
    }

    /// Core integer scenario runner.
    fn run_scenario(
        name: &str,
        initial_pool: &PoolState,
        positions: &[Position],
        shocked_price: u128,
        base_price: u128,
    ) -> StressScenarioResult {
        let mut nav = initial_pool.nav_cents;
        let mut insurance = initial_pool.insurance_reserve_cents;
        let mut treasury = initial_pool.treasury_cents;
        let mut total_pnl: i64 = 0;
        let mut liquidations = 0;
        let mut bad_debt: u128 = 0;
        let mut insurance_drawn: u128 = 0;

        for pos in positions.iter().filter(|p| p.is_active) {
            let pnl = RiskEngine::calc_pnl_cents(pos.side, pos.quantity_sats, pos.entry_price_cents, shocked_price);
            total_pnl += pnl;

            let liq = RiskEngine::evaluate_liquidation(pos, shocked_price, MAINTENANCE_MARGIN_BPS);
            if liq.is_liquidatable {
                liquidations += 1;
                // Liquidation revenue split: 70% LP / 20% insurance / 10% treasury.
                nav += liq.lp_gain_cents;
                treasury += liq.treasury_gain_cents;
                insurance += liq.insurance_gain_cents;
                // Bad debt: the counterparty's loss beyond the seized margin. Insurance
                // reimburses the LP up to its real balance; any remainder is recorded as
                // explicit bad debt and reduces LP NAV (LPs are the ultimate backstop).
                if liq.bad_debt_cents > 0 {
                    let drawn = liq.bad_debt_cents.min(insurance);
                    insurance -= drawn;
                    insurance_drawn += drawn;
                    nav += drawn;
                    let remaining = liq.bad_debt_cents - drawn;
                    if remaining > 0 {
                        bad_debt += remaining;
                        nav = if nav >= remaining { nav - remaining } else { 0 };
                    }
                }
            } else if pnl > 0 {
                // Trader profit -> LP pays FULL profit.
                let profit = pnl as u128;
                nav = if nav >= profit { nav - profit } else { 0 };
            } else if pnl < 0 {
                // Trader loss -> LP receives FULL loss (no split).
                nav += (-pnl) as u128;
            }
        }

        let start_share_price = RiskEngine::calc_share_price_e6(initial_pool.nav_cents, initial_pool.total_shares);
        let end_share_price = RiskEngine::calc_share_price_e6(nav, initial_pool.total_shares);
        let (gross_oi, net_oi) = Self::compute_oi(positions, base_price);

        StressScenarioResult {
            scenario_name: name.to_string(),
            btc_price_change_bps: (shocked_price as i64 - base_price as i64) * 10_000 / (base_price as i64),
            start_nav_cents: initial_pool.nav_cents,
            end_nav_cents: nav,
            start_share_price_e6: start_share_price,
            end_share_price_e6: end_share_price,
            total_trader_pnl_cents: total_pnl,
            liquidations_count: liquidations,
            bad_debt_incurred_cents: bad_debt,
            insurance_drawn_cents: insurance_drawn,
            end_insurance_cents: insurance,
            end_treasury_cents: treasury,
            gross_oi_cents: gross_oi,
            net_oi_cents: net_oi,
            utilization_bps: RiskEngine::calc_utilization_bps(nav, initial_pool.locked_collateral_cents),
            is_pool_solvent: nav > 0,
        }
    }

    fn run_high_utilization_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> StressScenarioResult {
        let mut pool = initial_pool.clone();
        pool.locked_collateral_cents = pool.nav_cents * 8500 / 10_000; // 85% utilization
        let mut res = Self::run_scenario("High Utilization (85% locked)", &pool, positions, base_btc_price_cents, base_btc_price_cents);
        res.utilization_bps = RiskEngine::calc_utilization_bps(pool.nav_cents, pool.locked_collateral_cents);
        res
    }

    fn run_many_winners_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
        winners: bool,
    ) -> StressScenarioResult {
        // Every position on the winning side (winners=true: longs win on +5%, but we
        // synthesize all positions to be the winning side for a pure stress basket).
        let synthetic: Vec<Position> = positions
            .iter()
            .filter(|p| p.is_active)
            .map(|p| {
                let side = if winners { Side::Long } else { Side::Short };
                let entry = base_btc_price_cents;
                let qty = p.quantity_sats;
                Position {
                    id: p.id.clone(),
                    market_id: p.market_id.clone(),
                    side,
                    quantity_sats: qty,
                    entry_price_cents: entry,
                    margin_cents: p.margin_cents,
                    funding_accrued_cents: 0,
                    nonce: p.nonce.clone(),
                    commitment: p.commitment.clone(),
                    is_active: true,
                }
            })
            .collect();
        let shocked = if winners {
            Self::shocked_price(base_btc_price_cents, 500)
        } else {
            Self::shocked_price(base_btc_price_cents, -500)
        };
        let name = if winners { "Many Winners (uniform +5%)" } else { "Many Losers (uniform -5%)" };
        Self::run_scenario(name, initial_pool, &synthetic, shocked, base_btc_price_cents)
    }

    fn run_insurance_depletion_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> StressScenarioResult {
        let mut pool = initial_pool.clone();
        pool.insurance_reserve_cents = 0; // exhausted
        Self::run_scenario("Insurance Depletion (-40% with empty reserve)", &pool, positions, Self::shocked_price(base_btc_price_cents, -4_000), base_btc_price_cents)
    }

    fn run_withdrawal_pressure_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> StressScenarioResult {
        // Model A queue pressure: 40% of NAV frozen as pending withdrawals and removed
        // from NAV at request time (burned shares excluded from subsequent PnL).
        let queued = initial_pool.nav_cents * 40 / 100;
        let mut pool = initial_pool.clone();
        pool.nav_cents = if initial_pool.nav_cents >= queued {
            initial_pool.nav_cents - queued
        } else {
            0
        };
        pool.pending_withdrawals_cents = queued;
        let mut res = Self::run_scenario("LP Withdrawal Pressure (40% NAV queued)", &pool, positions, Self::shocked_price(base_btc_price_cents, -500), base_btc_price_cents);
        let available = RiskEngine::calc_available_liquidity(res.end_nav_cents, pool.locked_collateral_cents);
        res.is_pool_solvent = available >= queued;
        res
    }

    fn run_one_sided_oi_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
        side: Side,
    ) -> StressScenarioResult {
        let synthetic: Vec<Position> = positions
            .iter()
            .filter(|p| p.is_active)
            .map(|p| Position {
                side,
                ..p.clone()
            })
            .collect();
        let name = match side {
            Side::Long => "One-Sided OI (All Longs)",
            Side::Short => "One-Sided OI (All Shorts)",
        };
        let shock = match side {
            Side::Long => -2_000, // longs hurt on -20%
            Side::Short => 2_000,
        };
        Self::run_scenario(name, initial_pool, &synthetic, Self::shocked_price(base_btc_price_cents, shock), base_btc_price_cents)
    }

    fn run_liquidation_cascade_scenario(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> StressScenarioResult {
        // -45% shock designed to put all high-leverage positions underwater.
        let shocked = Self::shocked_price(base_btc_price_cents, -4_500);
        Self::run_scenario("Liquidation Cascade (-45%)", initial_pool, positions, shocked, base_btc_price_cents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_pool() -> PoolState {
        PoolState {
            nav_cents: 1_000_000,
            total_shares: 10_000_000_000,
            locked_collateral_cents: 50_000,
            insurance_reserve_cents: 100_000,
            unclaimed_payouts_cents: 0,
            unclaimed_bounties_cents: 0,
            pending_withdrawals_cents: 0,
            treasury_cents: 0,
        }
    }

    fn sample_positions() -> Vec<Position> {
        vec![
            Position {
                id: "p1".into(),
                market_id: "BTC-PERP".into(),
                side: Side::Long,
                quantity_sats: 100_000_000,
                entry_price_cents: 9_642_050,
                margin_cents: 100_000,
                funding_accrued_cents: 0,
                nonce: "0x1".into(),
                commitment: "c1".into(),
                is_active: true,
            },
            Position {
                id: "p2".into(),
                market_id: "BTC-PERP".into(),
                side: Side::Short,
                quantity_sats: 50_000_000,
                entry_price_cents: 9_642_050,
                margin_cents: 50_000,
                funding_accrued_cents: 0,
                nonce: "0x2".into(),
                commitment: "c2".into(),
                is_active: true,
            },
        ]
    }

    #[test]
    fn stress_suite_has_expected_scenarios() {
        let results = StressSimulator::run_comprehensive_stress_test(
            &sample_pool(),
            &sample_positions(),
            9_642_050,
        );
        assert_eq!(results.len(), 16, "expected 16 scenarios");
        for r in results {
            assert!(r.start_nav_cents > 0, "start NAV must be positive for {}", r.scenario_name);
        }
    }

    #[test]
    fn integer_price_shock_is_exact() {
        assert_eq!(StressSimulator::shocked_price(9_642_050, 100), 9_738_470);
        assert_eq!(StressSimulator::shocked_price(9_642_050, -100), 9_545_629);
        assert_eq!(StressSimulator::shocked_price(1_000_000, 2_000), 1_200_000);
    }
}