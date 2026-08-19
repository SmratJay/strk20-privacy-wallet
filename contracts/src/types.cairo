// PEL Private Perpetuals Types (Whitepaper Sections 5, 7, 11)
use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct MarketConfig {
    pub market_id: felt252,          // e.g. 'BTC-PERP', 'ETH-PERP', 'STRK-PERP'
    pub base_asset_id: felt252,      // 'BTC', 'ETH', 'STRK'
    pub max_leverage: u16,           // e.g. 50 (50x), 25 (25x)
    pub maintenance_margin_bps: u16, // e.g. 200 = 2.0%
    pub is_active: bool,
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct OraclePrice {
    pub price: u128,                 // Price in USD cents (2 decimals, e.g. 9642050 = $96,420.50)
    pub timestamp: u64,              // Block timestamp of publication
    pub is_valid: bool,
}

#[derive(Drop, Copy, Serde)]
pub struct ProofFact {
    pub fact_hash: felt252,          // Hash of the verified STARK proof
    pub proof_type: felt252,         // 'OPEN', 'UPDATE', 'LIQUIDATE', 'CLOSE'
    pub public_inputs_hash: felt252, // H(P_t, funding, risk_params, C_old, C_new, NF)
}

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct PositionRecord {
    pub commitment: felt252,         // Current active state commitment C_t
    pub market_id: felt252,
    pub created_at: u64,
    pub updated_at: u64,
    pub is_active: bool,
}
