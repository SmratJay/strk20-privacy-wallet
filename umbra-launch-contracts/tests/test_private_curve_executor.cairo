use starknet::{ContractAddress, contract_address_const, get_contract_address};

use umbra_launch::interfaces::{
    IPrivateCurveExecutorDispatcher, IPrivateCurveExecutorDispatcherTrait, IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
    IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::objects::{curve_operation, OpenNoteDeposit};

use crate::test_utils::{
    deploy_executor, deploy_full_stack, mint_base, CurveStack,
};

const NOTE_ID: felt252 = 'open-note-0';

fn executor_disp(addr: ContractAddress) -> IPrivateCurveExecutorDispatcher {
    IPrivateCurveExecutorDispatcher { contract_address: addr }
}

fn base_disp(stack: CurveStack) -> IERC20Dispatcher {
    IERC20Dispatcher { contract_address: stack.base }
}

fn token_disp(stack: CurveStack) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: stack.token }
}

/// Acts as the privacy pool: withdraws `amount` of `token` to the executor, then invokes
/// `privacy_invoke`. Returns the deposit the pool would apply.
fn pool_withdraw_and_invoke(
    stack: CurveStack, operation: u8, token: ContractAddress, amount: u128,
) -> OpenNoteDeposit {
    // The pool "withdraws" the input to the executor before the invoke.
    if token == stack.base {
        mint_base(stack.base, stack.executor, amount.into());
    } else {
        let memecoin = token_disp(stack);
        // The pool holds the HAMSTR (from a prior private buy) and withdraws it to the executor.
        assert(memecoin.balance_of(get_contract_address()) >= amount.into(), 'pool has no tokens');
        assert(memecoin.transfer(stack.executor, amount.into()), 'pool withdraw failed');
    }

    let deposits = executor_disp(stack.executor).privacy_invoke(operation, token, amount, NOTE_ID);
    assert(deposits.len() == 1, 'expected exactly one deposit');
    *deposits.at(0)
}

#[test]
fn test_private_buy_path() {
    let stack = deploy_full_stack();
    let token = token_disp(stack);
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };

    let amount = 10_000_000_000_000_000_000_u128; // 10 base units
    let deposit = pool_withdraw_and_invoke(stack, curve_operation::BUY, stack.base, amount);

    // The deposit tells the pool to fill an open HAMSTR note with the buy output.
    assert(deposit.note_id == NOTE_ID, 'wrong note id');
    assert(deposit.token == stack.token, 'output should be the memecoin');
    assert(deposit.amount > 0, 'positive output');

    // The pool now pulls the output from the executor (the real pool does this).
    assert(
        token
            .transfer_from(stack.executor, get_contract_address(), deposit.amount.into()),
        'pool pull failed',
    );
    assert(
        token.balance_of(get_contract_address()) == deposit.amount.into(), 'open note filled',
    );

    // Market state moved exactly like a public buy of the same size.
    assert(curve.get_available_liquidity() == amount, 'base reserve moved');
    assert(token.balance_of(stack.executor) == 0, 'executor output drained');
}

#[test]
fn test_private_sell_path() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);
    let curve = IBondingCurveDispatcher { contract_address: stack.curve };
    // Set up: a public buy so the pool (test contract) holds HAMSTR.
    mint_base(stack.base, get_contract_address(), 100_000_000_000_000_000_000_u128.into());
    assert(base.approve(stack.curve, 100_000_000_000_000_000_000_u128.into()), 'approve');
    let tokens_bought = curve.buy(100_000_000_000_000_000_000_u128, get_contract_address());
    assert(token.transfer(get_contract_address(), tokens_bought.into()), 'pool gets tokens');

    let deposit = pool_withdraw_and_invoke(stack, curve_operation::SELL, stack.token, tokens_bought);

    // The deposit tells the pool to fill an open STRK note with the sell output.
    assert(deposit.note_id == NOTE_ID, 'wrong note id');
    assert(deposit.token == stack.base, 'output should be the base asset');
    assert(deposit.amount > 0, 'positive base out');

    // Pool pulls STRK from the executor and fills the note.
    assert(
        base_disp(stack)
            .transfer_from(stack.executor, get_contract_address(), deposit.amount.into()),
        'pool pull failed',
    );
    assert(
        base_disp(stack).balance_of(get_contract_address()) == deposit.amount.into(),
        'STRK note filled',
    );

    // Tokens burned: seller no longer holds them, supply reduced.
    assert(token.balance_of(stack.executor) == 0, 'executor drained');
    assert(token.balance_of(get_contract_address()) == 0, 'pool drained');
}

