// PEL Private Perpetuals Core State Machine — V4.3 (Typed Transition Fact Verification & Bidirectional Funding)
// Implements Whitepaper Sections 6, 12, 13, 14, 15 & Runbook V4.2
// Protocol Version: 2

use starknet::ContractAddress;
use super::types::{MarketConfig, PositionRecord};

#[starknet::interface]
pub trait IPELPerpsCore<TContractState> {
    fn open_position(
        ref self: TContractState,
        collateral_owner: ContractAddress,
        market_id: felt252,
        commitment: felt252,
        margin_nullifier: felt252,
        margin_amount: u128,
        fact_hash: felt252,
    );

    fn update_position(
        ref self: TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        fact_hash: felt252,
    );

    fn fund_position(
        ref self: TContractState,
        market_id: felt252,
        commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        funding_amount: u128,
        is_long_pays: bool,
        fact_hash: felt252,
    );

    fn liquidate_position(
        ref self: TContractState,
        market_id: felt252,
        position_commitment: felt252,
        position_nullifier: felt252,
        liquidation_fact_hash: felt252,
        keeper_recipient: ContractAddress,
    );

    fn close_position(
        ref self: TContractState,
        market_id: felt252,
        position_commitment: felt252,
        final_nullifier: felt252,
        payout_note_commitment: felt252,
        payout_amount: u128,
        recipient: ContractAddress,
        fact_hash: felt252,
    );

    fn is_nullifier_spent(self: @TContractState, nullifier: felt252) -> bool;
    fn get_position(self: @TContractState, commitment: felt252) -> PositionRecord;
    fn get_market_config(self: @TContractState, market_id: felt252) -> MarketConfig;
    fn set_strk20_adapter(ref self: TContractState, new_adapter: ContractAddress);
    fn set_oracle_adapter(ref self: TContractState, new_oracle: ContractAddress);
    fn set_stwo_verifier(ref self: TContractState, new_verifier: ContractAddress);
    fn pause_market(ref self: TContractState, market_id: felt252);
    fn resume_market(ref self: TContractState, market_id: felt252);
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

        // Nullifier to Commitment mapping
        commitment_by_nullifier: Map<felt252, felt252>,

        // Market Configurations
        markets: Map<felt252, MarketConfig>,

