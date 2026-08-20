// Pragma-Authenticated Oracle Adapter V4 for PEL Private Perpetuals (Whitepaper Section 9)
// V4 changes:
//   - Removed set_test_price_TEST_ONLY from production interface
//   - Only BTC-PERP initialized in constructor (removed fake markets)
//   - Added staleness check in get_market_price
//   - Documented single-publisher trust assumption
//
// TRUST MODEL: This oracle accepts prices from a single authorized publisher address.
// It does NOT verify Pragma on-chain proofs or multi-signer attestations.
// This is a known centralization point documented in PERPS_SECURITY_MODEL.md.

use starknet::ContractAddress;
use super::types::OraclePrice;

#[starknet::interface]
pub trait IOracleAdapter<TContractState> {
    fn get_market_price(self: @TContractState, market_id: felt252) -> OraclePrice;
    fn publish_oracle_price(ref self: TContractState, market_id: felt252, price: u128, timestamp: u64);
    fn set_oracle_publisher(ref self: TContractState, publisher: ContractAddress);
    fn get_oracle_publisher(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod OracleAdapter {
    use super::{IOracleAdapter, OraclePrice};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const MAX_PRICE_AGE_SECONDS: u64 = 180; // 3 minute maximum freshness bound

    #[storage]
    struct Storage {
        admin: ContractAddress,
        oracle_publisher: ContractAddress,
        prices: Map<felt252, OraclePrice>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PricePublished: PricePublished,
        OraclePublisherUpdated: OraclePublisherUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PricePublished {
        pub market_id: felt252,
        pub price: u128,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OraclePublisherUpdated {
        pub publisher: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, oracle_publisher: ContractAddress) {
        self.admin.write(admin);
        self.oracle_publisher.write(oracle_publisher);

        // V4: Only initialize BTC-PERP — the only protocol-supported market
        let now = get_block_timestamp();
        self.prices.write('BTC-PERP', OraclePrice { price: 9642050, timestamp: now, is_valid: true });
    }

    #[abi(embed_v0)]
    impl OracleAdapterImpl of IOracleAdapter<ContractState> {
        fn get_market_price(self: @ContractState, market_id: felt252) -> OraclePrice {
            let record = self.prices.read(market_id);
            let now = get_block_timestamp();

            // Zero price is invalid (market not initialized)
            if record.price == 0 {
                return OraclePrice { price: 0, timestamp: 0, is_valid: false };
            }

            // Reject timestamps ahead of current block timestamp
            if record.timestamp > now {
                return OraclePrice { price: record.price, timestamp: record.timestamp, is_valid: false };
            }

            // V4: Verify freshness within MAX_PRICE_AGE_SECONDS bound
            // If no price published recently, return is_valid: false
            let is_fresh = (now - record.timestamp) <= MAX_PRICE_AGE_SECONDS;

            OraclePrice {
                price: record.price,
                timestamp: record.timestamp,
                is_valid: record.is_valid && is_fresh,
            }
        }

        fn publish_oracle_price(ref self: ContractState, market_id: felt252, price: u128, timestamp: u64) {
            let caller = get_caller_address();
            let authorized = self.oracle_publisher.read();
            let admin = self.admin.read();
            assert(caller == authorized || caller == admin, 'UNAUTHORIZED_ORACLE_PUBLISHER');
            assert(price > 0, 'INVALID_ZERO_PRICE');

            let now = get_block_timestamp();
            assert(timestamp <= now, 'FUTURE_PRICE_TIMESTAMP');
            assert(now - timestamp <= MAX_PRICE_AGE_SECONDS, 'ORACLE_UPDATE_STALE');

            self.prices.write(market_id, OraclePrice { price, timestamp, is_valid: true });
            self.emit(PricePublished { market_id, price, timestamp });
        }

        fn set_oracle_publisher(ref self: ContractState, publisher: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.oracle_publisher.write(publisher);
            self.emit(OraclePublisherUpdated { publisher });
        }

        fn get_oracle_publisher(self: @ContractState) -> ContractAddress {
            self.oracle_publisher.read()
        }
    }
}
