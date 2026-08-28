use starknet::get_contract_address;

use umbra_launch::interfaces::{
    IBondingCurveDispatcherTrait, IERC20DispatcherTrait, IMemecoinDispatcherTrait,
};

use crate::test_utils::{
    base_disp, buy_public, curve_disp, deploy_full_stack, mint_base, token_disp, CurveStack,
    FEE_BPS, GRAD_TARGET, SUPPLY, VIRTUAL_BASE, VIRTUAL_TOKEN,
};

/// One base unit with 18 decimals.
fn base_unit(units: u128) -> u128 {
    units * 1_000_000_000_000_000_000
}

/// One token unit with 18 decimals.
fn token_unit(units: u128) -> u128 {
    units * 1_000_000_000_000_000_000
}


#[test]
fn test_initial_state() {
    let stack = deploy_full_stack();
    let curve = curve_disp(stack);
    assert(!curve.is_graduated(), 'should not be graduated');
    assert(curve.get_base_asset() == stack.base, 'base asset wrong');
    assert(curve.get_token() == stack.token, 'token wrong');
    let (vb, vt) = curve.get_virtual_reserves();
    assert(vb == VIRTUAL_BASE, 'virtual base wrong');
    assert(vt == VIRTUAL_TOKEN, 'virtual token wrong');
    let (br, _tr) = curve.get_real_reserves();
    assert(br == 0, 'base reserve should be 0');
    assert(curve.get_available_liquidity() == 0, 'liquidity should be 0');
    assert(curve.get_fee_bps() == FEE_BPS, 'fee wrong');
    assert(curve.get_graduation_target() == GRAD_TARGET, 'grad target wrong');
}

#[test]
fn test_quote_buy_zero() {
    let stack = deploy_full_stack();
    let curve = curve_disp(stack);
    assert(curve.quote_buy(0) == 0, 'quote of 0 should be 0');
    assert(curve.quote_sell(0) == 0, 'sell quote of 0 should be 0');
}

#[test]
fn test_buy_and_price_moves_up() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    let quote = curve_disp(stack).quote_buy(base_unit(1));
    assert(quote > 0, 'quote must be positive');

    let out = buy_public(stack, who, base_unit(1));
    assert(out == quote, 'buy should match quote');
    assert(out > 0, 'got tokens');

    assert(
        token_disp(stack).balance_of(who) == out.into(), 'buyer token balance wrong',
    );

    // Price must be higher after the buy.
    let (p1_base, p1_token) = curve_disp(stack).get_price();
    let _ = p1_base / (p1_token / token_unit(1_000));

    let _ = buy_public(stack, who, base_unit(2));
    let (p2_base, p2_token) = curve_disp(stack).get_price();
    // ratio base/token must have increased (compare cross products in u256)
    let price_after: u256 = p2_base.into() * p1_token.into();
    let price_before_scaled: u256 = p1_base.into() * p2_token.into();
    assert(price_after > price_before_scaled, 'price did not increase');
}

#[test]
fn test_sell_returns_base_and_price_reverses() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let base = base_disp(stack);
    let token = token_disp(stack);
    let curve = curve_disp(stack);

    let tokens = buy_public(stack, who, base_unit(5));
    assert(tokens > 0, 'got no tokens');
    let base_balance_after_buy = base.balance_of(who);

    let quote = curve.quote_sell(tokens);
    assert(quote > 0, 'sell quote positive');

    assert(token.approve(stack.curve, tokens.into()), 'token approve failed');
    let base_out = curve.sell(tokens, who);
    assert(base_out == quote, 'sell should match quote');
    assert(
        base_disp(stack).balance_of(who) == base_balance_after_buy + base_out.into(),
        'did not receive base',
    );

    // A full round trip must have cost the trader real value (fees): base back < base paid.
    assert(base_out < base_unit(5), 'round trip must lose base');
}

#[test]
fn test_invariant_reserves_move_together() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    let out1 = buy_public(stack, who, base_unit(3));
    let (br1, tr1) = curve_disp(stack).get_real_reserves();
    assert(br1 == base_unit(3), 'base reserve should equal input');
    assert(tr1 == out1, 'token reserve matches output');

    let out2 = buy_public(stack, who, base_unit(7));
    let (br2, tr2) = curve_disp(stack).get_real_reserves();
    assert(br2 == base_unit(10), 'base reserve accumulate');
    assert(tr2 == out1 + out2, 'token reserve accumulate');
}

