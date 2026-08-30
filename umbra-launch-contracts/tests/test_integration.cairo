//! Integration tests: the full user journeys against one canonical market V2.

use starknet::{ContractAddress, contract_address_const, get_contract_address};

use umbra_launch::interfaces::{
    ITokenFactoryDispatcherTrait, IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait,
    IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
    IMemecoinDispatcher, IMemecoinDispatcherTrait, IGraduationRouterDispatcher,
    IGraduationRouterDispatcherTrait,
};
use umbra_launch::objects::curve_operation;

use crate::test_utils::{
    declare_factory, deploy_base_asset, deploy_router, deploy_full_stack, mint_base, CurveStack,
    CREATOR_FEE_BPS, FEE_BPS, GRAD_TARGET, MAX_TRADE_BPS, PROTOCOL_FEE_BPS, SUPPLY, treasury,
    VIRTUAL_BASE, VIRTUAL_TOKEN,
};

const NOTE: felt252 = 'umbra-note-1';

fn executor_disp(addr: ContractAddress) -> IPrivateCurveExecutorDispatcher {
    IPrivateCurveExecutorDispatcher { contract_address: addr }
}

fn base_disp(stack: CurveStack) -> IERC20Dispatcher {
    IERC20Dispatcher { contract_address: stack.base }
}

fn token_disp(stack: CurveStack) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: stack.token }
}

fn router_disp(stack: CurveStack) -> IGraduationRouterDispatcher {
    IGraduationRouterDispatcher { contract_address: stack.router }
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

/// Accumulate cap-compliant buys on `curve` until it auto-graduates.
fn push_to_graduation(base: ContractAddress, curve: ContractAddress) {
    let base_disp = IERC20Dispatcher { contract_address: base };
    let curve_disp = IBondingCurveDispatcher { contract_address: curve };
    let mut guard: u32 = 0;
    while !curve_disp.is_graduated() && guard < 500 {
        let step = 3_000_000_000_000_000_000_u128; // 3 STRK — cap-compliant (≤ 10% cap)
        mint_base(base, get_contract_address(), step.into());
        assert(base_disp.approve(curve, step.into()), 'approve');
        curve_disp.buy(step, get_contract_address());
        guard += 1;
    }
}

#[test]
fn test_full_public_journey() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    // Public buy: the test contract is the trader and holds the tokens.
    let buy_in = 2_000_000_000_000_000_000_u128;
    mint_base(stack.base, get_contract_address(), buy_in.into());
    assert(base.approve(stack.curve, buy_in.into()), 'approve');
    let tokens = IBondingCurveDispatcher { contract_address: stack.curve }
        .buy(buy_in, get_contract_address());
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
    let amount = 1_000_000_000_000_000_000_u128;
    let tokens = private_buy(stack, amount);
    assert(token.balance_of(get_contract_address()) == tokens.into(), 'pool holds private note amount');
    assert(
        IBondingCurveDispatcher { contract_address: stack.curve }.get_available_liquidity()
            == amount - amount * (CREATOR_FEE_BPS + PROTOCOL_FEE_BPS) / 10_000,
        'market moved',
    );

    // 2. Private sell: private HAMSTR note -> private STRK note.
    let base_out = private_sell(stack, tokens);
    assert(base.balance_of(get_contract_address()) == base_out.into(), 'pool holds private STRK');
    assert(base_out > 0, 'positive base out');

    // The market is the same one a public user traded on.
    assert(
        IBondingCurveDispatcher { contract_address: stack.curve }.get_available_liquidity()
            < amount,
        'market moved again',
    );
    assert(token.balance_of(stack.curve) == token.total_supply(), 'tokens returned to curve');

    // Private execution awareness accumulated (2 private trades, volume counted in base).
    assert(executor_disp(stack.executor).get_private_trade_count() == 2, 'two private trades');
    assert(
        executor_disp(stack.executor).get_private_volume_base() == amount + base_out,
        'private volume tracked',
    );
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
            CREATOR_FEE_BPS,
            PROTOCOL_FEE_BPS,
            MAX_TRADE_BPS,
        );

    // Mixed public + private trading drives the same curve to graduation (auto-graduates).
    push_to_graduation(base, curve);
    assert(IBondingCurveDispatcher { contract_address: curve }.is_graduated(), 'graduated');

    // Graduation seeded the router with the reserves (base + unsold tokens).
    let base_disp = IERC20Dispatcher { contract_address: base };
    assert(base_disp.balance_of(router) >= GRAD_TARGET.into(), 'router base');
    let token_disp = IMemecoinDispatcher { contract_address: token };
    assert(token_disp.balance_of(router) > 0, 'router token');
    assert(token_disp.balance_of(curve) == 0, 'curve drained');

    // Truthful migration state: graduated but NOT yet migrated.
    let router_disp = IGraduationRouterDispatcher { contract_address: router };
    assert(!router_disp.is_migrated(curve), 'not migrated yet');
}

