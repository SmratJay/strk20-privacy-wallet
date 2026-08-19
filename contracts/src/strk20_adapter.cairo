// STRK20 Shielded Collateral Adapter (Whitepaper Section 3.2 & 6)
use starknet::ContractAddress;

#[starknet::interface]
pub trait ISTRK20Adapter<TContractState> {
    fn lock_shielded_margin(ref self: TContractState, nullifier: felt252, amount: u128);
    fn release_shielded_payout(ref self: TContractState, recipient_note_commitment: felt252, amount: u128);
    fn get_total_locked_collateral(self: @TContractState) -> u128;
}

#[starknet::contract]
pub mod STRK20Adapter {
    use super::ISTRK20Adapter;
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        total_locked_collateral: u128,
        used_margin_nullifiers: LegacyMap<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MarginLocked: MarginLocked,
        PayoutReleased: PayoutReleased,
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

        fn get_total_locked_collateral(self: @ContractState) -> u128 {
            self.total_locked_collateral.read()
        }
    }
}
