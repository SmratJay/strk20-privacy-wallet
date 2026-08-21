// PEL Private Perpetuals Core State Machine — V5.0 (Canonical On-Chain Groth16 zk-SNARK Verification)
// Implements Whitepaper Sections 6, 12, 13, 14, 15 & Master Specification
// Protocol Version: 3

use starknet::ContractAddress;
use super::types::{MarketConfig, PositionRecord};

#[starknet::interface]
pub trait IPELPerpsCore<TContractState> {
    fn open_position(
        ref self: TContractState,
        collateral_owner: ContractAddress,
        market_id: felt252,
        margin_amount: u128,
        proof_calldata: Span<felt252>,
    );

    fn update_position(
        ref self: TContractState,
        market_id: felt252,
        proof_calldata: Span<felt252>,
    );

    fn fund_position(
        ref self: TContractState,
        market_id: felt252,
        funding_amount: u128,
        is_long_pays: bool,
        proof_calldata: Span<felt252>,
    );

    fn liquidate_position(
        ref self: TContractState,
        market_id: felt252,
        keeper_recipient: ContractAddress,
        proof_calldata: Span<felt252>,
    );

    fn close_position(
        ref self: TContractState,
        market_id: felt252,
        recipient: ContractAddress,
        proof_calldata: Span<felt252>,
    );

    fn is_nullifier_spent(self: @TContractState, nullifier: felt252) -> bool;
    fn get_position(self: @TContractState, commitment: felt252) -> PositionRecord;
    fn get_market_config(self: @TContractState, market_id: felt252) -> MarketConfig;
    fn set_strk20_adapter(ref self: TContractState, new_adapter: ContractAddress);
    fn set_oracle_adapter(ref self: TContractState, new_oracle: ContractAddress);
    fn set_groth16_verifiers(
        ref self: TContractState,
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,
    );
    fn pause_market(ref self: TContractState, market_id: felt252);
    fn resume_market(ref self: TContractState, market_id: felt252);
}

#[starknet::contract]
pub mod PELPerpsCore {
    use super::{IPELPerpsCore, MarketConfig, PositionRecord};
    use super::super::oracle_adapter::{IOracleAdapterDispatcher, IOracleAdapterDispatcherTrait};
    use super::super::strk20_adapter::{ISTRK20AdapterDispatcher, ISTRK20AdapterDispatcherTrait};
    use super::super::groth16_verifier::{IGroth16VerifierBN254Dispatcher, IGroth16VerifierBN254DispatcherTrait};
    use super::super::types::u256_to_storage_key;
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

        // Dedicated Groth16 Verifiers per circuit
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,

        // Nullifier Replay Registry (Whitepaper Section 21)
        used_nullifiers: Map<felt252, bool>,