#[test]
fn test_router_migration_moves_reserves_and_marks_migrated() {
    let stack = deploy_full_stack();
    let manager = contract_address_const::<'MANGR'>();
    let curve = stack.curve;
    let token = stack.token;
    let base = stack.base;

    push_to_graduation(base, curve);
    assert(router_disp(stack).is_migrated(curve) == false, 'not migrated before forward');

    // Governance (test contract) configures the liquidity manager and forwards reserves.
    router_disp(stack).set_liquidity_manager(manager);
    router_disp(stack).forward_reserves(curve, token, base);

    assert(router_disp(stack).is_migrated(curve), 'migrated after forward');
    assert(IERC20Dispatcher { contract_address: base }.balance_of(manager) >= GRAD_TARGET.into(), 'base at manager');
    assert(IMemecoinDispatcher { contract_address: token }.balance_of(manager) > 0, 'tokens at manager');
    assert(IERC20Dispatcher { contract_address: base }.balance_of(stack.router) == 0, 'router drained');
}

#[test]
#[should_panic(expected: ('CURVE_NOT_GRADUATED',))]
fn test_router_forward_requires_graduated_curve() {
    let stack = deploy_full_stack();
    let manager = contract_address_const::<'MANGR'>();
    router_disp(stack).set_liquidity_manager(manager);
    // Curve not graduated yet — forwarding must revert.
    router_disp(stack).forward_reserves(stack.curve, stack.token, stack.base);
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
            CREATOR_FEE_BPS,
            PROTOCOL_FEE_BPS,
            MAX_TRADE_BPS,
        );

    push_to_graduation(base, curve);

    mint_base(base, executor, 1_000_000_000_000_000_000_u128.into());
    let _ = IPrivateCurveExecutorDispatcher { contract_address: executor }
        .privacy_invoke(curve_operation::BUY, base, 1_000_000_000_000_000_000_u128, NOTE);
}

#[test]
fn test_public_and_private_share_the_same_price() {
    // A public buyer and a private buyer at the same curve state must pay the same price.
    let stack = deploy_full_stack();

    // The on-chain public quote for 1 base unit ...
    let amount = 1_000_000_000_000_000_000_u128;
    let public_quote = IBondingCurveDispatcher { contract_address: stack.curve }.quote_buy(amount);

    // ... must equal exactly what the private executor pays for the same input.
    let private_tokens = private_buy(stack, amount);
    assert(public_quote == private_tokens, 'public/private price diverged');
}

#[test]
fn test_factory_curve_gets_v2_fee_configuration() {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let factory = declare_factory(base, get_contract_address(), router);
    let (_token, curve, _executor) = factory
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
        );
    let curve_disp = IBondingCurveDispatcher { contract_address: curve };
    assert(curve_disp.get_fee_bps() == FEE_BPS, 'total fee');
    assert(curve_disp.get_creator_fee_bps() == CREATOR_FEE_BPS, 'creator fee');
    assert(curve_disp.get_protocol_fee_bps() == PROTOCOL_FEE_BPS, 'protocol fee');
    assert(curve_disp.get_max_trade_bps() == MAX_TRADE_BPS, 'max trade');
    assert(curve_disp.get_protocol_treasury() == treasury(), 'treasury');
    // Deployer of a factory-created curve is the caller (creator).
    assert(curve_disp.get_deployer() == get_contract_address(), 'creator is deployer');
}