// PEL Fact Registry V4.3 (Typed Transition Fact Schemas)
// Implements Whitepaper Section 3.1, 11 & Runbook Section 2 & 3
//
// Domain-Separated Typed Fact Hashing:
// OPEN_FACT = H(OPEN_TAG, market, commitment, margin_nullifier, margin, oracle_price, owner)
// UPDATE_FACT = H(UPDATE_TAG, market, old_commitment, old_nullifier, new_commitment, new_margin, oracle_price)
// FUND_FACT = H(FUND_TAG, market, old_commitment, old_nullifier, new_commitment, funding, new_margin, oracle_price, direction)
// CLOSE_FACT = H(CLOSE_TAG, market, position_commitment, final_nullifier, payout_commitment, payout_amount, oracle_price, recipient)
// LIQ_FACT = H(LIQUIDATE_TAG, market, position_commitment, position_nullifier, liquidation_amount, oracle_price, keeper)

use starknet::ContractAddress;

#[starknet::interface]
pub trait IStwoVerifier<TContractState> {
    fn verify_open_fact(
        self: @TContractState,
        market_id: felt252,
        commitment: felt252,
        margin_nullifier: felt252,
        margin: u128,
        oracle_price: u128,
        owner: ContractAddress,
        fact_hash: felt252,
    ) -> bool;

    fn verify_update_fact(
        self: @TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        new_margin: u128,
        oracle_price: u128,
        fact_hash: felt252,
    ) -> bool;

    fn verify_fund_fact(
        self: @TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        funding: u128,
        new_margin: u128,
        oracle_price: u128,
        direction: bool,
        fact_hash: felt252,
    ) -> bool;

    fn verify_close_fact(
        self: @TContractState,
        market_id: felt252,
        position_commitment: felt252,
        final_nullifier: felt252,
        payout_commitment: felt252,
        payout_amount: u128,
        oracle_price: u128,
        recipient: ContractAddress,
        fact_hash: felt252,
    ) -> bool;

    fn verify_liquidate_fact(
        self: @TContractState,
        market_id: felt252,
        position_commitment: felt252,
        position_nullifier: felt252,
        liquidation_amount: u128,
        oracle_price: u128,
        keeper: ContractAddress,
        fact_hash: felt252,
    ) -> bool;

    fn register_open_fact(
        ref self: TContractState,
        market_id: felt252,
        commitment: felt252,
        margin_nullifier: felt252,
        margin: u128,
        oracle_price: u128,
        owner: ContractAddress,
        fact_hash: felt252,
    );

    fn register_update_fact(
        ref self: TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        new_margin: u128,
        oracle_price: u128,
        fact_hash: felt252,
    );

    fn register_fund_fact(
        ref self: TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        funding: u128,
        new_margin: u128,
        oracle_price: u128,
        direction: bool,
        fact_hash: felt252,
    );

    fn register_close_fact(
        ref self: TContractState,
        market_id: felt252,
        position_commitment: felt252,
        final_nullifier: felt252,
        payout_commitment: felt252,
        payout_amount: u128,
        oracle_price: u128,
        recipient: ContractAddress,
        fact_hash: felt252,
    );

    fn register_liquidate_fact(
        ref self: TContractState,
        market_id: felt252,
        position_commitment: felt252,
        position_nullifier: felt252,
        liquidation_amount: u128,
        oracle_price: u128,
        keeper: ContractAddress,
        fact_hash: felt252,
    );

    fn compute_open_fact_hash(
        self: @TContractState,
        market_id: felt252,
        commitment: felt252,
        margin_nullifier: felt252,
        margin: u128,
        oracle_price: u128,
        owner: ContractAddress,
    ) -> felt252;

    fn compute_update_fact_hash(
        self: @TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        new_margin: u128,
        oracle_price: u128,
    ) -> felt252;

    fn compute_fund_fact_hash(
        self: @TContractState,
        market_id: felt252,
        old_commitment: felt252,
        old_nullifier: felt252,
        new_commitment: felt252,
        funding: u128,
        new_margin: u128,
        oracle_price: u128,
        direction: bool,
    ) -> felt252;

    fn compute_close_fact_hash(
        self: @TContractState,
        market_id: felt252,
        position_commitment: felt252,
        final_nullifier: felt252,
        payout_commitment: felt252,
        payout_amount: u128,
        oracle_price: u128,
        recipient: ContractAddress,
    ) -> felt252;

    fn compute_liquidate_fact_hash(
        self: @TContractState,
        market_id: felt252,
        position_commitment: felt252,
        position_nullifier: felt252,
        liquidation_amount: u128,
        oracle_price: u128,
        keeper: ContractAddress,
    ) -> felt252;

