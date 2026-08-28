//! Integration tests: the full user journeys against one canonical market.

use starknet::{ContractAddress, contract_address_const, get_contract_address};

use umbra_launch::interfaces::{
    ITokenFactoryDispatcherTrait, IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait,
    IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
    IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::objects::curve_operation;

use crate::test_utils::{
    declare_factory, deploy_base_asset, deploy_router, deploy_full_stack, mint_base, CurveStack,
    FEE_BPS, GRAD_TARGET, SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN,
};

const NOTE: felt252 = 'umbra-note-1';

fn alice() -> ContractAddress {
    contract_address_const::<'ALICE'>()
}

fn executor_disp(addr: ContractAddress) -> IPrivateCurveExecutorDispatcher {
    IPrivateCurveExecutorDispatcher { contract_address: addr }
}

fn base_disp(stack: CurveStack) -> IERC20Dispatcher {
    IERC20Dispatcher { contract_address: stack.base }
}

fn token_disp(stack: CurveStack) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: stack.token }
}

/// Full private buy as the pool: withdraw input to executor, invoke, pull deposit, fill note.
fn private_buy(stack: CurveStack, base_in: u128) -> u128 {
    mint_base(stack.base, stack.executor, base_in.into());
    let deposits = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.base, base_in, NOTE);
    let deposit = *deposits.at(0);
    assert(deposit.token == stack.token, 'output must be token');
    assert(
        token_disp(stack)
            .transfer_from(stack.executor, get_contract_address(), deposit.amount.into()),
        'pull token',
    );
    deposit.amount
}

/// Full private sell as the pool: withdraw token to executor, invoke, pull base, fill note.
fn private_sell(stack: CurveStack, token_in: u128) -> u128 {
    assert(token_disp(stack).transfer(stack.executor, token_in.into()), 'withdraw token to executor');
    let deposits = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::SELL, stack.token, token_in, NOTE);
    let deposit = *deposits.at(0);
    assert(deposit.token == stack.base, 'output must be base');
    assert(
        base_disp(stack)
            .transfer_from(stack.executor, get_contract_address(), deposit.amount.into()),
        'pull base',
    );
    deposit.amount
}

#[test]
fn test_full_public_journey() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    // Public buy: the test contract is the trader and holds the tokens.
    mint_base(stack.base, get_contract_address(), 100_000_000_000_000_000_000_u128.into());
    assert(base.approve(stack.curve, 100_000_000_000_000_000_000_u128.into()), 'approve');
    let tokens = IBondingCurveDispatcher { contract_address: stack.curve }
        .buy(50_000_000_000_000_000_000_u128, get_contract_address());
    assert(token.balance_of(get_contract_address()) == tokens.into(), 'trader holds tokens');

    // Public sell.
    assert(token.approve(stack.curve, tokens.into()), 'token approve');
    let base_out = IBondingCurveDispatcher { contract_address: stack.curve }
        .sell(tokens, get_contract_address());
    assert(base_out > 0, 'trader got base back');
    assert(token.balance_of(get_contract_address()) == 0, 'trader sold all tokens');
    assert(token.balance_of(stack.curve) == token.total_supply(), 'tokens returned to curve');
}

#[test]
fn test_full_private_journey() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    // 1. Private buy: shielded STRK in -> private HAMSTR note (the pool fills our open note).
    let tokens = private_buy(stack, 50_000_000_000_000_000_000_u128);
    assert(token.balance_of(get_contract_address()) == tokens.into(), 'pool holds private note amount');
    assert(
        IBondingCurveDispatcher { contract_address: stack.curve }.get_available_liquidity()
            == 50_000_000_000_000_000_000_u128,
        'market moved',
    );

    // 2. Private sell: private HAMSTR note -> private STRK note.
    let base_out = private_sell(stack, tokens);
    assert(base.balance_of(get_contract_address()) == base_out.into(), 'pool holds private STRK');
    assert(base_out > 0, 'positive base out');

    // The market is the same one a public user traded on.
    assert(
        IBondingCurveDispatcher { contract_address: stack.curve }.get_available_liquidity()
            < 50_000_000_000_000_000_000_u128,
        'market moved again',
    );
    assert(token.balance_of(stack.curve) == token.total_supply(), 'tokens returned to curve');
}

#[test]
fn test_factory_to_graduation_journey() {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let factory = declare_factory(base, get_contract_address(), router);
    let (token, curve, _executor) = factory
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
        );

    let base_disp = IERC20Dispatcher { contract_address: base };
    // Mixed public + private trading drives the same curve to graduation.
    mint_base(base, get_contract_address(), GRAD_TARGET.into());
    assert(base_disp.approve(curve, GRAD_TARGET.into()), 'approve');
    IBondingCurveDispatcher { contract_address: curve }.buy(GRAD_TARGET, get_contract_address());

    IBondingCurveDispatcher { contract_address: curve }.graduate();
    assert(IBondingCurveDispatcher { contract_address: curve }.is_graduated(), 'graduated');

    // Graduation seeded the router with the reserves (base + unsold tokens).
    assert(base_disp.balance_of(router) == GRAD_TARGET.into(), 'router base');
    let token_disp = IMemecoinDispatcher { contract_address: token };
    assert(token_disp.balance_of(router) > 0, 'router token');
    assert(token_disp.balance_of(curve) == 0, 'curve drained');
}

#[test]
#[should_panic(expected: ('CURVE_GRADUATED',))]
fn test_private_executor_inert_after_graduation() {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let factory = declare_factory(base, get_contract_address(), router);
    let (_token, curve, executor) = factory
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
        );

    let base_disp = IERC20Dispatcher { contract_address: base };
    mint_base(base, get_contract_address(), GRAD_TARGET.into());
    assert(base_disp.approve(curve, GRAD_TARGET.into()), 'approve');
    IBondingCurveDispatcher { contract_address: curve }.buy(GRAD_TARGET, get_contract_address());
    IBondingCurveDispatcher { contract_address: curve }.graduate();

    mint_base(base, executor, 10_000_000_000_000_000_000_u128.into());
    let _ = IPrivateCurveExecutorDispatcher { contract_address: executor }
        .privacy_invoke(curve_operation::BUY, base, 10_000_000_000_000_000_000_u128, NOTE);
}

#[test]
fn test_public_and_private_share_the_same_price() {
    // A public buyer and a private buyer at the same curve state must pay the same price.
    let stack = deploy_full_stack();

    // The on-chain public quote for 10 base units ...
    let amount = 10_000_000_000_000_000_000_u128;
    let public_quote = IBondingCurveDispatcher { contract_address: stack.curve }.quote_buy(amount);

    // ... must equal exactly what the private executor pays for the same input.
    let private_tokens = private_buy(stack, amount);
    assert(public_quote == private_tokens, 'public/private price diverged');
}