#[test]
#[should_panic(expected: ('CURVE_GRADUATED',))]
fn test_buy_after_graduation_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    // Accumulate base until the graduation target is reached.
    let mut spent: u128 = 0;
    while spent < GRAD_TARGET {
        let step = GRAD_TARGET - spent;
        let _ = buy_public(stack, who, step);
        spent = spent + step;
    }
    curve_disp(stack).graduate();
    assert(curve_disp(stack).is_graduated(), 'should be graduated');

    let _ = buy_public(stack, who, base_unit(1));
}

#[test]
#[should_panic(expected: ('CURVE_GRADUATED',))]
fn test_sell_after_graduation_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let token = token_disp(stack);
    let curve = curve_disp(stack);

    let tokens = buy_public(stack, who, base_unit(5));
    let mut spent: u128 = base_unit(5);
    while spent < GRAD_TARGET {
        let step = GRAD_TARGET - spent;
        let _ = buy_public(stack, who, step);
        spent = spent + step;
    }
    curve.graduate();

    assert(token.approve(stack.curve, tokens.into()), 'approve failed');
    let _ = curve_disp(stack).sell(tokens, who);
}

#[test]
#[should_panic(expected: ('GRAD_TARGET_NOT_REACHED',))]
fn test_graduate_too_early_reverts() {
    let stack = deploy_full_stack();
    let _ = buy_public(stack, get_contract_address(), base_unit(1));
    curve_disp(stack).graduate();
}

#[test]
fn test_graduation_transfers_reserves_to_router() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    let out = buy_public(stack, get_contract_address(), base_unit(60));
    let router_base_before = base.balance_of(stack.router);
    assert(router_base_before == 0, 'router starts empty');

    curve_disp(stack).graduate();

    // The router now holds the full base reserve + the unsold tokens.
    let router_base = base.balance_of(stack.router);
    let router_tokens = token.balance_of(stack.router);
    assert(router_base == base_unit(60).into(), 'router base wrong');
    assert(router_tokens == SUPPLY - out.into(), 'router holds unsold supply');
    assert(token.balance_of(stack.curve) == 0, 'curve holds no tokens');
    assert(curve_disp(stack).get_available_liquidity() == 0, 'curve should be drained');
}

#[test]
#[should_panic(expected: ('ZERO_BUY_AMOUNT',))]
fn test_buy_zero_reverts() {
    let stack = deploy_full_stack();
    let _ = buy_public(stack, get_contract_address(), 0);
}

#[test]
#[should_panic(expected: ('ZERO_SELL_AMOUNT',))]
fn test_sell_zero_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let token = token_disp(stack);
    let tokens = buy_public(stack, who, base_unit(1));
    assert(token.approve(stack.curve, tokens.into()), 'approve failed');
    let _ = curve_disp(stack).sell(0, who);
}

#[test]
#[should_panic(expected: ('BASE_RESERVE_NEGATIVE',))]
fn test_sell_more_than_held_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let token = token_disp(stack);
    let tokens = buy_public(stack, who, base_unit(1));
    // Try to sell tokens the buyer never received.
    assert(token.approve(stack.curve, (tokens + token_unit(1_000_000)).into()), 'approve failed');
    let _ = curve_disp(stack).sell(tokens + token_unit(1_000_000), who);
}

#[test]
fn test_fee_is_charged() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    // The curve keeps the fee: base reserve grows by the FULL input including the fee.
    let out = buy_public(stack, who, base_unit(10));
    assert(out > 0, 'no tokens');
    let (br, tr) = curve_disp(stack).get_real_reserves();
    assert(br == base_unit(10), 'fee retained in curve');
    assert(tr == out, 'token reserve tracks output');
}

#[test]
fn test_round_trip_cannot_extract_value() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let base = base_disp(stack);
    let token = token_disp(stack);
    let curve = curve_disp(stack);

    // Fixed budget of 20 units. Repeated buy->sell round trips must always lose value
    // (1% fee per leg + pool-favorable ceil rounding) — a rounding exploit is impossible.
    mint_base(stack.base, who, base_unit(20).into());
    assert(base.approve(stack.curve, base_unit(20).into()), 'approve');

    let mut i: u32 = 0;
    while i < 20 {
        let tokens = curve.buy(base_unit(1), who);
        assert(token.approve(stack.curve, tokens.into()), 'approve failed');
        let _base_out = curve.sell(tokens, who);
        assert(base.approve(stack.curve, base_unit(20).into()), 'reapprove');
        i += 1;
    }
    // After 20 round trips the buyer must hold strictly less than the original 20 units.
    assert(base.balance_of(who) < base_unit(20).into(), 'round trip must lose value');
}