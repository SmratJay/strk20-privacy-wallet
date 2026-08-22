use serde::{Deserialize, Serialize};

pub const QTY_SCALE: u128 = 100_000_000;      // 1e8 sats = 1 BTC
pub const SHARE_SCALE: u128 = 1_000_000;       // 1e6 LP share precision
pub const BPS_DIVISOR: u128 = 10_000;
pub const MAX_LEVERAGE: u16 = 50;
pub const MAINTENANCE_MARGIN_BPS: u128 = 200;  // 2.0%
pub const TAKER_FEE_BPS: u128 = 7;             // 0.07%
pub const MAKER_FEE_BPS: u128 = 2;             // 0.02%
pub const KEEPER_BOUNTY_BPS: u128 = 200;       // 2.0%
pub const KEEPER_BOUNTY_CAP_CENTS: u128 = 50_000; // .00 cap
pub const LP_FEE_SHARE_BPS: u128 = 7_000;      // 70%
pub const INSURANCE_FEE_SHARE_BPS: u128 = 2_000; // 20%
pub const TREASURY_FEE_SHARE_BPS: u128 = 1_000;  // 10%
pub const MAX_GROSS_OI_RATIO_E2: u128 = 200;   // 2.0x NAV
pub const MAX_NET_OI_RATIO_E2: u128 = 50;      // 0.5x NAV
pub const MAX_UTILIZATION_BPS: u16 = 8500;     // 85%

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    Long,
    Short,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub market_id: String,
    pub side: Side,
    pub quantity_sats: u128,
    pub entry_price_cents: u128,
    pub margin_cents: u128,
    pub funding_accrued_cents: i64,
    pub nonce: String,
    pub commitment: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolState {
    pub nav_cents: u128,
    pub total_shares: u128,
    pub locked_collateral_cents: u128,
    pub insurance_reserve_cents: u128,
    pub unclaimed_payouts_cents: u128,
    pub unclaimed_bounties_cents: u128,
    pub pending_withdrawals_cents: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationResult {
    pub is_liquidatable: bool,
    pub equity_cents: i64,
    pub maintenance_margin_cents: u128,
    pub seized_collateral_cents: u128,
    pub keeper_bounty_cents: u128,
    pub lp_gain_cents: u128,
    pub insurance_gain_cents: u128,
    pub bad_debt_cents: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolvencyReport {
    pub nav_cents: u128,
    pub total_shares: u128,
    pub share_price_e6: u128,
    pub available_liquidity_cents: u128,
    pub locked_collateral_cents: u128,
    pub utilization_bps: u16,
    pub gross_oi_cents: u128,
    pub net_oi_cents: i64,
    pub insurance_balance_cents: u128,
    pub is_solvent: bool,
}
