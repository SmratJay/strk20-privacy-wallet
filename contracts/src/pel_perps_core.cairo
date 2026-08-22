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

    // Canonical STRK20-collateral OPEN: called ONLY by the authorized
    // PELPerpsSTRK20Bridge after the pool has spent the trader's shielded note. The
    // collateral is pool-custodied (in-pool collateral), so no ERC20 transfer is pulled —
    // but the real Groth16 OPEN proof is verified by the Core itself before any state
    // transition. `collateral_identity` is the pseudonymous STRK20 identity key.
    fn open_position_shielded(
        ref self: TContractState,
        collateral_identity: felt252,
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
    fn set_bridge(ref self: TContractState, new_bridge: ContractAddress);
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

    // Canonical LP counterparty configuration (P0 integration).
    fn set_lp_vault(ref self: TContractState, lp_vault: ContractAddress);
    fn set_insurance_reserve(ref self: TContractState, insurance: ContractAddress);
    fn get_lp_vault_address(self: @TContractState) -> ContractAddress;
    fn get_insurance_reserve_address(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod PELPerpsCore {
    use super::{IPELPerpsCore, MarketConfig, PositionRecord};
    use super::super::oracle_adapter::{IOracleAdapterDispatcher, IOracleAdapterDispatcherTrait};
        use super::super::pel_liquidity_vault::{IPELLiquidityVaultDispatcher, IPELLiquidityVaultDispatcherTrait};
    use super::super::groth16_verifier::{IGroth16VerifierBN254Dispatcher, IGroth16VerifierBN254DispatcherTrait};
    use super::super::types::{u256_to_storage_key, u256_to_felt252};    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        oracle_adapter: ContractAddress,
        strk20_adapter: ContractAddress,
        bridge: ContractAddress, // authorized PELPerpsSTRK20Bridge (STRK20-collateral path)

        // Canonical LP counterparty integration (P0). When configured, ALL economic
        // settlement (margin lock, PnL, funding, liquidation) routes to the vault.
        lp_vault_address: ContractAddress,
        insurance_reserve_address: ContractAddress,

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

        // Market Configurations
        markets: Map<felt252, MarketConfig>,

        // Market Pause Flag
        market_paused: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PositionOpened: PositionOpened,
        PositionOpenedShielded: PositionOpenedShielded,
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
    pub struct PositionOpenedShielded {
        pub collateral_identity: felt252,
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
            // NOMINAL max leverage = 50x. The OPEN circuit enforces the leverage bound
            // with a bounded 0.05x tolerance (500500 bps, see circuits/pel_open.circom and
            // src/protocol/canonical.ts) to accommodate the 1% execution-price deviation
            // between oracle and entry. Nominal 50x is the single canonical figure; the
            // circuit tolerance is the documented safety margin for that deviation.
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

            // Public input layout: [ commitment (u256), marginNullifier (u256), marketId (felt), margin (felt), oraclePrice (felt) ]
            assert(public_inputs.len() >= 5, 'MALFORMED_OPEN_PUBLIC_INPUTS');
            let commitment_u256 = *public_inputs.at(0);
            let margin_nullifier_u256 = *public_inputs.at(1);
            let proof_market_id_u256 = *public_inputs.at(2);
            let proof_margin_u256 = *public_inputs.at(3);
            let proof_oracle_price: u128 = (*public_inputs.at(4)).low;

            let commitment_key = u256_to_storage_key(commitment_u256);
            let margin_nullifier_key = u256_to_storage_key(margin_nullifier_u256);

            let proof_market_id: felt252 = proof_market_id_u256.low.into();
            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            let proof_margin: u128 = proof_margin_u256.low;
            assert(margin_amount == proof_margin, 'MARGIN_AMOUNT_MISMATCH');
            assert(!self.used_nullifiers.read(margin_nullifier_key), 'NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(commitment_key).is_active, 'COMMITMENT_ALREADY_EXISTS');

            // Bind the proof's oracle price to the canonical on-chain oracle state.
            // The circuit additionally proves |entry - oracle| <= maxDeviation, so this
            // pins execution to the canonical price and rejects stale/manipulated prices.
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            // 3. Checks-Effects: Mark Nullifier Consumed
            self.used_nullifiers.write(margin_nullifier_key, true);

            // 4. Lock margin in the canonical counterparty. When the LP vault is
            //    configured, the vault pulls REAL USDC from the trader (public custody)
            //    and enforces the protocol risk gates (utilization + single-position
            //    cap). Otherwise the legacy STRK20Adapter path is used.
            let is_pool_custodied = false;
            let lp_vault = self.lp_vault_address.read();
            assert(lp_vault != 0.try_into().unwrap(), 'LP_VAULT_NOT_CONFIGURED');
            let insurance = self.insurance_reserve_address.read();
            assert(insurance != 0.try_into().unwrap(), 'INSURANCE_NOT_CONFIGURED');
            IPELLiquidityVaultDispatcher { contract_address: lp_vault }
                .lock_trader_margin(collateral_owner, margin_nullifier_key, proof_margin);

            // 5. Store Active Position Record
            let now = get_block_timestamp();
            self.positions.write(commitment_key, PositionRecord {
                commitment: commitment_key,
                margin_nullifier: margin_nullifier_key,
                locked_margin: proof_margin,
                market_id,
                created_at: now,
                updated_at: now,
                last_funding_timestamp: now,
                is_active: true,
                is_pool_custodied,
            });

            self.emit(PositionOpened { collateral_owner, commitment: commitment_key, market_id, margin_amount: proof_margin, timestamp: now });
        }

        // ─── OPEN SHIELDED (STRK20 pool-collateral path via the authorized bridge) ──
        //
        // Canonical STRK20-collateral OPEN. The PELPerpsSTRK20Bridge calls this AFTER the
        // privacy pool has spent the trader's shielded note inside the proven private
        // transaction, so the collateral is pool-custodied (in-pool collateral recorded by
        // the bridge) — no ERC20 transfer is pulled here. The Core STILL verifies the real
        // Groth16 OPEN proof itself (dedicated OPEN verifier) before any state transition.
        fn open_position_shielded(
            ref self: ContractState,
            collateral_identity: felt252,
            market_id: felt252,
            margin_amount: u128,
            proof_calldata: Span<felt252>,
        ) {
            // Only the authorized STRK20 bridge may drive this path (it is itself restricted
            // to the configured privacy pool).
            assert(get_caller_address() == self.bridge.read(), 'UNAUTHORIZED_BRIDGE');

            let market = self.markets.read(market_id);
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            assert(market.is_active, 'MARKET_NOT_ACTIVE');
            assert(margin_amount > 0, 'INVALID_MARGIN_AMOUNT');

            // 1. Verify Oracle Price Freshness (same as OPEN)
            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_STALE_OR_INVALID');

            // 2. Verify the REAL Groth16 OPEN proof with the dedicated OPEN verifier.
            let verifier = IGroth16VerifierBN254Dispatcher { contract_address: self.open_verifier.read() };
            let verification_result = verifier.verify_groth16_proof_bn254(proof_calldata);
            let public_inputs = match verification_result {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => core::panic_with_felt252(err),
            };

            // Public input layout: [ commitment, marginNullifier, marketId, margin, oraclePrice ]
            assert(public_inputs.len() >= 5, 'MALFORMED_OPEN_PUBLIC_INPUTS');
            let commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let margin_nullifier_key = u256_to_storage_key(*public_inputs.at(1));
            let proof_market_id: felt252 = (*public_inputs.at(2)).low.into();
            let proof_margin: u128 = (*public_inputs.at(3)).low;
            let proof_oracle_price: u128 = (*public_inputs.at(4)).low;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(margin_amount == proof_margin, 'MARGIN_AMOUNT_MISMATCH');
            assert(!self.used_nullifiers.read(margin_nullifier_key), 'NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(commitment_key).is_active, 'COMMITMENT_ALREADY_EXISTS');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            // 3. Checks-Effects: Mark Nullifier Consumed
            self.used_nullifiers.write(margin_nullifier_key, true);

            // 4. Record the pool-custodied margin in the canonical vault (receivable
            //    backed by the STRK20 pool's real USDC). The vault enforces the same
            //    risk gates (utilization + single-position cap) as the public path.
            let is_pool_custodied = true;
            let lp_vault = self.lp_vault_address.read();
            assert(lp_vault != 0.try_into().unwrap(), 'LP_VAULT_NOT_CONFIGURED');
            let insurance = self.insurance_reserve_address.read();
            assert(insurance != 0.try_into().unwrap(), 'INSURANCE_NOT_CONFIGURED');
            IPELLiquidityVaultDispatcher { contract_address: lp_vault }
                .lock_pool_custodied_margin(margin_nullifier_key, proof_margin);

            // 4. Store Active Position Record. The margin is pool-custodied (in-pool
            //    collateral recorded by the bridge) — no ERC20 transfer is pulled here.
            let now = get_block_timestamp();
            self.positions.write(commitment_key, PositionRecord {
                commitment: commitment_key,
                margin_nullifier: margin_nullifier_key,
                locked_margin: proof_margin,
                market_id,
                created_at: now,
                updated_at: now,
                last_funding_timestamp: now,
                is_active: true,
                is_pool_custodied,
            });

            // Pseudonymous STRK20 identity key (felt) that opened the position via the bridge.
            self.emit(PositionOpenedShielded {
                collateral_identity,
                commitment: commitment_key,
                market_id,
                margin_amount: proof_margin,
                timestamp: now,
            });
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
            assert(!self.used_nullifiers.read(old_nullifier_key), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment_key).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            let now = get_block_timestamp();
            old_pos.is_active = false;
            old_pos.updated_at = now;
            self.positions.write(old_commitment_key, old_pos);
            self.used_nullifiers.write(old_nullifier_key, true);

            self.positions.write(new_commitment_key, PositionRecord {
                commitment:             new_commitment_key,
                margin_nullifier:       old_nullifier_key,
                locked_margin:          old_pos.locked_margin,
                market_id,
                created_at:             old_pos.created_at,
                updated_at:             now,
                last_funding_timestamp: old_pos.last_funding_timestamp,
                is_active:              true,
                is_pool_custodied:      old_pos.is_pool_custodied,
            });

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

            // Layout: [ oldCommitment, newCommitment, oldNullifier, marketId, oraclePrice, fundingRateBpsHr, intervalsElapsed, fundingPayment, isLongPays ]
            assert(public_inputs.len() >= 9, 'MALFORMED_FUND_PUBLIC_INPUTS');
            let old_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let new_commitment_key = u256_to_storage_key(*public_inputs.at(1));
            let old_nullifier_key = u256_to_storage_key(*public_inputs.at(2));
            let proof_market_id: felt252 = (*public_inputs.at(3)).low.into();
            let proof_oracle_price: u128 = (*public_inputs.at(4)).low;
            let proof_funding_rate_low: u128 = (*public_inputs.at(5)).low;
            let proof_intervals_elapsed: u64 = (*public_inputs.at(6)).low.try_into().unwrap_or(0);
            let proof_funding_amount: u128 = (*public_inputs.at(7)).low;
            let proof_is_long_pays: bool = (*public_inputs.at(8)).low == 1_u128;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            let market = self.markets.read(market_id);
            assert(!self.market_paused.read(market_id), 'MARKET_IS_PAUSED');
            assert(market.is_active, 'MARKET_NOT_ACTIVE');
            let market_rate_abs: u128 = if market.funding_rate_bps_hr >= 0 {
                market.funding_rate_bps_hr.try_into().unwrap()
            } else {
                (-market.funding_rate_bps_hr).try_into().unwrap()
            };
            assert(proof_funding_rate_low == market_rate_abs, 'FUNDING_RATE_MISMATCH');
            assert(funding_amount == proof_funding_amount, 'FUNDING_AMOUNT_MISMATCH');
            let expected_is_long_pays = market.funding_rate_bps_hr >= 0;
            assert(proof_is_long_pays == expected_is_long_pays, 'FUNDING_DIR_MISMATCH');
            assert(is_long_pays == proof_is_long_pays, 'FUNDING_DIR_ARG_MISMATCH');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            let mut pos = self.positions.read(old_commitment_key);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(!self.used_nullifiers.read(old_nullifier_key), 'OLD_NULLIFIER_ALREADY_SPENT');
            assert(!self.positions.read(new_commitment_key).is_active, 'NEW_COMMITMENT_ALREADY_EXISTS');

            // Canonical Funding Intervals Enforcement
            // Rule (shared by circuit / Cairo / TS): intervalsElapsed == floor(elapsed / interval).
            // No "+1": a user cannot accrue an extra interval immediately after the anchor.
            assert(proof_intervals_elapsed > 0_u64, 'INTERVALS_MUST_BE_POSITIVE');
            let now = get_block_timestamp();
            let time_elapsed = if now >= pos.last_funding_timestamp {
                now - pos.last_funding_timestamp
            } else {
                0_u64
            };
            let elapsed_intervals = time_elapsed / market.funding_interval_secs;
            assert(proof_intervals_elapsed <= elapsed_intervals, 'EXAGGERATED_FUNDING_INTERVALS');

            if is_long_pays {
                assert(funding_amount <= pos.locked_margin, 'FUNDING_EXCEEDS_MARGIN');
            }

            let new_locked_margin = if is_long_pays {
                pos.locked_margin - funding_amount
            } else {
                pos.locked_margin + funding_amount
            };

            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(old_commitment_key, pos);
            self.used_nullifiers.write(old_nullifier_key, true);

            let new_funding_timestamp = pos.last_funding_timestamp + (proof_intervals_elapsed * market.funding_interval_secs);

            self.positions.write(new_commitment_key, PositionRecord {
                commitment:             new_commitment_key,
                margin_nullifier:       old_nullifier_key,
                locked_margin:          new_locked_margin,
                market_id,
                created_at:             pos.created_at,
                updated_at:             now,
                last_funding_timestamp: new_funding_timestamp,
                is_active:              true,
                is_pool_custodied:      pos.is_pool_custodied,
            });

            let is_pool_custodied = pos.is_pool_custodied;
            let lp_vault = self.lp_vault_address.read();
            assert(lp_vault != 0.try_into().unwrap(), 'LP_VAULT_NOT_CONFIGURED');
            IPELLiquidityVaultDispatcher { contract_address: lp_vault }
                .settle_funding(funding_amount, is_long_pays, is_pool_custodied);

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
        //
        // Liquidation economics (documented, integer arithmetic only):
        //   - equity        = margin + pnl - funding - fees   (proved privately by the circuit)
        //   - maintenance   = notional * maintenance_margin_bps / 10000
        //   - The LIQUIDATE circuit enforces  equity <= maintenance  before this function
        //     can succeed (liquidation is cryptographically gated on the predicate).
        //   - keeper bounty = locked_margin * 200 / 10000       (2%, fixed)
        //   - insurance     = locked_margin - keeper_bounty     (98% -> insurance fund)
        //
        // Bad debt: when a position is liquidated deeply underwater (equity < 0), the
        // locked margin no longer covers the counterparty loss. The insurance fund is the
        // bad-debt buffer: trader profits are paid insurance-first (see
        // STRK20Adapter.release_shielded_payout), and liquidation tops the insurance fund
        // back up. If the insurance fund is exhausted, profitable closes revert with
        // INSUFFICIENT_POOL_NAV rather than minting tokens. No value is created from
        // nowhere; every transition conserves token balance.
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
            let proof_keeper: ContractAddress = u256_to_felt252(*public_inputs.at(4)).try_into().unwrap();
            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(keeper_recipient == proof_keeper, 'KEEPER_RECIPIENT_MISMATCH');

            let oracle = IOracleAdapterDispatcher { contract_address: self.oracle_adapter.read() };
            let price = oracle.get_market_price(market_id);
            assert(price.is_valid, 'ORACLE_PRICE_INVALID');
            assert(price.price == proof_oracle_price, 'ORACLE_PRICE_MISMATCH');

            let mut pos = self.positions.read(position_commitment_key);
            assert(pos.is_active, 'POSITION_NOT_ACTIVE');
            assert(pos.market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(!self.used_nullifiers.read(position_nullifier_key), 'NULLIFIER_ALREADY_SPENT');

            let now = get_block_timestamp();
            pos.is_active = false;
            pos.updated_at = now;
            self.positions.write(position_commitment_key, pos);
            self.used_nullifiers.write(position_nullifier_key, true);

            // Liquidation Waterfall: 2% Keeper Bounty, remainder distributed to the LP /
            // insurance / treasury revenue split (70/20/10) by the canonical vault.
            let bounty_amount: u128 = (pos.locked_margin * 200_u128) / 10000_u128;

            // V1: the LIQUIDATE circuit does not yet expose the trader's equity as a
            // public input, so the on-chain insurance bad-debt deficit is 0 for
            // liquidation. Deeply-underwater bad debt is absorbed on the CLOSE path
            // (insurance.absorb_bad_debt) where the payout vs NAV shortfall IS
            // observable. A future circuit upgrade exposing equity enables the full
            // liquidation waterfall (see docs/LP_RISK_MODEL.md).
            let is_pool_custodied = pos.is_pool_custodied;
            let lp_vault = self.lp_vault_address.read();
            assert(lp_vault != 0.try_into().unwrap(), 'LP_VAULT_NOT_CONFIGURED');
            IPELLiquidityVaultDispatcher { contract_address: lp_vault }
                .settle_liquidation(
                    pos.locked_margin,
                    bounty_amount,
                    keeper_recipient,
                    0_u128,
                    is_pool_custodied,
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

            // Layout: [ commitment, finalNullifier, payoutCommitment, payoutAmount, marketId, oraclePrice, recipient ]
            assert(public_inputs.len() >= 7, 'MALFORMED_CLOSE_PUBLIC_INPUTS');
            let position_commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let final_nullifier_key = u256_to_storage_key(*public_inputs.at(1));
            let payout_note_commitment_key = u256_to_storage_key(*public_inputs.at(2));
            let payout_amount: u128 = (*public_inputs.at(3)).low;
            let proof_market_id: felt252 = (*public_inputs.at(4)).low.into();
            let proof_oracle_price: u128 = (*public_inputs.at(5)).low;
            let proof_recipient: ContractAddress = u256_to_felt252(*public_inputs.at(6)).try_into().unwrap();

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(recipient == proof_recipient, 'RECIPIENT_MISMATCH');

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
            let _profit_amount: u128 = if payout_amount > pos.locked_margin {
                payout_amount - pos.locked_margin
            } else {
                0_u128
            };

            // Trader loss (locked_margin - payout) is routed to the LP counterparty NAV.
            let _loss_amount: u128 = if pos.locked_margin > payout_amount {
                pos.locked_margin - payout_amount
            } else {
                0_u128
            };

            // Canonical settlement: the LP vault is the counterparty. It releases the
            // position margin, credits/debits LP NAV by the full PnL (no 70/20/10 split
            // on trader PnL), and registers the recipient-bound payout note.
            let lp_vault = self.lp_vault_address.read();
            assert(lp_vault != 0.try_into().unwrap(), 'LP_VAULT_NOT_CONFIGURED');
            IPELLiquidityVaultDispatcher { contract_address: lp_vault }
                .settle_trader_pnl(
                    pos.locked_margin,
                    payout_amount,
                    payout_note_commitment_key,
                    recipient,
                    pos.is_pool_custodied,
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

        fn set_bridge(ref self: ContractState, new_bridge: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let f: felt252 = new_bridge.try_into().unwrap();
            assert(f != 0, 'ZERO_BRIDGE_ADDRESS');
            self.bridge.write(new_bridge);
            self.emit(AdapterUpdated { new_adapter: new_bridge });
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

        // ─── CANONICAL LP COUNTERPARTY CONFIGURATION (P0) ───────────────────

        fn set_lp_vault(ref self: ContractState, lp_vault: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let f: felt252 = lp_vault.try_into().unwrap();
            assert(f != 0, 'ZERO_LP_VAULT_ADDRESS');
            self.lp_vault_address.write(lp_vault);
            self.emit(AdapterUpdated { new_adapter: lp_vault });
        }

        fn set_insurance_reserve(ref self: ContractState, insurance: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let f: felt252 = insurance.try_into().unwrap();
            assert(f != 0, 'ZERO_INSURANCE_ADDRESS');
            self.insurance_reserve_address.write(insurance);
            self.emit(AdapterUpdated { new_adapter: insurance });
        }

        fn get_lp_vault_address(self: @ContractState) -> ContractAddress {
            self.lp_vault_address.read()
        }

        fn get_insurance_reserve_address(self: @ContractState) -> ContractAddress {
            self.insurance_reserve_address.read()
        }
    }
}
