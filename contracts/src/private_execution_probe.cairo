//! PrivateExecutionProbe — TINY acceptance helper for the Wallet Core private-execution
//! primitive (Phase 1). NOT a generalized protocol.
//!
//! It is a controlled, test-only Starknet application contract whose ONLY job is to make a
//! private application execution observable on-chain:
//!
//!   1. The STRK20 privacy pool withdraws `amount` of the spend token to THIS contract
//!      (the private balance "pays" the application).
//!   2. The pool then invokes `privacy_invoke(identity, amount)` on THIS contract in the
//!      SAME apply_actions proof transaction.
//!   3. This contract records the execution: the shadow identity commitment, the amount, and
//!      the caller (always the privacy pool, never the user's master wallet) — and emits an
//!      event. The record is the observable application-side result.
//!
//! The master wallet is never revealed: the application only ever sees the shadow identity
//! commitment passed as calldata, plus the pool as the caller.
//!
//! `privacy_invoke` is the exact selector the vendored STRK20 SDK `build().invoke(...)` targets
//! (mirrors the official EkuboSwapAnonymizer / launchpad PrivateCurveExecutor contract shape).

use starknet::ContractAddress;

#[starknet::interface]
pub trait IPrivateExecutionProbe<TContractState> {
    /// Called by the STRK20 privacy pool after the private withdraw lands. Records the
    /// shadow-identity execution. `identity` is the PUBLIC shadow-account commitment.
    fn privacy_invoke(ref self: TContractState, identity: felt252, amount: u128);
    /// Number of recorded executions for a shadow identity (the acceptance assertion).
    fn get_execution_count(self: @TContractState, identity: felt252) -> u32;
    /// Whether an execution was ever recorded for a shadow identity.
    fn has_executed(self: @TContractState, identity: felt252) -> bool;
    /// The last recorded execution for a shadow identity (public record).
    fn get_last_execution(self: @TContractState, identity: felt252) -> ExecutionRecord;
    /// The configured privacy pool (caller restriction).
    fn get_privacy_pool(self: @TContractState) -> ContractAddress;
}

#[derive(Drop, Serde, starknet::Store, PartialEq)]
pub struct ExecutionRecord {
    /// The shadow identity commitment the application executed under.
    pub identity: felt252,
    /// Amount (base units) the private balance spent on this application.
    pub amount: u128,
    /// The caller — the STRK20 privacy pool, never the user's master wallet.
    pub caller: ContractAddress,
    /// Chain block at execution time (observable timing).
    pub block_number: u64,
    /// Executions recorded so far for this identity AFTER this record.
    pub count_after: u32,
}

#[starknet::contract]
pub mod PrivateExecutionProbe {
    use super::{ExecutionRecord, IPrivateExecutionProbe};
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess,
        Map,
    };
    use starknet::{get_block_info, get_caller_address, ContractAddress};

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        /// Execution count per shadow identity (u32 is ample for an acceptance probe).
        counts: Map<felt252, u32>,
        /// Last execution record per shadow identity.
        last: Map<felt252, ExecutionRecord>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrivateExecutionRecorded: PrivateExecutionRecorded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateExecutionRecorded {
        pub identity: felt252,
        pub amount: u128,
        pub caller: ContractAddress,
        pub block_number: u64,
        pub count_after: u32,
    }

    #[constructor]
    fn constructor(ref self: ContractState, privacy_pool: ContractAddress) {
        self.privacy_pool.write(privacy_pool);
    }

    #[abi(embed_v0)]
    impl IPrivateExecutionProbeImpl of IPrivateExecutionProbe<ContractState> {
        fn privacy_invoke(ref self: ContractState, identity: felt252, amount: u128) {
            // Only the configured STRK20 privacy pool may trigger the application action.
            let caller = get_caller_address();
            assert(caller == self.privacy_pool.read(), 'UNAUTHORIZED_CALLER');
            assert(amount > 0, 'ZERO_AMOUNT');
            assert(identity != 0, 'ZERO_IDENTITY');

            let count = self.counts.read(identity) + 1;
            self.counts.write(identity, count);
            let block_number = get_block_info().unbox().block_number;
            let record = ExecutionRecord { identity, amount, caller, block_number, count_after: count };
            self.last.write(identity, record);

            self.emit(
                PrivateExecutionRecorded { identity, amount, caller, block_number, count_after: count },
            );
        }

        fn get_execution_count(self: @ContractState, identity: felt252) -> u32 {
            self.counts.read(identity)
        }

        fn has_executed(self: @ContractState, identity: felt252) -> bool {
            self.counts.read(identity) > 0
        }

        fn get_last_execution(self: @ContractState, identity: felt252) -> ExecutionRecord {
            self.last.read(identity)
        }

        fn get_privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }
    }
}