// STRK20 Shielded Collateral Adapter (Whitepaper Section 3.2 & 6)
use starknet::ContractAddress;

#[starknet::interface]
pub trait ISTRK20Adapter<TContractState> {
    fn lock_shielded_margin(ref self: TContractState, nullifier: felt252, amount: u128);
    fn release_shielded_payout(ref self: TContractState, recipient_note_commitment: felt252, amount: u128);
    fn seize_liquidation_collateral(
        ref self: TContractState,
        nullifier: felt252,
        keeper_recipient: ContractAddress,
        bounty_amount: u128,
        remaining_amount: u128,
    );
    fn set_pel_core_address(ref self: TContractState, pel_core: ContractAddress);
    fn get_total_locked_collateral(self: @TContractState) -> u128;
    fn is_margin_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

#[starknet::contract]
pub mod STRK20Adapter {
    use super::ISTRK20Adapter;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        total_locked_collateral: u128,
        used_margin_nullifiers: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MarginLocked: MarginLocked,
        PayoutReleased: PayoutReleased,
        CollateralLiquidated: CollateralLiquidated,
        PelCoreAddressUpdated: PelCoreAddressUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarginLocked {
        pub nullifier: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutReleased {
        pub note_commitment: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralLiquidated {
        pub nullifier: felt252,
        pub keeper: ContractAddress,
        pub bounty_amount: u128,
        pub remaining_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PelCoreAddressUpdated {
        pub pel_core: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, pel_core: ContractAddress) {
        self.admin.write(admin);
        self.pel_core_address.write(pel_core);
        self.total_locked_collateral.write(0);
    }

    #[abi(embed_v0)]
    impl STRK20AdapterImpl of ISTRK20Adapter<ContractState> {
        fn lock_shielded_margin(ref self: ContractState, nullifier: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');
            assert(!self.used_margin_nullifiers.read(nullifier), 'MARGIN_NULLIFIER_ALREADY_USED');
            assert(amount > 0, 'INVALID_MARGIN_AMOUNT');

            self.used_margin_nullifiers.write(nullifier, true);
            let current = self.total_locked_collateral.read();
            self.total_locked_collateral.write(current + amount);

            self.emit(MarginLocked { nullifier, amount });
        }

        fn release_shielded_payout(ref self: ContractState, recipient_note_commitment: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let current = self.total_locked_collateral.read();
            if current >= amount {
                self.total_locked_collateral.write(current - amount);
            } else {
                self.total_locked_collateral.write(0);
            }

            self.emit(PayoutReleased { note_commitment: recipient_note_commitment, amount });
        }

        fn seize_liquidation_collateral(
            ref self: ContractState,
            nullifier: felt252,
            keeper_recipient: ContractAddress,
            bounty_amount: u128,
            remaining_amount: u128,
        ) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let total_seized = bounty_amount + remaining_amount;
            let current = self.total_locked_collateral.read();
            if current >= total_seized {
                self.total_locked_collateral.write(current - total_seized);
            } else {
                self.total_locked_collateral.write(0);
            }

            self.emit(CollateralLiquidated {
                nullifier,
                keeper: keeper_recipient,
                bounty_amount,
                remaining_amount,
            });
        }

        fn set_pel_core_address(ref self: ContractState, pel_core: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.pel_core_address.write(pel_core);
            self.emit(PelCoreAddressUpdated { pel_core });
        }

        fn get_total_locked_collateral(self: @ContractState) -> u128 {
            self.total_locked_collateral.read()
        }

        fn is_margin_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.used_margin_nullifiers.read(nullifier)
        }
    }
}
