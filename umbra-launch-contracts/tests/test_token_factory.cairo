use starknet::{ContractAddress, get_contract_address};
use core::num::traits::Zero;

use umbra_launch::interfaces::{
    ITokenFactoryDispatcher, ITokenFactoryDispatcherTrait, IBondingCurveDispatcher,
    IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait, IMemecoinDispatcher,
    IMemecoinDispatcherTrait, IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait,
};

use crate::test_utils::{
    deploy_base_asset, declare_factory, deploy_router, CREATOR_FEE_BPS, GRAD_TARGET, MAX_TRADE_BPS,
    PROTOCOL_FEE_BPS, SUPPLY, treasury, VIRTUAL_BASE, VIRTUAL_TOKEN, FEE_BPS,
};
use umbra_launch::test_base_asset::{
    ITestBaseAssetDispatcher, ITestBaseAssetDispatcherTrait,
};

fn factory() -> (ITokenFactoryDispatcher, ContractAddress) {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let factory = declare_factory(base, get_contract_address(), router);
    (factory, base)
}

fn memecoin(addr: ContractAddress) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: addr }
}

fn create_default(
    factory: ITokenFactoryDispatcher,
) -> (ContractAddress, ContractAddress, ContractAddress) {
    factory
        .create_memecoin(
            'HAMSTR',
            'HSTR',
            18,
            'ipfs://hamstr',
            SUPPLY,
            VIRTUAL_BASE,
            VIRTUAL_TOKEN,
            GRAD_TARGET,
            FEE_BPS,
            CREATOR_FEE_BPS,
            PROTOCOL_FEE_BPS,
            MAX_TRADE_BPS,
        )
}

#[test]
fn test_create_token_returns_full_stack() {
    let (factory, base) = factory();
    let (token, curve, executor) = create_default(factory);

    assert(token.is_non_zero(), 'no token');
    assert(curve.is_non_zero(), 'no curve');
    assert(executor.is_non_zero(), 'no executor');
    assert(factory.get_token_count() == 1, 'count wrong');
    assert(factory.get_token(0) == token, 'token record wrong');
    assert(factory.get_curve(0) == curve, 'curve record wrong');
    assert(factory.get_executor(0) == executor, 'executor record wrong');
    assert(factory.get_base_asset() == base, 'base wrong');
    assert(factory.get_protocol_treasury() == treasury(), 'treasury wrong');
    assert(factory.get_metadata(token) == 'ipfs://hamstr', 'metadata wrong');

    // Curve is configured correctly with the V2 fee split.
    let curve_disp = IBondingCurveDispatcher { contract_address: curve };
    assert(curve_disp.get_token() == token, 'curve token wrong');
    assert(curve_disp.get_base_asset() == base, 'curve base wrong');
    assert(curve_disp.get_graduation_target() == GRAD_TARGET, 'curve target wrong');
    assert(curve_disp.get_creator_fee_bps() == CREATOR_FEE_BPS, 'curve creator fee wrong');
    assert(curve_disp.get_protocol_fee_bps() == PROTOCOL_FEE_BPS, 'curve protocol fee wrong');
    assert(curve_disp.get_max_trade_bps() == MAX_TRADE_BPS, 'curve max trade wrong');
    assert(curve_disp.get_protocol_treasury() == treasury(), 'curve treasury wrong');

    // Supply is fully owned by the curve.
    assert(memecoin(token).total_supply() == SUPPLY, 'supply wrong');
    assert(memecoin(token).balance_of(curve) == SUPPLY, 'curve should hold all supply');

    // Executor bound to pool + curve.
    let executor_disp = IPrivateCurveExecutorDispatcher { contract_address: executor };
    assert(executor_disp.get_privacy_pool() == get_contract_address(), 'executor pool wrong');
}

