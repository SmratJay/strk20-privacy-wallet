//! Public interfaces for UMBRA LAUNCH contracts.

use starknet::ContractAddress;

/// Minimal ERC20 interface (felt252 name/symbol short strings, u256 amounts) — mirrors the
/// interface used across the existing wallet repo (`contracts/src/erc20.cairo`).
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

/// Immutable fixed-supply memecoin. No mint, no burn for external callers.
#[starknet::interface]
pub trait IMemecoin<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    /// Burns tokens from the caller's balance (reduces total supply). The BondingCurve uses
    /// this to burn tokens it receives on sell. Burning only ever reduces the caller's own
    /// balance, so public exposure is safe.
    fn burn(ref self: TContractState, amount: u256);
}

/// The canonical bonding curve: one deterministic virtual-reserve constant-product market.
#[starknet::interface]
pub trait IBondingCurve<TContractState> {
    fn buy(ref self: TContractState, base_amount: u128, recipient: ContractAddress) -> u128;
    fn sell(ref self: TContractState, token_amount: u128, recipient: ContractAddress) -> u128;
    fn quote_buy(self: @TContractState, base_amount: u128) -> u128;
    fn quote_sell(self: @TContractState, token_amount: u128) -> u128;
    fn graduate(ref self: TContractState);
    fn set_graduation_recipient(ref self: TContractState, recipient: ContractAddress);
    fn get_token(self: @TContractState) -> ContractAddress;
    fn get_base_asset(self: @TContractState) -> ContractAddress;
    fn get_deployer(self: @TContractState) -> ContractAddress;
    fn get_virtual_reserves(self: @TContractState) -> (u128, u128);
    fn get_real_reserves(self: @TContractState) -> (u128, u128);
    fn get_tokens_sold(self: @TContractState) -> u128;
    fn get_graduation_target(self: @TContractState) -> u128;
    fn is_graduated(self: @TContractState) -> bool;
    fn get_price(self: @TContractState) -> (u128, u128);
    fn get_available_liquidity(self: @TContractState) -> u128;
    fn get_fee_bps(self: @TContractState) -> u128;
}

/// Factory that deploys a memecoin + its canonical curve + its private executor.
#[starknet::interface]
pub trait ITokenFactory<TContractState> {
    fn create_memecoin(
        ref self: TContractState,
        name: felt252,
        symbol: felt252,
        decimals: u8,
        metadata_uri: felt252,
        total_supply: u256,
        virtual_base_reserve: u128,
        virtual_token_reserve: u128,
        graduation_target: u128,
        fee_bps: u128,
    ) -> (ContractAddress, ContractAddress, ContractAddress);
    fn get_token_count(self: @TContractState) -> u128;
    fn get_token(self: @TContractState, id: u128) -> ContractAddress;
    fn get_curve(self: @TContractState, id: u128) -> ContractAddress;
    fn get_executor(self: @TContractState, id: u128) -> ContractAddress;
    fn get_metadata(self: @TContractState, token: ContractAddress) -> felt252;
    fn get_router(self: @TContractState) -> ContractAddress;
    fn get_base_asset(self: @TContractState) -> ContractAddress;
    fn get_privacy_pool(self: @TContractState) -> ContractAddress;
}

/// The STRK20 invoke anonymizer for the bonding curve (mirrors EkuboSwapAnonymizer).
#[starknet::interface]
pub trait IPrivateCurveExecutor<TContractState> {
    fn privacy_invoke(
        ref self: TContractState,
        operation: u8,
        input_token: ContractAddress,
        amount: u128,
        note_id: felt252,
    ) -> Span<crate::objects::OpenNoteDeposit>;
    fn get_privacy_pool(self: @TContractState) -> ContractAddress;
    fn get_curve(self: @TContractState) -> ContractAddress;
    fn get_base_asset(self: @TContractState) -> ContractAddress;
    fn get_token(self: @TContractState) -> ContractAddress;
}

/// Minimal graduation liquidity router.
#[starknet::interface]
pub trait IGraduationRouter<TContractState> {
    fn set_liquidity_manager(ref self: TContractState, manager: ContractAddress);
    fn forward_reserves(
        ref self: TContractState, curve: ContractAddress, token: ContractAddress, base_asset: ContractAddress,
    );
fn on_graduation(
        ref self: TContractState, curve: ContractAddress, token: ContractAddress, base_asset: ContractAddress,
    );
    fn get_governance(self: @TContractState) -> ContractAddress;
    fn get_liquidity_manager(self: @TContractState) -> ContractAddress;
}