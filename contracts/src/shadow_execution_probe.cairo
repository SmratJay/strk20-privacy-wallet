//! ShadowExecutionProbe — tiny acceptance application for REAL STRK20 shadow-account execution.
//!
//! In the shadow flow, the STRK20 anonymizer deploys/uses a deterministic shadow account and
//! executes application `calls` FROM it. This probe is the application: the shadow account calls
//! `record(amount)`, and the probe stores `{ caller, amount, block }` — where `caller` is the
//! SHADOW ACCOUNT's address, never the user's root wallet. It emits an event so the execution is
//! observable on-chain.
//!
//! Verification surface:
//!   get_execution_count(caller)  — how many times a shadow account recorded an action
//!   get_last_record(caller)      — the latest `{ caller, amount, block }` for a shadow address

use starknet::ContractAddress;

#[starknet::interface]
pub trait IShadowExecutionProbe<TContractState> {
    /// Called by the shadow account. Records the caller (the shadow address) + amount.
    fn record(ref self: TContractState, amount: u128);
    /// Number of recorded actions for a caller (the acceptance assertion).
    fn get_execution_count(self: @TContractState, caller: ContractAddress) -> u32;
    /// Whether a caller ever recorded an action.
    fn has_recorded(self: @TContractState, caller: ContractAddress) -> bool;
    /// The latest record for a caller (public).
    fn get_last_record(self: @TContractState, caller: ContractAddress) -> ShadowRecord;
}

#[derive(Drop, Serde, starknet::Store, PartialEq)]
pub struct ShadowRecord {
    /// The caller — the STRK20 shadow account, never the user's root wallet.
    pub caller: ContractAddress,
    /// Amount (base units) the shadow account recorded.
    pub amount: u128,
    /// Chain block at execution time.
    pub block_number: u64,
    /// Actions recorded for this caller AFTER this record.
    pub count_after: u32,
}

#[starknet::contract]
pub mod ShadowExecutionProbe {
    use super::{IShadowExecutionProbe, ShadowRecord};
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess,
        Map,
    };
    use starknet::{get_block_info, get_caller_address, ContractAddress};

    #[storage]
    struct Storage {
        /// Execution count per caller (the shadow account address).
        counts: Map<ContractAddress, u32>,
        /// Last record per caller.
        last: Map<ContractAddress, ShadowRecord>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ShadowActionRecorded: ShadowActionRecorded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShadowActionRecorded {
        pub caller: ContractAddress,
        pub amount: u128,
        pub block_number: u64,
        pub count_after: u32,
    }

    #[abi(embed_v0)]
    impl IShadowExecutionProbeImpl of IShadowExecutionProbe<ContractState> {
        fn record(ref self: ContractState, amount: u128) {
            assert(amount > 0, 'ZERO_AMOUNT');
            let caller = get_caller_address();
            let count = self.counts.read(caller) + 1;
            self.counts.write(caller, count);
            let block_number = get_block_info().unbox().block_number;
            let record = ShadowRecord { caller, amount, block_number, count_after: count };
            self.last.write(caller, record);
            self.emit(ShadowActionRecorded { caller, amount, block_number, count_after: count });
        }

        fn get_execution_count(self: @ContractState, caller: ContractAddress) -> u32 {
            self.counts.read(caller)
        }

        fn has_recorded(self: @ContractState, caller: ContractAddress) -> bool {
            self.counts.read(caller) > 0
        }

        fn get_last_record(self: @ContractState, caller: ContractAddress) -> ShadowRecord {
            self.last.read(caller)
        }
    }
}