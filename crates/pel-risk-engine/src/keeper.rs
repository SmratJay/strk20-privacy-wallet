use crate::types::*;
use crate::risk_engine::RiskEngine;
use std::collections::HashSet;

pub struct LiquidationCandidate {
    pub position_id: String,
    pub commitment: String,
    pub equity_cents: i64,
    pub maintenance_margin_cents: u128,
    pub estimated_bounty_cents: u128,
}

pub struct KeeperService {
    executed_nullifiers: HashSet<String>,
}

impl KeeperService {
    pub fn new() -> Self {
        Self {
            executed_nullifiers: HashSet::new(),
        }
    }

    /// Scan all active positions against current mark price and return candidate liquidations
    pub fn scan_liquidation_candidates(
        &self,
        positions: &[Position],
        mark_price_cents: u128,
        maintenance_bps: u128,
    ) -> Vec<LiquidationCandidate> {
        let mut candidates = Vec::new();

        for pos in positions.iter().filter(|p| p.is_active) {
            if self.executed_nullifiers.contains(&pos.commitment) {
                continue;
            }

            let result = RiskEngine::evaluate_liquidation(pos, mark_price_cents, maintenance_bps);
            if result.is_liquidatable {
                candidates.push(LiquidationCandidate {
                    position_id: pos.id.clone(),
                    commitment: pos.commitment.clone(),
                    equity_cents: result.equity_cents,
                    maintenance_margin_cents: result.maintenance_margin_cents,
                    estimated_bounty_cents: result.keeper_bounty_cents,
                });
            }
        }

        candidates
    }

    /// Mark a liquidation as executed to guarantee idempotency
    pub fn mark_executed(&mut self, commitment: &str) {
        self.executed_nullifiers.insert(commitment.to_string());
    }

    pub fn is_executed(&self, commitment: &str) -> bool {
        self.executed_nullifiers.contains(commitment)
    }
}
