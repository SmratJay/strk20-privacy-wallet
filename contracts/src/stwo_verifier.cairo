// PEL Fact Registry V4.2 (Input-Bound Fact Registration & Verifier)
// Implements Whitepaper Section 3.1 & 11
//
// Self-describing & Input-Bound Fact Verification:
// Recomputes expected Poseidon fact hash inside verify_transition_proof from supplied arguments
// and validates both hash equality AND verified_facts registration.
// Fact Hash: Poseidon(Poseidon(proof_type, market_id, commitment, nullifier, amount, oracle_price, recipient), TAG)

use starknet::ContractAddress;

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
        recipient_or_caller: ContractAddress,
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
        recipient_or_caller: ContractAddress,
    ) -> felt252;

    fn register_verified_fact(
        ref self: TContractState,
        proof_type: felt252,
        market_id: felt252,
        commitment: felt252,
        nullifier: felt252,
        margin_or_payout: u128,
        oracle_price: u128,
        recipient_or_caller: ContractAddress,
        fact_hash: felt252,
    );

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

    const STWO_TAG: felt252 = 'STWO_SNIP36_PROOF_V2';

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
        pub proof_type: felt252,
        pub market_id: felt252,
        pub commitment: felt252,
        pub nullifier: felt252,
        pub margin_or_payout: u128,
        pub oracle_price: u128,
        pub recipient_or_caller: ContractAddress,
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
        fn compute_public_inputs_hash(
            self: @ContractState,
            proof_type: felt252,
            market_id: felt252,
            commitment: felt252,
            nullifier: felt252,
            margin_or_payout: u128,
            oracle_price: u128,
            recipient_or_caller: ContractAddress,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(proof_type);
            state = state.update(market_id);
            state = state.update(commitment);
            state = state.update(nullifier);
            state = state.update(margin_or_payout.into());
            state = state.update(oracle_price.into());
            let recipient_felt: felt252 = recipient_or_caller.into();
            state = state.update(recipient_felt);
            state.finalize()
        }

        // P0 #1: Input-Bound Verifier Verification (Recomputes Fact Hash from Transition Arguments)
        fn verify_transition_proof(
            self: @ContractState,
            proof_type: felt252,
            market_id: felt252,
            commitment: felt252,
            nullifier: felt252,
            margin_or_payout: u128,
            oracle_price: u128,
            recipient_or_caller: ContractAddress,
            fact_hash: felt252,
        ) -> bool {
            let inputs_hash = self.compute_public_inputs_hash(
                proof_type, market_id, commitment, nullifier, margin_or_payout, oracle_price, recipient_or_caller
            );

            let mut state = PoseidonTrait::new();
            state = state.update(inputs_hash);
            state = state.update(STWO_TAG);
            let expected_fact_hash = state.finalize();

            (expected_fact_hash == fact_hash) && self.verified_facts.read(fact_hash)
        }

        // Self-describing registration with on-chain hashing & recipient binding
        fn register_verified_fact(
            ref self: ContractState,
            proof_type: felt252,
            market_id: felt252,
            commitment: felt252,
            nullifier: felt252,
            margin_or_payout: u128,
            oracle_price: u128,
            recipient_or_caller: ContractAddress,
            fact_hash: felt252,
        ) {
            let caller = get_caller_address();
            let is_admin = caller == self.admin.read();
            let is_prover = caller == self.prover_address.read();
            assert(is_admin || is_prover, 'UNAUTHORIZED_PROVER');

            assert(oracle_price > 0, 'INVALID_ZERO_PRICE');
            assert(market_id == 'BTC-PERP', 'INVALID_MARKET_ID');

            let inputs_hash = self.compute_public_inputs_hash(
                proof_type, market_id, commitment, nullifier, margin_or_payout, oracle_price, recipient_or_caller
            );

            let mut state = PoseidonTrait::new();
            state = state.update(inputs_hash);
            state = state.update(STWO_TAG);
            let expected_fact_hash = state.finalize();

            assert(fact_hash == expected_fact_hash, 'FACT_HASH_MISMATCH');
            assert(!self.verified_facts.read(fact_hash), 'FACT_ALREADY_REGISTERED');

            self.verified_facts.write(fact_hash, true);
            self.emit(FactRegistered {
                fact_hash,
                proof_type,
                market_id,
                commitment,
                nullifier,
                margin_or_payout,
                oracle_price,
                recipient_or_caller,
            });
        }

        // Emergency admin bypass for critical upgrades (isolated testnet assumption)
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
