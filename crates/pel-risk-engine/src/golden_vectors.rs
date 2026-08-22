use crate::types::*;
use crate::risk_engine::RiskEngine;

pub struct GoldenVector {
    pub side: Side,
    pub quantity_sats: u128,
    pub entry_price_cents: u128,
    pub mark_price_cents: u128,
    pub expected_pnl_cents: i64,
    pub margin_cents: u128,
    pub expected_equity_cents: i64,
    pub is_liquidatable: bool,
}

pub fn get_golden_test_vectors() -> Vec<GoldenVector> {
    vec![
        // Vector 1: 1.0 BTC Long (k -> k) => +,000 PnL
        GoldenVector {
            side: Side::Long,
            quantity_sats: 100_000_000,
            entry_price_cents: 10_000_000,
            mark_price_cents: 10_500_000,
            expected_pnl_cents: 500_000,
            margin_cents: 1_000_000,
            expected_equity_cents: 1_500_000,
            is_liquidatable: false,
        },
        // Vector 2: 1.0 BTC Long (k -> k) => -,000 PnL
        GoldenVector {
            side: Side::Long,
            quantity_sats: 100_000_000,
            entry_price_cents: 10_000_000,
            mark_price_cents: 9_500_000,
            expected_pnl_cents: -500_000,
            margin_cents: 1_000_000,
            expected_equity_cents: 500_000,
            is_liquidatable: false,
        },
        // Vector 3: 1.0 BTC Short (k -> k) => +,000 PnL
        GoldenVector {
            side: Side::Short,
            quantity_sats: 100_000_000,
            entry_price_cents: 10_000_000,
            mark_price_cents: 9_500_000,
            expected_pnl_cents: 500_000,
            margin_cents: 1_000_000,
            expected_equity_cents: 1_500_000,
            is_liquidatable: false,
        },
        // Vector 4: Underwater Position: 1.0 BTC Long (k -> k) on k Margin (20x) => -,000 PnL (Liquidatable)
        GoldenVector {
            side: Side::Long,
            quantity_sats: 100_000_000,
            entry_price_cents: 10_000_000,
            mark_price_cents: 8_800_000,
            expected_pnl_cents: -1_200_000,
            margin_cents: 1_000_000,
            expected_equity_cents: -200_000,
            is_liquidatable: true,
        },
    ]
}
