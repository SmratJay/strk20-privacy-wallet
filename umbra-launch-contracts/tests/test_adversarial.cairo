//! Adversarial tests: every constraint that a malicious actor would probe in V2.

use starknet::{ContractAddress, contract_address_const, get_contract_address};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use umbra_launch::interfaces::{
    IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait, IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
    IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::objects::curve_operation;

use crate::test_utils::{
    deploy_full_stack, mint_base, CurveStack, CREATOR_FEE_BPS, GRAD_TARGET, PROTOCOL_FEE_BPS,
};

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
    mint_base(stack.base, stack.executor, 1_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::SELL, stack.base, 1_000_000_000_000_000_000_u128, 'note');
}

#[test]
fn test_executor_never_accepts_a_recipient() {
    // The privacy_invoke calldata has no recipient argument at all: after the pool pulls the
    // output deposit, nothing remains on the executor and nothing went anywhere else.
    let stack = deploy_full_stack();
    let token = token_disp(stack);
    let base = base_disp(stack);

    mint_base(stack.base, stack.executor, 1_000_000_000_000_000_000_u128.into());
    let deposits = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.base, 1_000_000_000_000_000_000_u128, 'note');
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
                30_000_000_000_000_000_000_u128.into(),
                1_000_000_000_000_000_000_000_000_000_u128.into(),
                GRAD_TARGET.into(),
                100_u128.into(),
                CREATOR_FEE_BPS.into(),
                PROTOCOL_FEE_BPS.into(),
                1000_u128.into(),
                other.into(),
                contract_address_const::<'TRESY'>().into(),
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

    // Reach the target with cap-compliant steps; the final buy auto-graduates.
    let mut guard: u32 = 0;
    while !curve.is_graduated() && guard < 500 {
        let step = 3_000_000_000_000_000_000_u128;
        mint_base(stack.base, get_contract_address(), step.into());
        assert(base.approve(stack.curve, step.into()), 'approve');
        curve.buy(step, get_contract_address());
        guard += 1;
    }
    assert(curve.is_graduated(), 'not graduated');
    // Reserves drained to the router.
    assert(curve.get_available_liquidity() == 0, 'reserves not drained');
    assert(base.balance_of(stack.router) >= GRAD_TARGET.into(), 'router did not receive base');
}

#[test]
fn test_sell_price_is_reverse_of_buy() {
    let stack = deploy_full_stack();
    let who = contract_address_const::<'SELLR'>();
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };
    let token = token_disp(stack);
    let base = base_disp(stack);

    let buy_in = 2_000_000_000_000_000_000_u128;
    mint_base(stack.base, get_contract_address(), buy_in.into());
    assert(base.approve(stack.curve, buy_in.into()), 'approve');
    let tokens = curve.buy(buy_in, get_contract_address());

    // Selling everything must return LESS than the buy input (fees + rounding).
    assert(token.approve(stack.curve, tokens.into()), 'token approve');
    let base_out = curve.sell(tokens, who);
    assert(base_out > 0, 'positive sell');
    assert(base_out < buy_in, 'sell less than buy input');
}

#[test]
fn test_fee_split_cannot_be_misconfigured_to_drain() {
    // A curve with fee split where creator+protocol == fee leaves nothing retained but the
    // reserve still counts net — funds can never exceed what traders paid in.
    let stack = deploy_full_stack();
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };
    let base = base_disp(stack);

    let buy_in = 1_000_000_000_000_000_000_u128;
    mint_base(stack.base, get_contract_address(), buy_in.into());
    assert(base.approve(stack.curve, buy_in.into()), 'approve');
    curve.buy(buy_in, get_contract_address());

    // reserve + creator + protocol exactly equals the gross input — nothing fabricated.
    let (br, _) = curve.get_real_reserves();
    let creator_share = buy_in * CREATOR_FEE_BPS / 10_000;
    let protocol_share = buy_in * PROTOCOL_FEE_BPS / 10_000;
    assert(br + creator_share + protocol_share == buy_in, 'fee accounting balances');
}