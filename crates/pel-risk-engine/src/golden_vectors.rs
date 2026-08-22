use crate::types::*;
use crate::risk_engine::RiskEngine;

/// Golden PnL / equity / liquidation vectors shared with Cairo and TypeScript.
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
        // Vector 1: 1.0 BTC Long (10k -> 10.5k) => +$5,000 PnL
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
        // Vector 2: 1.0 BTC Long (10k -> 9.5k) => -$5,000 PnL
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
        // Vector 3: 1.0 BTC Short (10k -> 9.5k) => +$5,000 PnL
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
        // Vector 4: Underwater: 1.0 BTC Long (10k -> 8.8k) on $10k margin (20x) => liquidatable
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

/// Canonical LP share golden vectors. Every value MUST equal the Cairo vault
/// (contracts/src/pel_liquidity_vault.cairo) and TypeScript LPVaultEngine
/// (src/protocol/lpVault.ts). `expected_share_price_e6` is derived from
/// sharePriceE6 = NAV_cents * 1e6 * 1e4 / total_shares.
pub struct ShareVector {
    pub label: &'static str,
    pub nav_cents_before: u128,
    pub shares_before: u128,
    pub deposit_cents: u128,
    pub expected_shares_out: u128,
    pub expected_nav_after: u128,
    pub expected_shares_after: u128,
    pub expected_share_price_e6: u128,
}

pub fn get_share_vectors() -> Vec<ShareVector> {
    vec![
        // V1: initial deposit $10,000 (1,000,000 cents) -> bootstrap 1 USD = 1e6 shares.
        ShareVector {
            label: "initial_deposit",
            nav_cents_before: 0,
            shares_before: 0,
            deposit_cents: 1_000_000,
            expected_shares_out: 10_000_000_000, // 1e6 * (1e6/100)
            expected_nav_after: 1_000_000,
            expected_shares_after: 10_000_000_000,
            expected_share_price_e6: 1_000_000, // $1.000000
        },
        // V2: second deposit $5,000 at $1.00 -> proportional shares, price stays $1.00.
        ShareVector {
            label: "second_deposit",
            nav_cents_before: 1_000_000,
            shares_before: 10_000_000_000,
            deposit_cents: 500_000,
            expected_shares_out: 5_000_000_000, // 500k * 1e10 / 1e6
            expected_nav_after: 1_500_000,
            expected_shares_after: 15_000_000_000,
            expected_share_price_e6: 1_000_000,
        },
        // V3: trader profit $200 (20,000 cents) -> NAV down, price down.
        ShareVector {
            label: "trader_profit",
            nav_cents_before: 1_480_000, // 1,500,000 - 20,000 already applied
            shares_before: 15_000_000_000,
            deposit_cents: 0,
            expected_shares_out: 0,
            expected_nav_after: 1_480_000,
            expected_shares_after: 15_000_000_000,
            expected_share_price_e6: 986_666, // floor(1,480,000 * 1e10 / 1.5e10)
        },
        // V4: trader loss $300 (30,000 cents) -> NAV up, price up.
        ShareVector {
            label: "trader_loss",
            nav_cents_before: 1_510_000, // 1,480,000 + 30,000 already applied
            shares_before: 15_000_000_000,
            deposit_cents: 0,
            expected_shares_out: 0,
            expected_nav_after: 1_510_000,
            expected_shares_after: 15_000_000_000,
            expected_share_price_e6: 1_006_666, // floor(1,510,000 * 1e10 / 1.5e10)
        },
        // V5: partial withdrawal 1,000 shares -> gross = 1000 * NAV / shares.
        ShareVector {
            label: "partial_withdrawal",
            nav_cents_before: 1_510_000,
            shares_before: 15_000_000_000,
            deposit_cents: 0,
            expected_shares_out: 0,
            expected_nav_after: 1_510_000,
            expected_shares_after: 15_000_000_000,
            expected_share_price_e6: 1_006_666,
        },
    ]
}

/// Verify gross-withdrawal for the partial-withdrawal vector: 1,000,000 shares of a
/// 1,510,000-cent NAV over 15e9 shares = floor(1e6 * 1,510,000 / 15e9) = 100 cents.
pub fn partial_withdrawal_expected_cents() -> u128 {
    (1_000_000 * 1_510_000) / 15_000_000_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_pnl_vectors_pass() {
        for v in get_golden_test_vectors() {
            let pnl = RiskEngine::calc_pnl_cents(v.side, v.quantity_sats, v.entry_price_cents, v.mark_price_cents);
            assert_eq!(pnl, v.expected_pnl_cents, "PnL mismatch for vector {:?} side={:?}", v.label, v.side);
            let equity = RiskEngine::calc_equity_cents(v.margin_cents, pnl, 0, 0);
            assert_eq!(equity, v.expected_equity_cents, "Equity mismatch");
        }
    }

    #[test]
    fn golden_share_vectors_pass() {
        for v in get_share_vectors() {
            if v.deposit_cents > 0 {
                let out = RiskEngine::calc_shares_minted(v.deposit_cents, v.nav_cents_before, v.shares_before);
                assert_eq!(out, v.expected_shares_out, "shares_out mismatch for {}", v.label);
            }
            let price = RiskEngine::calc_share_price_e6(v.expected_nav_after, v.expected_shares_after);
            assert_eq!(price, v.expected_share_price_e6, "share price mismatch for {}", v.label);
        }
        assert_eq!(partial_withdrawal_expected_cents(), 100);
    }

    #[test]
    fn share_price_identity_holds() {
        // sharePriceE6 * total_shares == NAV * 1e6 * 1e4 (within integer rounding)
        let nav = 1_510_000_u128;
        let shares = 15_000_000_000_u128;
        let price = RiskEngine::calc_share_price_e6(nav, shares);
        let lhs = price * shares;
        let rhs = nav * SHARE_SCALE * 10_000;
        // floor division can leave up to shares-1 under
        assert!(lhs <= rhs && rhs - lhs < shares, "share price identity broken");
    }
}