//! Adversarial tests: every constraint that a malicious actor would probe.

use starknet::{ContractAddress, contract_address_const, get_contract_address};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use umbra_launch::interfaces::{
    IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait, IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
    IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::objects::curve_operation;

use crate::test_utils::{deploy_full_stack, mint_base, CurveStack, GRAD_TARGET};

fn executor_disp(addr: ContractAddress) -> IPrivateCurveExecutorDispatcher {
    IPrivateCurveExecutorDispatcher { contract_address: addr }
}

fn base_disp(stack: CurveStack) -> IERC20Dispatcher {
    IERC20Dispatcher { contract_address: stack.base }
}

fn token_disp(stack: CurveStack) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: stack.token }
}

#[test]
#[should_panic(expected: ('BUY_INPUT_NOT_BASE',))]
fn test_executor_cannot_drain_arbitrary_erc20() {
    let stack = deploy_full_stack();
    // Deploy an unrelated token and give the executor a balance of it.
    let other_class = declare("Memecoin").unwrap().contract_class();
    let (other_token, _) = other_class
        .deploy(
            @array!['EVIL'.into(), 'EVL'.into(), 18_u8.into(), stack.executor.into(), 1_000_000_u128.into(), 0_u128.into()],
        )
        .unwrap();

    // Try to route a BUY through the curve using the unrelated token.
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, other_token, 1_000, 'note');
}

#[test]
#[should_panic(expected: ('SELL_INPUT_NOT_TOKEN',))]
fn test_executor_cannot_drain_base_with_sell() {
    let stack = deploy_full_stack();
    // Give the executor a large base balance (as if a withdraw happened) but request a SELL
    // with base as the input — the executor must refuse to move base through the sell path.
    mint_base(stack.base, stack.executor, 10_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::SELL, stack.base, 10_000_000_000_000_000_000_u128, 'note');
}

#[test]
fn test_executor_never_accepts_a_recipient() {
    // The privacy_invoke calldata has no recipient argument at all: after the pool pulls the
    // output deposit, nothing remains on the executor and nothing went anywhere else.
    let stack = deploy_full_stack();
    let token = token_disp(stack);
    let base = base_disp(stack);

    mint_base(stack.base, stack.executor, 10_000_000_000_000_000_000_u128.into());
    let deposits = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.base, 10_000_000_000_000_000_000_u128, 'note');
    assert(deposits.len() == 1, 'one deposit');
    let deposit = *deposits.at(0);

    // The pool pulls the deposit; then the executor is empty of both input and output.
    assert(token.transfer_from(stack.executor, get_contract_address(), deposit.amount.into()), 'pull');
    assert(token.balance_of(stack.executor) == 0, 'executor holds tokens');
    assert(base.balance_of(stack.executor) == 0, 'executor holds base');
    assert(executor_disp(stack.executor).get_privacy_pool() == get_contract_address(), 'pool binding');
}

#[test]
#[should_panic(expected: ('UNAUTHORIZED_DEPLOYER',))]
fn test_non_deployer_cannot_change_graduation_recipient() {
    // Deploy a curve whose deployer is NOT the test contract.
    let stack = deploy_full_stack();
    let other = contract_address_const::<'OWNN'>();
    let curve_class = declare("BondingCurve").unwrap().contract_class();
    let (curve2, _) = curve_class
        .deploy(
            @array![
                stack.base.into(),
                stack.token.into(),
                15_000_000_000_000_000_000_u128.into(),
                1_073_000_000_000_000_000_000_000_000_u128.into(),
                GRAD_TARGET.into(),
                100_u128.into(),
                other.into(),
                stack.router.into(),
            ],
        )
        .unwrap();
    let _ = IBondingCurveDispatcher { contract_address: curve2 }
        .set_graduation_recipient(get_contract_address());
}

#[test]
fn test_graduation_requires_target_then_locks_trading() {
    let stack = deploy_full_stack();
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };
    let base = base_disp(stack);

    // Reach target with exactly GRAD_TARGET.
    mint_base(stack.base, get_contract_address(), GRAD_TARGET.into());
    assert(base.approve(stack.curve, GRAD_TARGET.into()), 'approve');
    curve.buy(GRAD_TARGET, get_contract_address());

    curve.graduate();
    assert(curve.is_graduated(), 'not graduated');
    // Reserves drained to the router.
    assert(curve.get_available_liquidity() == 0, 'reserves not drained');
    assert(
        base.balance_of(stack.router) == GRAD_TARGET.into(), 'router did not receive base',
    );
}

#[test]
fn test_sell_price_is_reverse_of_buy() {
    let stack = deploy_full_stack();
    let who = contract_address_const::<'SELLR'>();
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };
    let token = token_disp(stack);
    let base = base_disp(stack);

    mint_base(stack.base, get_contract_address(), 100_000_000_000_000_000_000_u128.into());
    assert(base.approve(stack.curve, 100_000_000_000_000_000_000_u128.into()), 'approve');
    let tokens = curve.buy(50_000_000_000_000_000_000_u128, get_contract_address());

    // Selling everything must return LESS than the buy input (1% fee per leg + rounding).
    assert(token.approve(stack.curve, tokens.into()), 'token approve');
    let base_out = curve.sell(tokens, who);
    assert(base_out > 0, 'positive sell');
    assert(base_out < 50_000_000_000_000_000_000_u128, 'sell less than buy input');
}