#[test]
#[should_panic(expected: ('UNAUTHORIZED_CALLER',))]
fn test_arbitrary_caller_rejected() {
    let stack = deploy_full_stack();
    // Deploy an executor bound to a DIFFERENT pool (not the test contract).
    let other_pool = contract_address_const::<'POOO'>();
    let rogue_executor_addr = deploy_executor(other_pool, stack.curve, stack.base, stack.token);
    mint_base(stack.base, rogue_executor_addr, 10_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(rogue_executor_addr)
        .privacy_invoke(curve_operation::BUY, stack.base, 10_000_000_000_000_000_000_u128, NOTE_ID);
}

#[test]
#[should_panic(expected: ('BUY_INPUT_NOT_BASE',))]
fn test_buy_with_wrong_input_token_rejected() {
    let stack = deploy_full_stack();
    // Request a BUY but pass the memecoin as the input — rejected before any transfer.
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.token, 1_000, NOTE_ID);
}

#[test]
#[should_panic(expected: ('SELL_INPUT_NOT_TOKEN',))]
fn test_sell_with_wrong_input_token_rejected() {
    let stack = deploy_full_stack();
    mint_base(stack.base, stack.executor, 10_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::SELL, stack.base, 10_000_000_000_000_000_000_u128, NOTE_ID);
}

#[test]
#[should_panic(expected: ('INVALID_OPERATION',))]
fn test_invalid_operation_rejected() {
    let stack = deploy_full_stack();
    mint_base(stack.base, stack.executor, 10_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(stack.executor)
        .privacy_invoke(7, stack.base, 10_000_000_000_000_000_000_u128, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_AMOUNT',))]
fn test_zero_amount_rejected() {
    let stack = deploy_full_stack();
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.base, 0, NOTE_ID);
}

#[test]
#[should_panic(expected: ('ZERO_NOTE_ID',))]
fn test_zero_note_id_rejected() {
    let stack = deploy_full_stack();
    mint_base(stack.base, stack.executor, 10_000_000_000_000_000_000_u128.into());
    let _ = executor_disp(stack.executor)
        .privacy_invoke(curve_operation::BUY, stack.base, 10_000_000_000_000_000_000_u128, 0);
}

#[test]
fn test_private_buy_equals_public_buy_price() {
    // Private execution must move the SAME curve state as a public buy — one market.
    let stack_a = deploy_full_stack();
    let stack_b = deploy_full_stack();
    let amount = 5_000_000_000_000_000_000_u128;

    // Private buy on stack_a.
    let _ = pool_withdraw_and_invoke(stack_a, curve_operation::BUY, stack_a.base, amount);
    let (ra_base, ra_token) = IBondingCurveDispatcher { contract_address: stack_a.curve }
        .get_real_reserves();

    // Public buy on stack_b.
    mint_base(stack_b.base, get_contract_address(), amount.into());
    assert(base_disp(stack_b).approve(stack_b.curve, amount.into()), 'approve');
    IBondingCurveDispatcher { contract_address: stack_b.curve }.buy(amount, get_contract_address());
    let (rb_base, rb_token) = IBondingCurveDispatcher { contract_address: stack_b.curve }
        .get_real_reserves();

    assert(ra_base == rb_base, 'base reserves differ');
    assert(ra_token == rb_token, 'token reserves differ');
}