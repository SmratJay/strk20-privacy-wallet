// Pragma-Authenticated Oracle Adapter V4.1 for PEL Private Perpetuals (Whitepaper Section 9)
// Implements strict monotonic round sequencing, timestamp freshness, and circuit-breaker deviation bounds.

use starknet::ContractAddress;
use super::types::OraclePrice;

#[starknet::interface]
pub trait IOracleAdapter<TContractState> {
    fn get_market_price(self: @TContractState, market_id: felt252) -> OraclePrice;
    fn publish_oracle_price(ref self: TContractState, market_id: felt252, price: u128, timestamp: u64);
    fn publish_price_with_round(ref self: TContractState, market_id: felt252, price: u128, timestamp: u64, round_id: u64);
    fn get_last_round_id(self: @TContractState, market_id: felt252) -> u64;
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
    const MAX_DEVIATION_BPS: u128 = 2000;  // 20% max jump per round without admin override

    #[storage]
    struct Storage {
        admin: ContractAddress,
        oracle_publisher: ContractAddress,
        prices: Map<felt252, OraclePrice>,
        last_rounds: Map<felt252, u64>,
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
        pub round_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OraclePublisherUpdated {
        pub publisher: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, oracle_publisher: ContractAddress) {
        self.admin.write(admin);
        self.oracle_publisher.write(oracle_publisher);

        let now = get_block_timestamp();
        self.prices.write('BTC-PERP', OraclePrice { price: 9642050, timestamp: now, is_valid: true });
        self.last_rounds.write('BTC-PERP', 1);
    }

    #[abi(embed_v0)]
    impl OracleAdapterImpl of IOracleAdapter<ContractState> {
        fn get_market_price(self: @ContractState, market_id: felt252) -> OraclePrice {
            assert(market_id == 'BTC-PERP', 'UNSUPPORTED_MARKET');
            let record = self.prices.read(market_id);
            let now = get_block_timestamp();

            if record.price == 0 {
                return OraclePrice { price: 0, timestamp: 0, is_valid: false };
            }

            if record.timestamp > now {
                return OraclePrice { price: record.price, timestamp: record.timestamp, is_valid: false };
            }

            let is_fresh = (now - record.timestamp) <= MAX_PRICE_AGE_SECONDS;

            OraclePrice {
                price: record.price,
                timestamp: record.timestamp,
                is_valid: record.is_valid && is_fresh,
            }
        }

        fn publish_oracle_price(ref self: ContractState, market_id: felt252, price: u128, timestamp: u64) {
            let current_round = self.last_rounds.read(market_id);
            let next_round = current_round + 1;
            self.publish_price_with_round(market_id, price, timestamp, next_round);
        }

        fn publish_price_with_round(
            ref self: ContractState,
            market_id: felt252,
            price: u128,
            timestamp: u64,
            round_id: u64
        ) {
            let caller = get_caller_address();
            let authorized = self.oracle_publisher.read();
            let admin = self.admin.read();
            let is_admin = caller == admin;
            assert(caller == authorized || is_admin, 'UNAUTHORIZED_ORACLE_PUBLISHER');
            assert(market_id == 'BTC-PERP', 'UNSUPPORTED_MARKET');
            assert(price > 0, 'INVALID_ZERO_PRICE');

            let now = get_block_timestamp();
            assert(timestamp <= now, 'FUTURE_PRICE_TIMESTAMP');
            assert(now - timestamp <= MAX_PRICE_AGE_SECONDS, 'ORACLE_UPDATE_STALE');

            let current_round = self.last_rounds.read(market_id);
            if current_round > 0 {
                assert(round_id > current_round, 'NON_MONOTONIC_ROUND_ID');
            }

            // Circuit breaker: check price deviation against last price unless admin overrides
            let old_price = self.prices.read(market_id).price;
            if old_price > 0 && !is_admin {
                let diff = if price > old_price { price - old_price } else { old_price - price };
                let deviation_bps = (diff * 10000_u128) / old_price;
                assert(deviation_bps <= MAX_DEVIATION_BPS, 'EXCESSIVE_PRICE_DEVIATION');
            }

            self.prices.write(market_id, OraclePrice { price, timestamp, is_valid: true });
            self.last_rounds.write(market_id, round_id);
            self.emit(PricePublished { market_id, price, timestamp, round_id });
        }

        fn get_last_round_id(self: @ContractState, market_id: felt252) -> u64 {
            self.last_rounds.read(market_id)
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