        // Active Position State Records (Keyed by storage hash of u256 commitment)
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
        VerifiersUpdated: VerifiersUpdated,
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
    pub struct VerifiersUpdated {
        pub open_verifier: ContractAddress,
        pub update_verifier: ContractAddress,
        pub fund_verifier: ContractAddress,
        pub close_verifier: ContractAddress,
        pub liquidate_verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        oracle_adapter: ContractAddress,
        strk20_adapter: ContractAddress,
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,
    ) {
        self.admin.write(admin);
        self.oracle_adapter.write(oracle_adapter);
        self.strk20_adapter.write(strk20_adapter);
        self.open_verifier.write(open_verifier);
        self.update_verifier.write(update_verifier);
        self.fund_verifier.write(fund_verifier);
        self.close_verifier.write(close_verifier);
        self.liquidate_verifier.write(liquidate_verifier);

        // Canonical BTC-PERP V3 Configuration
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
            config_version:         3_u32,
            is_active:              true,
        });
    }

    #[abi(embed_v0)]
    impl PELPerpsCoreImpl of IPELPerpsCore<ContractState> {

        // ─── OPEN (Groth16 Proof Verification & Margin Lock) ─────────────────

        fn open_position(
            ref self: ContractState,
            collateral_owner: ContractAddress,
            market_id: felt252,
            margin_amount: u128,
            proof_calldata: Span<felt252>,
        ) {
            let caller = get_caller_address();
            assert(caller == collateral_owner, 'UNAUTHORIZED_COLLATERAL_OWNER');

            let market = self.markets.read(market_id);
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            assert(market.is_active, 'MARKET_NOT_ACTIVE');
            assert(margin_amount > 0, 'INVALID_MARGIN_AMOUNT');

            // 1. Verify Oracle Price Freshness
            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_STALE_OR_INVALID');

            // 2. On-Chain Groth16 Proof Verification
            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.open_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => {
                    core::panic_with_felt252(err);
                },
            };

            // Public input layout: [ commitment (u256), marginNullifier (u256), marketId (felt) ]
            assert(public_inputs.len() >= 3, 'MALFORMED_OPEN_PUBLIC_INPUTS');
            let commitment_u256 = *public_inputs.at(0);
            let margin_nullifier_u256 = *public_inputs.at(1);
            let proof_market_id_u256 = *public_inputs.at(2);

            let commitment_key = u256_to_storage_key(commitment_u256);
            let margin_nullifier_key = u256_to_storage_key(margin_nullifier_u256);

            let proof_market_id: felt252 = proof_market_id_u256.low.into();
            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(!self.used_nullifiers.read(margin_nullifier_key), 'NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(commitment_key).is_active, 'COMMITMENT_ALREADY_EXISTS');

            // 3. Checks-Effects: Mark Nullifier Consumed
            self.used_nullifiers.write(margin_nullifier_key, true);

            // 4. Lock Shielded Margin in STRK20 Vault from verified collateral owner
            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.lock_shielded_margin(collateral_owner, margin_nullifier_key, margin_amount);

            // 5. Store Active Position Record
            let now = get_block_timestamp();
            self.positions.write(commitment_key, PositionRecord {
                commitment: commitment_key,
                margin_nullifier: margin_nullifier_key,
                locked_margin: margin_amount,
                market_id,
                created_at: now,
                updated_at: now,
                is_active: true,
            });
            self.commitment_by_nullifier.write(margin_nullifier_key, commitment_key);

            self.emit(PositionOpened { collateral_owner, commitment: commitment_key, market_id, margin_amount, timestamp: now });
        }

        // ─── UPDATE (Groth16 Proof Verification & State Rotation) ────────────

        fn update_position(
            ref self: ContractState,
            market_id: felt252,
            proof_calldata: Span<felt252>,
        ) {
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');

            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.update_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => {
                    core::panic_with_felt252(err);
                },
            };

            // Public input layout: [ oldCommitment, newCommitment, oldNullifier, marketId ]
            assert(public_inputs.len() >= 4, 'MALFORMED_UPDATE_PUBLIC_INPUTS');
            let old_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let new_commitment_key = u256_to_storage_key(*public_inputs.at(1));
            let old_nullifier_key = u256_to_storage_key(*public_inputs.at(2));
            let proof_market_id: felt252 = (*public_inputs.at(3)).low.into();

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            let mut old_pos = self.positions.read(old_commitment_key);
            assert(old_pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(old_pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(old_nullifier_key) == old_commitment_key, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(old_nullifier_key), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment_key).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            let now = get_block_timestamp();
            old_pos.is_active = false;
            old_pos.updated_at = now;
            self.positions.write(old_commitment_key, old_pos);
            self.used_nullifiers.write(old_nullifier_key, true);

            self.positions.write(new_commitment_key, PositionRecord {
                commitment:       new_commitment_key,
                margin_nullifier: old_pos.margin_nullifier,
                locked_margin:    old_pos.locked_margin,
                market_id,
                created_at:       old_pos.created_at,
                updated_at:       now,
                is_active:        true,
            });
            self.commitment_by_nullifier.write(old_pos.margin_nullifier, new_commitment_key);

            self.emit(PositionUpdated { old_commitment: old_commitment_key, old_nullifier: old_nullifier_key, new_commitment: new_commitment_key, timestamp: now });
        }

        // ─── FUND (Groth16 Proof Verification & Funding Clearing) ────────────

        fn fund_position(
            ref self: ContractState,
            market_id: felt252,
            funding_amount: u128,
            is_long_pays: bool,
            proof_calldata: Span<felt252>,
        ) {
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');

            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.fund_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => {
                    core::panic_with_felt252(err);
                },
            };

            // Layout: [ oldCommitment, newCommitment, oldNullifier, marketId, oraclePrice, fundingRateBpsHr, intervalsElapsed ]
            assert(public_inputs.len() >= 7, 'MALFORMED_FUND_PUBLIC_INPUTS');
            let old_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let new_commitment_key = u256_to_storage_key(*public_inputs.at(1));
            let old_nullifier_key = u256_to_storage_key(*public_inputs.at(2));
            let proof_market_id: felt252 = (*public_inputs.at(3)).low.into();
            let proof_oracle_price: u128 = (*public_inputs.at(4)).low;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            let mut pos = self.positions.read(old_commitment_key);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(old_nullifier_key) == old_commitment_key, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(old_nullifier_key), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment_key).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            if is_long_pays {
                assert(funding_amount <= pos.locked_margin, 'FUNDING_EXCEEDS_MARGIN');
            }

            let new_locked_margin = if is_long_pays {
                pos.locked_margin - funding_amount
            } else {
                pos.locked_margin + funding_amount
            };

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(old_commitment_key, pos);
            self.used_nullifiers.write(old_nullifier_key, true);

            self.positions.write(new_commitment_key, PositionRecord {
                commitment:       new_commitment_key,
                margin_nullifier: pos.margin_nullifier,
                locked_margin:    new_locked_margin,
                market_id,
                created_at:       pos.created_at,
                updated_at:       now,
                is_active:        true,
            });

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.collect_funding_payment(old_nullifier_key, funding_amount, is_long_pays);

            self.emit(PositionFunded {
                commitment: old_commitment_key,
                old_nullifier: old_nullifier_key,
                new_commitment: new_commitment_key,
                funding_amount,
                is_long_pays,
                timestamp: now,
            });
        }

        // ─── LIQUIDATE (Groth16 Proof Verification & Liquidation Waterfall) ──

        fn liquidate_position(
            ref self: ContractState,
            market_id: felt252,
            keeper_recipient: ContractAddress,
            proof_calldata: Span<felt252>,
        ) {
            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.liquidate_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => {
                    core::panic_with_felt252(err);
                },
            };

            // Layout: [ positionCommitment, positionNullifier, marketId, oraclePrice, keeper ]
            assert(public_inputs.len() >= 5, 'MALFORMED_LIQ_PUBLIC_INPUTS');
            let position_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let position_nullifier_key = u256_to_storage_key(*public_inputs.at(1));
            let proof_market_id: felt252 = (*public_inputs.at(2)).low.into();
            let proof_oracle_price: u128 = (*public_inputs.at(3)).low;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            let mut pos = self.positions.read(position_commitment_key);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(self.commitment_by_nullifier.read(position_nullifier_key) == position_commitment_key, 'NULLIFIER_COMMITMENT_MISMATCH');
            assert(!self.used_nullifiers.read(position_nullifier_key), 'NULLIFIER_ALREADY_SPENT');

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(position_commitment_key, pos);
            self.used_nullifiers.write(position_nullifier_key, true);

            // Liquidation Waterfall: 2% Keeper Bounty, remainder to LP pool NAV
            let bounty_amount: u128 = (pos.locked_margin * 200_u128) / 10000_u128;
            let remaining_amount: u128 = pos.locked_margin - bounty_amount;

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.seize_liquidation_collateral(
                position_nullifier_key,
                keeper_recipient,
                bounty_amount,
                remaining_amount,
            );

            self.emit(PositionLiquidated {
                commitment: position_commitment_key,
                nullifier: position_nullifier_key,
                keeper: keeper_recipient,
                timestamp: now,
            });
        }

        // ─── CLOSE (Groth16 Proof Verification & PnL Settlement) ─────────────

        fn close_position(
            ref self: ContractState,
            market_id: felt252,
            recipient: ContractAddress,
            proof_calldata: Span<felt252>,
        ) {
            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.close_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => {
                    core::panic_with_felt252(err);
                },
            };

            // Layout: [ commitment, finalNullifier, payoutCommitment, payoutAmount, marketId, oraclePrice ]
            assert(public_inputs.len() >= 6, 'MALFORMED_CLOSE_PUBLIC_INPUTS');
            let position_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let final_nullifier_key = u256_to_storage_key(*public_inputs.at(1));
            let payout_note_commitment_key = u256_to_storage_key(*public_inputs.at(2));
            let payout_amount: u128 = (*public_inputs.at(3)).low;
            let proof_market_id: felt252 = (*public_inputs.at(4)).low.into();
            let proof_oracle_price: u128 = (*public_inputs.at(5)).low;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            let mut pos = self.positions.read(position_commitment_key);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(!self.used_nullifiers.read(final_nullifier_key), 'FINAL_NULLIFIER_ALREADY_SPENT');

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(position_commitment_key, pos);
            self.used_nullifiers.write(final_nullifier_key, true);

            // Compute exact profit above locked margin for LP accounting
            let profit_amount: u128 = if payout_amount > pos.locked_margin {
                payout_amount - pos.locked_margin
            } else {
                0_u128
            };

            let strk20 = ISTRK20AdapterDispatcher { contract_address: self.strk20_adapter.read() };
            strk20.release_shielded_payout(
                payout_note_commitment_key,
                recipient,
                payout_amount,
                profit_amount,
            );

            self.emit(PositionClosed {
                commitment: position_commitment_key,
                nullifier: final_nullifier_key,
                payout_amount,
                recipient,
                timestamp: now,
            });
        }

        // ─── VIEW FUNCTIONS ──────────────────────────────────────────────────

        fn is_nullifier_spent(self: @ContractState, nullifier: felt252) -> bool {
            self.used_nullifiers.read(nullifier)
        }

        fn get_position(self: @ContractState, commitment: felt252) -> PositionRecord {
            self.positions.read(commitment)
        }

        fn get_market_config(self: @ContractState, market_id: felt252) -> MarketConfig {
            self.markets.read(market_id)
        }

        // ─── ADMIN FUNCTIONS ─────────────────────────────────────────────────

        fn set_strk20_adapter(ref self: ContractState, new_adapter: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.strk20_adapter.write(new_adapter);
            self.emit(AdapterUpdated { new_adapter });
        }

        fn set_oracle_adapter(ref self: ContractState, new_oracle: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.oracle_adapter.write(new_oracle);
            self.emit(OracleUpdated { new_oracle });
        }

        fn set_groth16_verifiers(
            ref self: ContractState,
            open_verifier: ContractAddress,
            update_verifier: ContractAddress,
            fund_verifier: ContractAddress,
            close_verifier: ContractAddress,
            liquidate_verifier: ContractAddress,
        ) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.open_verifier.write(open_verifier);
            self.update_verifier.write(update_verifier);
            self.fund_verifier.write(fund_verifier);
            self.close_verifier.write(close_verifier);
            self.liquidate_verifier.write(liquidate_verifier);
            self.emit(VerifiersUpdated {
                open_verifier,
                update_verifier,
                fund_verifier,
                close_verifier,
                liquidate_verifier,
            });
        }

        fn pause_market(ref self: ContractState, market_id: felt252) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.market_paused.write(market_id, true);
            self.emit(MarketPaused { market_id });
        }

        fn resume_market(ref self: ContractState, market_id: felt252) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.market_paused.write(market_id, false);
            self.emit(MarketResumed { market_id });
        }
    }
}
