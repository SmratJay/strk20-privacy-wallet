// PEL Private Perpetuals Core State Machine (Whitepaper Sections 6, 12, 13, 14)
use starknet::ContractAddress;
use super::types::{MarketConfig, PositionRecord, ProofFact};

#[starknet::interface]
pub trait IPELPerpsCore<TContractState> {
    fn open_position(
        ref self: TContractState,
        market_id: felt252,
        commitment: felt252,
        margin_nullifier: felt252,
        margin_amount: u128,
        fact_hash: felt252,
    );

    fn update_position(
        ref self: TContractState,
        market_id: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        fact_hash: felt252,
    );

    fn liquidate_position(
        ref self: TContractState,
        market_id: felt252,
        position_nullifier: felt252,
        liquidation_fact_hash: felt252,
        keeper_recipient: ContractAddress,
    );

    fn close_position(
        ref self: TContractState,
        market_id: felt252,
        final_nullifier: felt252,
        payout_note_commitment: felt252,
        payout_amount: u128,
        fact_hash: felt252,
    );

    fn is_nullifier_spent(self: @TContractState, nullifier: felt252) -> bool;
    fn get_position(self: @TContractState, commitment: felt252) -> PositionRecord;
}

#[starknet::contract]
pub mod PELPerpsCore {
    use super::{IPELPerpsCore, MarketConfig, PositionRecord};
    use super::super::oracle_adapter::{IOracleAdapterDispatcher, IOracleAdapterDispatcherTrait};
    use super::super::strk20_adapter::{ISTRK20AdapterDispatcher, ISTRK20AdapterDispatcherTrait};
    use super::super::stwo_verifier::{IStwoVerifierDispatcher, IStwoVerifierDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        oracle_adapter: ContractAddress,
        strk20_adapter: ContractAddress,
        stwo_verifier: ContractAddress,
        
        // Nullifier Replay Registry (Whitepaper Section 21)
        used_nullifiers: Map<felt252, bool>,

        // Active Position State Records
        positions: Map<felt252, PositionRecord>,

        // Markets Configuration
        markets: Map<felt252, MarketConfig>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PositionOpened: PositionOpened,
        PositionUpdated: PositionUpdated,
        PositionLiquidated: PositionLiquidated,
        PositionClosed: PositionClosed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionOpened {
        pub commitment: felt252,
        pub market_id: felt252,
        pub margin_amount: u128,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionUpdated {
        pub old_nullifier: felt252,
        pub new_commitment: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionLiquidated {
        pub nullifier: felt252,
        pub keeper: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionClosed {
        pub nullifier: felt252,
        pub payout_amount: u128,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        oracle_adapter: ContractAddress,
        strk20_adapter: ContractAddress,
        stwo_verifier: ContractAddress,
    ) {
        self.admin.write(admin);
        self.oracle_adapter.write(oracle_adapter);
        self.strk20_adapter.write(strk20_adapter);
        self.stwo_verifier.write(stwo_verifier);

        // Initialize default markets
        self.markets.write('BTC-PERP', MarketConfig { market_id: 'BTC-PERP', base_asset_id: 'BTC', max_leverage: 50, maintenance_margin_bps: 200, is_active: true });
        self.markets.write('ETH-PERP', MarketConfig { market_id: 'ETH-PERP', base_asset_id: 'ETH', max_leverage: 50, maintenance_margin_bps: 250, is_active: true });
        self.markets.write('STRK-PERP', MarketConfig { market_id: 'STRK-PERP', base_asset_id: 'STRK', max_leverage: 25, maintenance_margin_bps: 400, is_active: true });
    }

    #[abi(embed_v0)]
    impl PELPerpsCoreImpl of IPELPerpsCore<ContractState> {
        fn open_position(
            ref self: ContractState,
            market_id: felt252,
            commitment: felt252,
            margin_nullifier: felt252,
            margin_amount: u128,
            fact_hash: felt252,
        ) {
            let market = self.markets.read(market_id);
            assert(market.is_active, 'MARKET_NOT_ACTIVE');
            assert(!self.used_nullifiers.read(margin_nullifier), 'NULLIFIER_ALREADY_SPENT');

            // 1. Verify Oracle Price Freshness
            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_STALE_OR_INVALID');

            // 2. Verify STARK Proof of Opening Invariants (Leverage <= L_max)
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid_proof = verifier.verify_transition_proof('OPEN', commitment, fact_hash);
            assert(is_valid_proof, 'INVALID_STARK_OPEN_PROOF');

            // 3. Lock Shielded Margin in STRK20 Vault
            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.lock_shielded_margin(margin_nullifier, margin_amount);

            // 4. Mark Margin Nullifier as Consumed
            self.used_nullifiers.write(margin_nullifier, true);

            // 5. Store Active Position Record
            let now = get_block_timestamp();
            self.positions.write(commitment, PositionRecord {
                commitment,
                market_id,
                created_at: now,
                updated_at: now,
                is_active: true,
            });

            self.emit(PositionOpened { commitment, market_id, margin_amount, timestamp: now });
        }

        fn update_position(
            ref self: ContractState,
            market_id: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            fact_hash: felt252,
        ) {
            assert(!self.used_nullifiers.read(old_nullifier), 'OLD_NULLIFIER_ALREADY_SPENT');

            // 1. Verify STARK Transition Proof (Linear PnL, Solvency Invariant)
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_transition_proof('UPDATE', new_commitment, fact_hash);
            assert(is_valid, 'INVALID_STARK_UPDATE_PROOF');

            // 2. Nullify Old State
            self.used_nullifiers.write(old_nullifier, true);

            // 3. Store New Commitment Record
            let now = get_block_timestamp();
            self.positions.write(new_commitment, PositionRecord {
                commitment: new_commitment,
                market_id,
                created_at: now,
                updated_at: now,
                is_active: true,
            });

            self.emit(PositionUpdated { old_nullifier, new_commitment, timestamp: now });
        }

        fn liquidate_position(
            ref self: ContractState,
            market_id: felt252,
            position_nullifier: felt252,
            liquidation_fact_hash: felt252,
            keeper_recipient: ContractAddress,
        ) {
            assert(!self.used_nullifiers.read(position_nullifier), 'POSITION_ALREADY_NULLIFIED');

            // 1. Verify Zero-Knowledge Liquidation Proof (Et <= Mmaint)
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_transition_proof('LIQUIDATE', position_nullifier, liquidation_fact_hash);
            assert(is_valid, 'INVALID_LIQUIDATION_PROOF');

            // 2. Consume Position Nullifier
            self.used_nullifiers.write(position_nullifier, true);

            let now = get_block_timestamp();
            self.emit(PositionLiquidated { nullifier: position_nullifier, keeper: keeper_recipient, timestamp: now });
        }

        fn close_position(
            ref self: ContractState,
            market_id: felt252,
            final_nullifier: felt252,
            payout_note_commitment: felt252,
            payout_amount: u128,
            fact_hash: felt252,
        ) {
            assert(!self.used_nullifiers.read(final_nullifier), 'FINAL_NULLIFIER_ALREADY_SPENT');

            // 1. Verify STARK Closing & Equity Settlement Proof
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_transition_proof('CLOSE', payout_note_commitment, fact_hash);
            assert(is_valid, 'INVALID_STARK_CLOSE_PROOF');

            // 2. Consume Nullifier
            self.used_nullifiers.write(final_nullifier, true);

            // 3. Release Payout Note in STRK20 Vault
            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.release_shielded_payout(payout_note_commitment, payout_amount);

            let now = get_block_timestamp();
            self.emit(PositionClosed { nullifier: final_nullifier, payout_amount, timestamp: now });
        }

        fn is_nullifier_spent(self: @ContractState, nullifier: felt252) -> bool {
            self.used_nullifiers.read(nullifier)
        }

        fn get_position(self: @ContractState, commitment: felt252) -> PositionRecord {
            self.positions.read(commitment)
        }
    }
}
