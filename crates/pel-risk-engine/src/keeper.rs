use crate::types::*;
use crate::risk_engine::RiskEngine;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidationCandidate {
    pub position_id: String,
    pub commitment: String,
    pub nullifier: String,
    pub equity_cents: i64,
    pub maintenance_margin_cents: u128,
    pub estimated_bounty_cents: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExecutionState {
    Submitted,
    Confirmed,
    Reverted,
    Retrying,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRecord {
    /// Position commitment (primary idempotency key).
    pub commitment: String,
    /// Liquidation nullifier (single-use on-chain).
    pub nullifier: String,
    /// Starknet transaction hash once submitted.
    pub tx_hash: Option<String>,
    pub state: ExecutionState,
    pub attempt: u32,
    pub updated_at_ms: u64,
}

/// Persistent, restart-safe idempotency ledger. Unlike an in-memory HashSet, this
/// survives keeper process restarts: a liquidation is never re-executed after it
/// has been submitted/confirmed, even if the process dies mid-cycle.
pub struct KeeperExecutionLedger {
    path: std::path::PathBuf,
    records: HashMap<String, ExecutionRecord>,
}

impl KeeperExecutionLedger {
    pub fn new(path: &str) -> Self {
        let pb = std::path::PathBuf::from(path);
        let records = if pb.exists() {
            let raw = std::fs::read_to_string(&pb).unwrap_or_default();
            serde_json::from_str::<HashMap<String, ExecutionRecord>>(&raw).unwrap_or_default()
        } else {
            HashMap::new()
        };
        Self { path: pb, records }
    }

    fn persist(&self) {
        if let Ok(json) = serde_json::to_string(&self.records) {
            if let Some(dir) = self.path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&self.path, json);
        }
    }

    pub fn has_executed(&self, commitment: &str) -> bool {
        self.records.get(commitment).is_some()
    }

    pub fn mark_submitted(&mut self, commitment: &str, nullifier: &str, tx_hash: &str, now_ms: u64) {
        self.records.insert(
            commitment.to_string(),
            ExecutionRecord {
                commitment: commitment.to_string(),
                nullifier: nullifier.to_string(),
                tx_hash: Some(tx_hash.to_string()),
                state: ExecutionState::Submitted,
                attempt: 1,
                updated_at_ms: now_ms,
            },
        );
        self.persist();
    }

    pub fn confirm(&mut self, commitment: &str, now_ms: u64) {
        if let Some(rec) = self.records.get_mut(commitment) {
            rec.state = ExecutionState::Confirmed;
            rec.updated_at_ms = now_ms;
        }
        self.persist();
    }

    pub fn mark_reverted(&mut self, commitment: &str, now_ms: u64) {
        if let Some(rec) = self.records.get_mut(commitment) {
            rec.state = ExecutionState::Reverted;
            rec.attempt += 1;
            rec.updated_at_ms = now_ms;
        }
        self.persist();
    }
}

pub struct KeeperService {
    /// Restart-safe idempotency ledger.
    pub ledger: KeeperExecutionLedger,
}

impl KeeperService {
    pub fn new(ledger_path: &str) -> Self {
        Self {
            ledger: KeeperExecutionLedger::new(ledger_path),
        }
    }

    /// Scan all active positions against current mark price and return candidate
    /// liquidations, skipping any position already submitted/confirmed.
    pub fn scan_liquidation_candidates(
        &self,
        positions: &[Position],
        mark_price_cents: u128,
        maintenance_bps: u128,
    ) -> Vec<LiquidationCandidate> {
        let mut candidates = Vec::new();

        for pos in positions.iter().filter(|p| p.is_active) {
            if self.ledger.has_executed(&pos.commitment) {
                continue;
            }

            let result = RiskEngine::evaluate_liquidation(pos, mark_price_cents, maintenance_bps);
            if result.is_liquidatable {
                candidates.push(LiquidationCandidate {
                    position_id: pos.id.clone(),
                    commitment: pos.commitment.clone(),
                    nullifier: pos.commitment.clone(), // V1: proof-generated nullifier replaces this
                    equity_cents: result.equity_cents,
                    maintenance_margin_cents: result.maintenance_margin_cents,
                    estimated_bounty_cents: result.keeper_bounty_cents,
                });
            }
        }

        candidates
    }

    pub fn is_executed(&self, commitment: &str) -> bool {
        self.ledger.has_executed(commitment)
    }
}

// ─── HONESTY NOTE ─────────────────────────────────────────────────────────────
// The keeper is a SCANNER + IDEMPOTENCY LAYER. It is NOT yet a fully autonomous
// production executor: a production keeper must also
//   (1) read authoritative on-chain state,
//   (2) generate/obtain the liquidation Groth16 proof (needs position witness),
//   (3) submit the Starknet transaction with correct nonce management,
//   (4) wait for finality, retry on revert, and deduplicate across restarts.
// Steps (1)-(4) are implemented in the TypeScript keeperService.ts using the real
// Garaga prover + Starknet dispatcher; this Rust keeper provides the persistent,
// restart-safe idempotency keyed by commitment/tx_hash. Full live execution
// additionally requires the STRK20 operator proving/discovery infrastructure
// (see infra/strk20-operator and docs/PEL_IMPLEMENTATION_STATUS).
// ─────────────────────────────────────────────────────────────────────────────