// Pragma Oracle Adapter for PEL Private Perpetuals (Whitepaper Section 9)
use starknet::ContractAddress;
use super::types::OraclePrice;

#[starknet::interface]
pub trait IOracleAdapter<TContractState> {
    fn get_market_price(self: @TContractState, market_id: felt252) -> OraclePrice;
    fn set_oracle_address(ref self: TContractState, new_oracle: ContractAddress);
    fn update_manual_price(ref self: TContractState, market_id: felt252, price: u128);
}

#[starknet::contract]
pub mod OracleAdapter {
    use super::{IOracleAdapter, OraclePrice};
    use starknet::{ContractAddress, get_block_timestamp};

    const MAX_PRICE_AGE_SECONDS: u64 = 180; // 3 minute maximum freshness bound

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pragma_oracle_address: ContractAddress,
        manual_prices: LegacyMap<felt252, OraclePrice>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PriceUpdated: PriceUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PriceUpdated {
        pub market_id: felt252,
        pub price: u128,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, pragma_oracle: ContractAddress) {
        self.admin.write(admin);
        self.pragma_oracle_address.write(pragma_oracle);

        // Initialize default baseline prices ($ cents)
        let now = get_block_timestamp();
        self.manual_prices.write('BTC-PERP', OraclePrice { price: 9642050, timestamp: now, is_valid: true });
        self.manual_prices.write('ETH-PERP', OraclePrice { price: 341875, timestamp: now, is_valid: true });
        self.manual_prices.write('STRK-PERP', OraclePrice { price: 58, timestamp: now, is_valid: true });
    }

    #[abi(embed_v0)]
    impl OracleAdapterImpl of IOracleAdapter<ContractState> {
        fn get_market_price(self: @ContractState, market_id: felt252) -> OraclePrice {
            let record = self.manual_prices.read(market_id);
            let now = get_block_timestamp();
            
            // Check freshness bound (§9.1)
            let is_fresh = if now >= record.timestamp {
                (now - record.timestamp) <= MAX_PRICE_AGE_SECONDS
            } else {
                true
            };

            OraclePrice {
                price: record.price,
                timestamp: record.timestamp,
                is_valid: record.is_valid && is_fresh,
            }
        }

        fn set_oracle_address(ref self: ContractState, new_oracle: ContractAddress) {
            let caller = starknet::get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.pragma_oracle_address.write(new_oracle);
        }

        fn update_manual_price(ref self: ContractState, market_id: felt252, price: u128) {
            let caller = starknet::get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let now = get_block_timestamp();
            self.manual_prices.write(market_id, OraclePrice { price, timestamp: now, is_valid: true });
            self.emit(PriceUpdated { market_id, price, timestamp: now });
        }
    }
}
