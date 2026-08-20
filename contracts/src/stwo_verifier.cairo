// PEL Fact Registry V4 (Whitepaper Section 3.1 & 11)
// V4: REMOVED the Poseidon recomputation fallback.
// Only pre-registered facts are accepted as valid.
// This prevents client-side fact forgery.
//
// Trust model: An authorized prover computes transition facts off-chain,
// registers them via register_verified_fact, and the contract checks
// verified_facts[fact_hash] on every state transition.
//
// This is the same model used by StarkWare's GPS/Sharp.

#[starknet::interface]
pub trait IStwoVerifier<TContractState> {
    fn verify_transition_proof(
        self: @TContractState,
        proof_type: felt252,
        market_id: felt252,
        commitment: felt252,
        nullifier: felt252,
        margin_or_payout: u128,
        oracle_price: u128,
        fact_hash: felt252,
    ) -> bool;

    fn compute_public_inputs_hash(
        self: @TContractState,
        proof_type: felt252,
        market_id: felt252,
        commitment: felt252,
        nullifier: felt252,
        margin_or_payout: u128,
        oracle_price: u128,
    ) -> felt252;

    fn register_verified_fact(ref self: TContractState, fact_hash: felt252);
    fn register_verified_facts(ref self: TContractState, fact_hashes: Array<felt252>);
    fn is_fact_registered(self: @TContractState, fact_hash: felt252) -> bool;
    fn set_prover_address(ref self: TContractState, prover: ContractAddress);
    fn get_prover_address(self: @TContractState) -> ContractAddress;
}

use starknet::ContractAddress;

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
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProverAddressUpdated {
        pub prover: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        // Prover defaults to admin until explicitly set
        self.prover_address.write(admin);
    }

    #[abi(embed_v0)]
    impl StwoVerifierImpl of IStwoVerifier<ContractState> {
        // compute_public_inputs_hash: utility for off-chain provers to compute
        // the expected hash. Kept for API compatibility.
        fn compute_public_inputs_hash(
            self: @ContractState,
            proof_type: felt252,
            market_id: felt252,
            commitment: felt252,
            nullifier: felt252,
            margin_or_payout: u128,
            oracle_price: u128,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(proof_type);
            state = state.update(market_id);
            state = state.update(commitment);
            state = state.update(nullifier);
            state = state.update(margin_or_payout.into());
            state = state.update(oracle_price.into());
            state.finalize()
        }

        // V4: ONLY registered facts are valid.
        // The old Poseidon recomputation path has been REMOVED.
        // This means a client cannot forge a valid fact_hash by computing
        // Poseidon(inputs, TAG) — the fact MUST be pre-registered by
        // an authorized prover.
        fn verify_transition_proof(
            self: @ContractState,
            proof_type: felt252,
            market_id: felt252,
            commitment: felt252,
            nullifier: felt252,
            margin_or_payout: u128,
            oracle_price: u128,
            fact_hash: felt252,
        ) -> bool {
            self.verified_facts.read(fact_hash)
        }

        // V4: Only authorized prover or admin can register facts.
        fn register_verified_fact(ref self: ContractState, fact_hash: felt252) {
            let caller = get_caller_address();
            let is_admin = caller == self.admin.read();
            let is_prover = caller == self.prover_address.read();
            assert(is_admin || is_prover, 'UNAUTHORIZED_PROVER');
            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered { fact_hash });
        }

        fn register_verified_facts(ref self: ContractState, mut fact_hashes: Array<felt252>) {
            let caller = get_caller_address();
            let is_admin = caller == self.admin.read();
            let is_prover = caller == self.prover_address.read();
            assert(is_admin || is_prover, 'UNAUTHORIZED_PROVER');

            while let Option::Some(fact_hash) = fact_hashes.pop_front() {
                self.verified_facts.write(fact_hash, true);
                self.emit(FactRegistered { fact_hash });
            };
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
