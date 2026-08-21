// PEL Private Perpetuals Types — V3 (Whitepaper Sections 5, 7, 11)
// CONFIG VERSION: 3 — must match canonical protocol constants

pub type Bn254Commitment = u256;
pub type Bn254Nullifier = u256;
pub type CommitmentStorageKey = felt252;
pub type NullifierStorageKey = felt252;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct MarketConfig {
    pub market_id: felt252,              // e.g. 'BTC-PERP'
    pub base_asset_id: felt252,          // 'BTC'
    pub max_leverage: u16,               // 50
    pub initial_margin_bps: u16,         // 200 = 2.0%
    pub maintenance_margin_bps: u16,     // 200 = 2.0%
    pub taker_fee_bps: u16,              // 7 = 0.07%
    pub maker_fee_bps: u16,              // 2 = 0.02%
    pub funding_rate_bps_hr: i64,        // 120 = 0.0012%/hr (signed: + = longs pay)
    pub funding_interval_secs: u64,      // 3600 = 1 hour
    pub max_oracle_age_secs: u64,        // 180 = 3 minutes
    pub max_exec_deviation_bps: u16,     // 100 = 1.0%
    pub config_version: u32,             // 3 — checked on every transition
    pub is_active: bool,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct OraclePrice {
    pub price: u128,                     // Price in USD cents (e.g. 9642050 = $96,420.50)
    pub timestamp: u64,                  // Block timestamp of publication
    pub is_valid: bool,
}

#[derive(Drop, Copy, Serde)]
pub struct ProofFact {
    pub fact_hash: felt252,              // Hash of the Poseidon SNIP-36 fact
    pub proof_type: felt252,             // 'OPEN', 'UPDATE', 'FUND', 'LIQUIDATE', 'CLOSE'
    pub public_inputs_hash: felt252,     // H(proof_type, market_id, commitment, nullifier, amount, price)
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PositionRecord {
    pub commitment: felt252,             // Active state commitment storage key
    pub margin_nullifier: felt252,       // Nullifier storage key of current state
    pub locked_margin: u128,             // Locked margin amount in USD cents
    pub market_id: felt252,              // Market ID — verified on all transitions
    pub created_at: u64,
    pub updated_at: u64,
    pub last_funding_timestamp: u64,     // Canonical on-chain funding anchor timestamp
    pub is_active: bool,
}

pub fn u256_to_storage_key(x: u256) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![x.low.into(), x.high.into()].span()
    )
}