#[test]
fn test_duplicate_configuration_produces_distinct_tokens() {
    let (factory, _base) = factory();
    let (token1, curve1, executor1) = create_default(factory);
    let (token2, curve2, executor2) = create_default(factory);

    assert(factory.get_token_count() == 2, 'count wrong');
    assert(token1 != token2, 'tokens must differ');
    assert(curve1 != curve2, 'curves must differ');
    assert(executor1 != executor2, 'executors must differ');
}

#[test]
fn test_factory_supply_fully_in_curve() {
    let (factory, _base) = factory();
    let (token, curve, _executor) = create_default(factory);
    // No supply leaked to the factory.
    assert(memecoin(token).balance_of(get_contract_address()) == 0, 'factory must not hold supply');
    assert(memecoin(token).balance_of(curve) == SUPPLY, 'curve holds supply');
}

#[test]
#[should_panic(expected: ('ZERO_NAME',))]
fn test_zero_name_reverts() {
    let (factory, _base) = factory();
    let _ = factory
        .create_memecoin(0, 'HSTR', 18, 'ipfs', SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN, GRAD_TARGET, FEE_BPS, CREATOR_FEE_BPS, PROTOCOL_FEE_BPS, MAX_TRADE_BPS);
}

#[test]
#[should_panic(expected: ('FEE_TOO_HIGH',))]
fn test_fee_too_high_reverts() {
    let (factory, _base) = factory();
    let _ = factory
        .create_memecoin('HAMSTR', 'HSTR', 18, 'ipfs', SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN, GRAD_TARGET, 10_001, CREATOR_FEE_BPS, PROTOCOL_FEE_BPS, MAX_TRADE_BPS);
}

#[test]
#[should_panic(expected: ('FEE_SPLIT_EXCEEDS_TOTAL',))]
fn test_fee_split_exceeds_total_reverts() {
    let (factory, _base) = factory();
    let _ = factory
        .create_memecoin('HAMSTR', 'HSTR', 18, 'ipfs', SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN, GRAD_TARGET, 25, 25, 25, MAX_TRADE_BPS);
}

#[test]
#[should_panic(expected: ('FEES_EXCEED_100PCT',))]
fn test_fees_exceed_100_percent_reverts() {
    let (factory, _base) = factory();
    let _ = factory
        .create_memecoin('HAMSTR', 'HSTR', 18, 'ipfs', SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN, GRAD_TARGET, 10_000, 5_000, 5_000, MAX_TRADE_BPS);
}

#[test]
#[should_panic(expected: ('ZERO_SUPPLY',))]
fn test_zero_supply_reverts() {
    let (factory, _base) = factory();
    let _ = factory
        .create_memecoin('HAMSTR', 'HSTR', 18, 'ipfs', 0, VIRTUAL_BASE, VIRTUAL_TOKEN, GRAD_TARGET, FEE_BPS, CREATOR_FEE_BPS, PROTOCOL_FEE_BPS, MAX_TRADE_BPS);
}

#[test]
fn test_factory_records_creator() {
    let (factory, _base) = factory();
    let (token, _curve, _executor) = create_default(factory);
    // The factory records the caller (this test contract) as the token's creator so the
    // Explore/detail UI can attribute launches on-chain.
    assert(factory.get_creator(token) == get_contract_address(), 'creator wrong');
}

#[test]
fn test_created_token_can_trade() {
    let (factory, base) = factory();
    let (token, curve, _executor) = create_default(factory);

    // Fund the test contract with base and buy through the factory-created curve.
    let amount: u128 = 1_000_000_000_000_000_000;
    ITestBaseAssetDispatcher { contract_address: base }.mint(get_contract_address(), amount.into());
    assert(
        IERC20Dispatcher { contract_address: base }.approve(curve, amount.into()), 'approve',
    );
    let out = IBondingCurveDispatcher { contract_address: curve }.buy(amount, get_contract_address());
    assert(out > 0, 'no tokens from factory curve');
    assert(memecoin(token).balance_of(get_contract_address()) == out.into(), 'buyer got tokens');
}