        // Market Pause Flag
        market_paused: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PositionOpened: PositionOpened,
        PositionUpdated: PositionUpdated,
        PositionFunded: PositionFunded,
        PositionLiquidated: PositionLiquidated,
        PositionClosed: PositionClosed,
        MarketPaused: MarketPaused,
        MarketResumed: MarketResumed,
        AdapterUpdated: AdapterUpdated,
        OracleUpdated: OracleUpdated,
        VerifierUpdated: VerifierUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionOpened {
        pub collateral_owner: ContractAddress,
        pub commitment: felt252,
        pub market_id: felt252,
        pub margin_amount: u128,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionUpdated {
        pub old_commitment: felt252,
        pub old_nullifier: felt252,
        pub new_commitment: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionFunded {
        pub commitment: felt252,
        pub old_nullifier: felt252,
        pub new_commitment: felt252,
        pub funding_amount: u128,
        pub is_long_pays: bool,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionLiquidated {
        pub commitment: felt252,
        pub nullifier: felt252,
        pub keeper: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionClosed {
        pub commitment: felt252,
        pub nullifier: felt252,
        pub payout_amount: u128,
        pub recipient: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketPaused {
        pub market_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketResumed {
        pub market_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AdapterUpdated {
        pub new_adapter: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OracleUpdated {
        pub new_oracle: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub new_verifier: ContractAddress,
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

        // Canonical BTC-PERP V2 Configuration
        self.markets.write('BTC-PERP', MarketConfig {
            market_id:              'BTC-PERP',
            base_asset_id:          'BTC',
            max_leverage:           50_u16,
            initial_margin_bps:     200_u16,
            maintenance_margin_bps: 200_u16,
            taker_fee_bps:          7_u16,
            maker_fee_bps:          2_u16,
            funding_rate_bps_hr:    120_i64,
            funding_interval_secs:  3600_u64,
            max_oracle_age_secs:    180_u64,
            max_exec_deviation_bps: 100_u16,
            config_version:         2_u32,
            is_active:              true,
        });
    }

    #[abi(embed_v0)]
    impl PELPerpsCoreImpl of IPELPerpsCore<ContractState> {

        // ─── OPEN (P0-01: Typed Open Fact Verification) ──────────────────────

        fn open_position(
            ref self: ContractState,
            collateral_owner: ContractAddress,
            market_id: felt252,
            commitment: felt252,
            margin_nullifier: felt252,
            margin_amount: u128,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == collateral_owner, 'UNAUTHORIZED_COLLATERAL_OWNER');

            let market = self.markets.read(market_id);
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            assert(market.is_active, 'MARKET_NOT_ACTIVE');
            assert(margin_amount > 0, 'INVALID_MARGIN_AMOUNT');
            assert(!self.used_nullifiers.read(margin_nullifier), 'NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(commitment).is_active, 'COMMITMENT_ALREADY_EXISTS');

            // 1. Verify Oracle Price Freshness
            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_STALE_OR_INVALID');

            // 2. Verify Typed Open Fact strictly bound to collateral_owner
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid_proof = verifier.verify_open_fact(
                market_id,
                commitment,
                margin_nullifier,
                margin_amount,
                price.price,
                collateral_owner,
                fact_hash,
            );
            assert(is_valid_proof, 'INVALID_OPEN_FACT');

            // 3. Checks-Effects: Mark Nullifier Consumed
            self.used_nullifiers.write(margin_nullifier, true);

            // 4. Lock Shielded Margin in STRK20 Vault from the verified collateral owner
            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.lock_shielded_margin(collateral_owner, margin_nullifier, margin_amount);

            // 5. Store Active Position Record
            let now = get_block_timestamp();
            self.positions.write(commitment, PositionRecord {
                commitment,
                margin_nullifier,
                locked_margin: margin_amount,
                market_id,
                created_at: now,
                updated_at: now,
                is_active: true,
            });
            self.commitment_by_nullifier.write(margin_nullifier, commitment);

            self.emit(PositionOpened { collateral_owner, commitment, market_id, margin_amount, timestamp: now });
        }

        // ─── UPDATE (P0-02: Typed Update Fact Verification) ──────────────────

        fn update_position(
            ref self: ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            fact_hash: felt252,
        ) {
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            let mut old_pos = self.positions.read(old_commitment);
            assert(old_pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(old_pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(old_nullifier) == old_commitment, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(old_nullifier), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');

            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_update_fact(
                market_id,
                old_commitment,
                old_nullifier,
                new_commitment,
                old_pos.locked_margin,
                price.price,
                fact_hash,
            );
            assert(is_valid, 'INVALID_UPDATE_FACT');

            let now = get_block_timestamp();
            old_pos.is_active = false;
            old_pos.updated_at = now;
            self.positions.write(old_commitment, old_pos);
            self.used_nullifiers.write(old_nullifier, true);

            self.positions.write(new_commitment, PositionRecord {
                commitment:       new_commitment,
                margin_nullifier: old_pos.margin_nullifier,
                locked_margin:    old_pos.locked_margin,
                market_id,
                created_at:       old_pos.created_at,
                updated_at:       now,
                is_active:        true,
            });
            self.commitment_by_nullifier.write(old_pos.margin_nullifier, new_commitment);

            self.emit(PositionUpdated { old_commitment, old_nullifier, new_commitment, timestamp: now });
        }

        // ─── FUND (P0-03 & P0-10: Typed Fund Fact & Bidirectional Clearing) ──

        fn fund_position(
            ref self: ContractState,
            market_id: felt252,
            commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            funding_amount: u128,
            is_long_pays: bool,
            fact_hash: felt252,
        ) {
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            let mut pos = self.positions.read(commitment);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(old_nullifier) == commitment, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(old_nullifier), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            if is_long_pays {
                assert(funding_amount <= pos.locked_margin, 'FUNDING_EXCEEDS_MARGIN');
            }

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');

            let new_locked_margin = if is_long_pays {
                pos.locked_margin - funding_amount
            } else {
                pos.locked_margin + funding_amount
            };

            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_fund_fact(
                market_id,
                commitment,
                old_nullifier,
                new_commitment,
                funding_amount,
                new_locked_margin,
                price.price,
                is_long_pays,
                fact_hash,
            );
            assert(is_valid, 'INVALID_FUND_FACT');

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(commitment, pos);
            self.used_nullifiers.write(old_nullifier, true);

            self.positions.write(new_commitment, PositionRecord {
                commitment:       new_commitment,
                margin_nullifier: pos.margin_nullifier,
                locked_margin:    new_locked_margin,
                market_id,
                created_at:       pos.created_at,
                updated_at:       now,
                is_active:        true,
            });

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.collect_funding_payment(old_nullifier, funding_amount, is_long_pays);

            self.emit(PositionFunded {
                commitment,
                old_nullifier,
                new_commitment,
                funding_amount,
                is_long_pays,
                timestamp: now,
            });
        }

        // ─── LIQUIDATE (P0-05: Typed Liquidation Fact Verification) ──────────

        fn liquidate_position(
            ref self: ContractState,
            market_id: felt252,
            position_commitment: felt252,
            position_nullifier: felt252,
            liquidation_fact_hash: felt252,
            keeper_recipient: ContractAddress,
        ) {
            let mut pos = self.positions.read(position_commitment);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(position_nullifier) == position_commitment, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(position_nullifier), 'NULLIFIER_ALREADY_SPENT');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');

            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_liquidate_fact(
                market_id,
                position_commitment,
                position_nullifier,
                pos.locked_margin,
                price.price,
                keeper_recipient,
                liquidation_fact_hash,
            );
            assert(is_valid, 'INVALID_LIQUIDATE_FACT');

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(position_commitment, pos);
            self.used_nullifiers.write(position_nullifier, true);

            // 2% keeper bounty + 98% protocol insurance fund
            let total_collateral = pos.locked_margin;
            let keeper_bounty = (total_collateral * 200_u128) / 10000_u128;
            let remaining_collateral = total_collateral - keeper_bounty;

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.seize_liquidation_collateral(
                position_nullifier,
                keeper_recipient,
                keeper_bounty,
                remaining_collateral,
            );

            self.emit(PositionLiquidated {
                commitment: position_commitment,
                nullifier:  position_nullifier,
                keeper:     keeper_recipient,
                timestamp:  now,
            });
        }

        // ─── CLOSE (P0-04 & P0-06: Cryptographically Bound Position -> Payout) 

        fn close_position(
            ref self: ContractState,
            market_id: felt252,
            position_commitment: felt252,
            final_nullifier: felt252,
            payout_note_commitment: felt252,
            payout_amount: u128,
            recipient: ContractAddress,
            fact_hash: felt252,
        ) {
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            let caller = get_caller_address();
            assert(caller == recipient, 'UNAUTHORIZED_CLOSE_CALLER');

            let mut pos = self.positions.read(position_commitment);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(final_nullifier) == position_commitment, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(final_nullifier), 'FINAL_NULLIFIER_ALREADY_SPENT');

            // 1. Verify Oracle Price
            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');

            // 2. Verify Typed Close Fact strictly binding position_commitment AND payout_commitment
            let verifier = IStwoVerifierDispatcher { contract_address: self.stwo_verifier.read() };
            let is_valid = verifier.verify_close_fact(
                market_id,
                position_commitment,
                final_nullifier,
                payout_note_commitment,
                payout_amount,
                price.price,
                recipient,
                fact_hash,
            );
            assert(is_valid, 'INVALID_CLOSE_FACT');

            // 3. Checks-Effects: Deactivate & Consume Nullifier
            pos.is_active = false;
            let now = get_block_timestamp();
            pos.updated_at = now;
            self.positions.write(position_commitment, pos);
            self.used_nullifiers.write(final_nullifier, true);

            // 4. Release Payout Note in STRK20 Vault bound to recipient
            let profit = if payout_amount > pos.locked_margin {
                payout_amount - pos.locked_margin
            } else {
                0
            };

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.release_shielded_payout(payout_note_commitment, recipient, payout_amount, profit);

            self.emit(PositionClosed {
                commitment:    position_commitment,
                nullifier:     final_nullifier,
                payout_amount: payout_amount,
                recipient:     recipient,
                timestamp:     now,
            });
        }

        // ─── VIEWS & ADMIN ───────────────────────────────────────────────────

        fn is_nullifier_spent(self: @ContractState, nullifier: felt252) -> bool {
            self.used_nullifiers.read(nullifier)
        }

        fn get_position(self: @ContractState, commitment: felt252) -> PositionRecord {
            self.positions.read(commitment)
        }

        fn get_market_config(self: @ContractState, market_id: felt252) -> MarketConfig {
            self.markets.read(market_id)
        }

        fn set_strk20_adapter(ref self: ContractState, new_adapter: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.strk20_adapter.write(new_adapter);
            self.emit(AdapterUpdated { new_adapter });
        }

        fn set_oracle_adapter(ref self: ContractState, new_oracle: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.oracle_adapter.write(new_oracle);
            self.emit(OracleUpdated { new_oracle });
        }

        fn set_stwo_verifier(ref self: ContractState, new_verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.stwo_verifier.write(new_verifier);
            self.emit(VerifierUpdated { new_verifier });
        }

        fn pause_market(ref self: ContractState, market_id: felt252) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.market_paused.write(market_id, true);
            self.emit(MarketPaused { market_id });
        }

        fn resume_market(ref self: ContractState, market_id: felt252) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.market_paused.write(market_id, false);
            self.emit(MarketResumed { market_id });
        }
    }
}
