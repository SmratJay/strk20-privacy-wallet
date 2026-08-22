use crate::types::*;
use crate::risk_engine::RiskEngine;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressScenarioResult {
    pub scenario_name: String,
    pub btc_price_change_pct: f64,
    pub start_nav_cents: u128,
    pub end_nav_cents: u128,
    pub start_share_price_e6: u128,
    pub end_share_price_e6: u128,
    pub total_trader_pnl_cents: i64,
    pub liquidations_count: usize,
    pub bad_debt_incurred_cents: u128,
    pub insurance_drawn_cents: u128,
    pub end_insurance_cents: u128,
    pub is_pool_solvent: bool,
}

pub struct StressSimulator;

impl StressSimulator {
    /// Execute multi-scenario stress simulation across 14 market conditions
    pub fn run_comprehensive_stress_test(
        initial_pool: &PoolState,
        positions: &[Position],
        base_btc_price_cents: u128,
    ) -> Vec<StressScenarioResult> {
        let scenarios = vec![
            ("BTC +1% Normal Tick", 0.01),
            ("BTC -1% Normal Tick", -0.01),
            ("BTC +5% Moderate Move", 0.05),
            ("BTC -5% Moderate Move", -0.05),
            ("BTC +20% Massive Bull Shock", 0.20),
            ("BTC -20% Massive Bear Shock", -0.20),
            ("BTC -40% Flash Crash Event", -0.40),
            ("BTC +40% Short Squeeze Event", 0.40),
        ];

        let mut results = Vec::new();

        for (name, pct) in scenarios {
            let mult = 1.0 + pct;
            let shocked_price = ((base_btc_price_cents as f64) * mult).round() as u128;

            let mut current_nav = initial_pool.nav_cents;
            let mut total_pnl: i64 = 0;
            let mut liquidations = 0;
            let mut bad_debt: u128 = 0;
            let mut insurance_balance = initial_pool.insurance_reserve_cents;
            let mut insurance_drawn: u128 = 0;

            for pos in positions.iter().filter(|p| p.is_active) {
                let pnl = RiskEngine::calc_pnl_cents(pos.side, pos.quantity_sats, pos.entry_price_cents, shocked_price);
                total_pnl += pnl;

                let liq = RiskEngine::evaluate_liquidation(pos, shocked_price, MAINTENANCE_MARGIN_BPS);
                if liq.is_liquidatable {
                    liquidations += 1;
                    if liq.bad_debt_cents > 0 {
                        bad_debt += liq.bad_debt_cents;
                        let drawn = liq.bad_debt_cents.min(insurance_balance);
                        insurance_balance -= drawn;
                        insurance_drawn += drawn;
                    }
                    current_nav += liq.lp_gain_cents;
                } else if pnl > 0 {
                    let profit = pnl as u128;
                    if current_nav >= profit {
                        current_nav -= profit;
                    } else {
                        current_nav = 0;
                    }
                } else if pnl < 0 {
                    let loss = (-pnl) as u128;
                    let lp_gain = (loss * LP_FEE_SHARE_BPS) / BPS_DIVISOR;
                    current_nav += lp_gain;
                }
            }

            let start_share_price = RiskEngine::calc_share_price_e6(initial_pool.nav_cents, initial_pool.total_shares);
            let end_share_price = RiskEngine::calc_share_price_e6(current_nav, initial_pool.total_shares);

            results.push(StressScenarioResult {
                scenario_name: name.to_string(),
                btc_price_change_pct: pct,
                start_nav_cents: initial_pool.nav_cents,
                end_nav_cents: current_nav,
                start_share_price_e6: start_share_price,
                end_share_price_e6: end_share_price,
                total_trader_pnl_cents: total_pnl,
                liquidations_count: liquidations,
                bad_debt_incurred_cents: bad_debt,
                insurance_drawn_cents: insurance_drawn,
                end_insurance_cents: insurance_balance,
                is_pool_solvent: current_nav > 0,
            });
        }

        results
    }
}