    fn register_emergency_fact(ref self: TContractState, fact_hash: felt252);
    fn is_fact_registered(self: @TContractState, fact_hash: felt252) -> bool;
    fn set_prover_address(ref self: TContractState, prover: ContractAddress);
    fn get_prover_address(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod StwoVerifier {
    use super::IStwoVerifier;
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const OPEN_TAG: felt252 = 'STWO_PEL_OPEN_V4';
    const UPDATE_TAG: felt252 = 'STWO_PEL_UPDATE_V4';
    const FUND_TAG: felt252 = 'STWO_PEL_FUND_V4';
    const CLOSE_TAG: felt252 = 'STWO_PEL_CLOSE_V4';
    const LIQ_TAG: felt252 = 'STWO_PEL_LIQ_V4';

    #[storage]
    struct Storage {
        admin: ContractAddress,
        prover_address: ContractAddress,
        verified_facts: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FactRegistered: FactRegistered,
        ProverAddressUpdated: ProverAddressUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FactRegistered {
        pub fact_hash: felt252,
        pub tag: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProverAddressUpdated {
        pub prover: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        self.prover_address.write(admin);
    }

    #[abi(embed_v0)]
    impl StwoVerifierImpl of IStwoVerifier<ContractState> {

        // ─── COMPUTE TYPED FACT HASHES ───────────────────────────────────────

        fn compute_open_fact_hash(
            self: @ContractState,
            market_id: felt252,
            commitment: felt252,
            margin_nullifier: felt252,
            margin: u128,
            oracle_price: u128,
            owner: ContractAddress,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(OPEN_TAG);
            state = state.update(market_id);
            state = state.update(commitment);
            state = state.update(margin_nullifier);
            state = state.update(margin.into());
            state = state.update(oracle_price.into());
            let owner_felt: felt252 = owner.into();
            state = state.update(owner_felt);
            state.finalize()
        }

        fn compute_update_fact_hash(
            self: @ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            new_margin: u128,
            oracle_price: u128,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(UPDATE_TAG);
            state = state.update(market_id);
            state = state.update(old_commitment);
            state = state.update(old_nullifier);
            state = state.update(new_commitment);
            state = state.update(new_margin.into());
            state = state.update(oracle_price.into());
            state.finalize()
        }

        fn compute_fund_fact_hash(
            self: @ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            funding: u128,
            new_margin: u128,
            oracle_price: u128,
            direction: bool,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(FUND_TAG);
            state = state.update(market_id);
            state = state.update(old_commitment);
            state = state.update(old_nullifier);
            state = state.update(new_commitment);
            state = state.update(funding.into());
            state = state.update(new_margin.into());
            state = state.update(oracle_price.into());
            let dir_felt: felt252 = if direction { 1 } else { 0 };
            state = state.update(dir_felt);
            state.finalize()
        }

        fn compute_close_fact_hash(
            self: @ContractState,
            market_id: felt252,
            position_commitment: felt252,
            final_nullifier: felt252,
            payout_commitment: felt252,
            payout_amount: u128,
            oracle_price: u128,
            recipient: ContractAddress,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(CLOSE_TAG);
            state = state.update(market_id);
            state = state.update(position_commitment);
            state = state.update(final_nullifier);
            state = state.update(payout_commitment);
            state = state.update(payout_amount.into());
            state = state.update(oracle_price.into());
            let rec_felt: felt252 = recipient.into();
            state = state.update(rec_felt);
            state.finalize()
        }

        fn compute_liquidate_fact_hash(
            self: @ContractState,
            market_id: felt252,
            position_commitment: felt252,
            position_nullifier: felt252,
            liquidation_amount: u128,
            oracle_price: u128,
            keeper: ContractAddress,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(LIQ_TAG);
            state = state.update(market_id);
            state = state.update(position_commitment);
            state = state.update(position_nullifier);
            state = state.update(liquidation_amount.into());
            state = state.update(oracle_price.into());
            let keeper_felt: felt252 = keeper.into();
            state = state.update(keeper_felt);
            state.finalize()
        }

        // ─── VERIFY TYPED FACTS ──────────────────────────────────────────────

        fn verify_open_fact(
            self: @ContractState,
            market_id: felt252,
            commitment: felt252,
            margin_nullifier: felt252,
            margin: u128,
            oracle_price: u128,
            owner: ContractAddress,
            fact_hash: felt252,
        ) -> bool {
            let expected = self.compute_open_fact_hash(market_id, commitment, margin_nullifier, margin, oracle_price, owner);
            (expected == fact_hash) && self.verified_facts.read(fact_hash)
        }

        fn verify_update_fact(
            self: @ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            new_margin: u128,
            oracle_price: u128,
            fact_hash: felt252,
        ) -> bool {
            let expected = self.compute_update_fact_hash(market_id, old_commitment, old_nullifier, new_commitment, new_margin, oracle_price);
            (expected == fact_hash) && self.verified_facts.read(fact_hash)
        }

        fn verify_fund_fact(
            self: @ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            funding: u128,
            new_margin: u128,
            oracle_price: u128,
            direction: bool,
            fact_hash: felt252,
        ) -> bool {
            let expected = self.compute_fund_fact_hash(market_id, old_commitment, old_nullifier, new_commitment, funding, new_margin, oracle_price, direction);
            (expected == fact_hash) && self.verified_facts.read(fact_hash)
        }

        fn verify_close_fact(
            self: @ContractState,
            market_id: felt252,
            position_commitment: felt252,
            final_nullifier: felt252,
            payout_commitment: felt252,
            payout_amount: u128,
            oracle_price: u128,
            recipient: ContractAddress,
            fact_hash: felt252,
        ) -> bool {
            let expected = self.compute_close_fact_hash(market_id, position_commitment, final_nullifier, payout_commitment, payout_amount, oracle_price, recipient);
            (expected == fact_hash) && self.verified_facts.read(fact_hash)
        }

        fn verify_liquidate_fact(
            self: @ContractState,
            market_id: felt252,
            position_commitment: felt252,
            position_nullifier: felt252,
            liquidation_amount: u128,
            oracle_price: u128,
            keeper: ContractAddress,
            fact_hash: felt252,
        ) -> bool {
            let expected = self.compute_liquidate_fact_hash(market_id, position_commitment, position_nullifier, liquidation_amount, oracle_price, keeper);
            (expected == fact_hash) && self.verified_facts.read(fact_hash)
        }

        // ─── REGISTER TYPED FACTS ────────────────────────────────────────────

        fn register_open_fact(
            ref self: ContractState,
            market_id: felt252,
            commitment: felt252,
            margin_nullifier: felt252,
            margin: u128,
            oracle_price: u128,
            owner: ContractAddress,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.prover_address.read(), 'UNAUTHORIZED_PROVER');
            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let expected = self.compute_open_fact_hash(market_id, commitment, margin_nullifier, margin, oracle_price, owner);
            assert(fact_hash == expected, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash, tag: OPEN_TAG });
        }

        fn register_update_fact(
            ref self: ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            new_margin: u128,
            oracle_price: u128,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.prover_address.read(), 'UNAUTHORIZED_PROVER');
            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let expected = self.compute_update_fact_hash(market_id, old_commitment, old_nullifier, new_commitment, new_margin, oracle_price);
            assert(fact_hash == expected, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash, tag: UPDATE_TAG });
        }

        fn register_fund_fact(
            ref self: ContractState,
            market_id: felt252,
            old_commitment: felt252,
            old_nullifier: felt252,
            new_commitment: felt252,
            funding: u128,
            new_margin: u128,
            oracle_price: u128,
            direction: bool,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.prover_address.read(), 'UNAUTHORIZED_PROVER');
            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let expected = self.compute_fund_fact_hash(market_id, old_commitment, old_nullifier, new_commitment, funding, new_margin, oracle_price, direction);
            assert(fact_hash == expected, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash, tag: FUND_TAG });
        }

        fn register_close_fact(
            ref self: ContractState,
            market_id: felt252,
            position_commitment: felt252,
            final_nullifier: felt252,
            payout_commitment: felt252,
            payout_amount: u128,
            oracle_price: u128,
            recipient: ContractAddress,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.prover_address.read(), 'UNAUTHORIZED_PROVER');
            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let expected = self.compute_close_fact_hash(market_id, position_commitment, final_nullifier, payout_commitment, payout_amount, oracle_price, recipient);
            assert(fact_hash == expected, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash, tag: CLOSE_TAG });
        }

        fn register_liquidate_fact(
            ref self: ContractState,
            market_id: felt252,
            position_commitment: felt252,
            position_nullifier: felt252,
            liquidation_amount: u128,
            oracle_price: u128,
            keeper: ContractAddress,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            assert(caller == self.prover_address.read(), 'UNAUTHORIZED_PROVER');
            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let expected = self.compute_liquidate_fact_hash(market_id, position_commitment, position_nullifier, liquidation_amount, oracle_price, keeper);
            assert(fact_hash == expected, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash, tag: LIQ_TAG });
        }

        fn register_emergency_fact(ref self: ContractState, fact_hash: felt252) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.verified_facts.write(fact_hash, true);
        }

        fn is_fact_registered(self: @ContractState, fact_hash: felt252) -> bool {
            self.verified_facts.read(fact_hash)
        }

        fn set_prover_address(ref self: ContractState, prover: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.prover_address.write(prover);
            self.emit(ProverAddressUpdated { prover });
        }

        fn get_prover_address(self: @ContractState) -> ContractAddress {
            self.prover_address.read()
        }
    }
}
