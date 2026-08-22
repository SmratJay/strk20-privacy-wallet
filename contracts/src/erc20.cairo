// Generic ERC20 interface — the canonical token interface used by ALL production PEL
// contracts (PELLiquidityVault, PELInsuranceReserve, STRK20Adapter). Production contracts
// MUST NOT semantically depend on `test_usdc`; they operate through this generic
// `IERC20` dispatcher regardless of which collateral token is configured.
//
// `mint` is intentionally exposed so test deployments (TestUSDC) can fund actors; a
// production collateral token simply implements the standard view/transfer methods and
// may omit mint (the PEL contracts never call it).

use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}