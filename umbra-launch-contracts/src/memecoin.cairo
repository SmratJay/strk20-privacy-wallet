//! Fixed-supply ERC20 memecoin. Supply is minted once at construction (to the initial
//! holder — the BondingCurve) and can only decrease via `burn` (the curve burns tokens it
//! receives on sell). There is no owner-mintable mechanic.

use crate::interfaces::IMemecoin;

#[starknet::contract]
pub mod Memecoin {
    use super::IMemecoin;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, Map,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        pub from: ContractAddress,
        pub to: ContractAddress,
        pub value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Approval {
        pub owner: ContractAddress,
        pub spender: ContractAddress,
        pub value: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: felt252,
        symbol: felt252,
        decimals: u8,
        initial_holder: ContractAddress,
        initial_supply: u256,
    ) {
        assert(name.is_non_zero(), 'ZERO_NAME');
        assert(symbol.is_non_zero(), 'ZERO_SYMBOL');
        assert(initial_holder.is_non_zero(), 'ZERO_INITIAL_HOLDER');
        assert(initial_supply > 0, 'ZERO_SUPPLY');
        self.name.write(name);
        self.symbol.write(symbol);
        self.decimals.write(decimals);
        self._mint(initial_holder, initial_supply);
    }

    #[abi(embed_v0)]
    impl MemecoinImpl of IMemecoin<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> felt252 {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            self._transfer(caller, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'ERC20_INSUFFICIENT_ALLOWANCE');
            self.allowances.write((sender, caller), current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            self.allowances.write((caller, spender), amount);
            self.emit(Approval { owner: caller, spender, value: amount });
            true
        }

        fn burn(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let balance = self.balances.read(caller);
            assert(balance >= amount, 'ERC20_INSUFFICIENT_BALANCE');
            let supply = self.total_supply.read();
            assert(supply >= amount, 'ERC20_BURN_EXCEEDS_SUPPLY');
            self.balances.write(caller, balance - amount);
            self.total_supply.write(supply - amount);
            self.emit(Transfer { from: caller, to: Zero::zero(), value: amount });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) {
            assert(recipient.is_non_zero(), 'ERC20_TRANSFER_TO_ZERO');
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'ERC20_INSUFFICIENT_BALANCE');
            self.balances.write(sender, sender_balance - amount);
            let recipient_balance = self.balances.read(recipient);
            self.balances.write(recipient, recipient_balance + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
        }

        fn _mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let current_supply = self.total_supply.read();
            self.total_supply.write(current_supply + amount);
            let current_balance = self.balances.read(recipient);
            self.balances.write(recipient, current_balance + amount);
            self.emit(Transfer { from: Zero::zero(), to: recipient, value: amount });
        }
    }
}