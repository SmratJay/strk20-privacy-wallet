use starknet::{contract_address_const, get_contract_address};

use umbra_launch::interfaces::{
    IBondingCurveDispatcherTrait, IERC20DispatcherTrait, IMemecoinDispatcherTrait,
};

use crate::test_utils::{
    base_disp, buy_public, creator, curve_disp, deploy_full_stack, deploy_stack_with_deployer, mint_base, token_disp, CurveStack,
    CREATOR_FEE_BPS, FEE_BPS, GRAD_TARGET, MAX_TRADE_BPS, PROTOCOL_FEE_BPS, SUPPLY, treasury,
    VIRTUAL_BASE, VIRTUAL_TOKEN,
};

/// One base unit with 18 decimals.
fn base_unit(units: u128) -> u128 {
    units * 1_000_000_000_000_000_000
}

/// One token unit with 18 decimals.
fn token_unit(units: u128) -> u128 {
    units * 1_000_000_000_000_000_000
}

/// Maximum single-buy token output enforced by the default max_trade_bps.
fn max_trade_cap() -> u128 {
    VIRTUAL_TOKEN * MAX_TRADE_BPS / 10_000
}

/// Accumulate buys in cap-compliant 0.5-STRK steps until the curve graduates.
fn accumulate_to_graduation(stack: CurveStack) {
    let mut guard: u32 = 0;
    while !curve_disp(stack).is_graduated() && guard < 500 {
        let _ = buy_public(stack, get_contract_address(), 3_000_000_000_000_000_000_u128);
        guard += 1;
    }
}

#[test]
fn test_initial_state() {
    let stack = deploy_full_stack();
    let curve = curve_disp(stack);
    assert(!curve.is_graduated(), 'should not be graduated');
    assert(curve.get_base_asset() == stack.base, 'base asset wrong');
    assert(curve.get_token() == stack.token, 'token wrong');
    assert(curve.get_deployer() == creator(), 'deployer wrong');
    assert(curve.get_protocol_treasury() == treasury(), 'treasury wrong');
    let (vb, vt) = curve.get_virtual_reserves();
    assert(vb == VIRTUAL_BASE, 'virtual base wrong');
    assert(vt == VIRTUAL_TOKEN, 'virtual token wrong');
    let (br, _tr) = curve.get_real_reserves();
    assert(br == 0, 'base reserve should be 0');
    assert(curve.get_available_liquidity() == 0, 'liquidity should be 0');
    assert(curve.get_fee_bps() == FEE_BPS, 'fee wrong');
    assert(curve.get_creator_fee_bps() == CREATOR_FEE_BPS, 'creator fee wrong');
    assert(curve.get_protocol_fee_bps() == PROTOCOL_FEE_BPS, 'protocol fee wrong');
    assert(curve.get_max_trade_bps() == MAX_TRADE_BPS, 'max trade wrong');
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

    let _ = buy_public(stack, who, base_unit(1));
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

    let tokens = buy_public(stack, who, base_unit(2));
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
    assert(base_out < base_unit(2), 'round trip must lose base');
}

#[test]
fn test_invariant_reserves_move_together() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    let out1 = buy_public(stack, who, base_unit(1));
    let (br1, tr1) = curve_disp(stack).get_real_reserves();
    // Fee split: reserve counts the NET base (1% total, 0.5% to creator+protocol).
    assert(br1 == base_unit(1) - base_unit(1) * (CREATOR_FEE_BPS + PROTOCOL_FEE_BPS) / 10_000, 'reserve = net input');
    assert(tr1 == out1, 'token reserve matches output');

    let out2 = buy_public(stack, who, base_unit(1));
    let (br2, tr2) = curve_disp(stack).get_real_reserves();
    assert(br2 == br1 + base_unit(1) - base_unit(1) * (CREATOR_FEE_BPS + PROTOCOL_FEE_BPS) / 10_000, 'base reserve accumulate');
    assert(tr2 == out1 + out2, 'token reserve accumulate');
}

#[test]
#[should_panic(expected: ('CURVE_GRADUATED',))]
fn test_buy_after_graduation_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();

    accumulate_to_graduation(stack);
    assert(curve_disp(stack).is_graduated(), 'should be graduated');

    let _ = buy_public(stack, who, base_unit(1));
}

#[test]
#[should_panic(expected: ('CURVE_GRADUATED',))]
fn test_sell_after_graduation_reverts() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let token = token_disp(stack);

    let tokens = buy_public(stack, who, base_unit(2));
    accumulate_to_graduation(stack);

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
fn test_auto_graduation_on_target() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    accumulate_to_graduation(stack);

    assert(curve_disp(stack).is_graduated(), 'auto-graduated');
    // Reserves moved to the router: base >= target, curve drained.
    assert(curve_disp(stack).get_available_liquidity() == 0, 'curve drained');
    assert(base.balance_of(stack.router) >= GRAD_TARGET.into(), 'router holds >= target base');
    assert(token.balance_of(stack.router) > 0, 'router holds unsold tokens');
    assert(token.balance_of(stack.curve) == 0, 'curve holds no tokens');
}

#[test]
fn test_graduation_does_not_duplicate_or_strand_funds() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let token = token_disp(stack);

    accumulate_to_graduation(stack);

    // Everything is either in the router (base + unsold tokens) or in traders' hands.
    let router_base = base.balance_of(stack.router);
    let curve_base = base.balance_of(stack.curve);
    let router_tokens = token.balance_of(stack.router);
    let curve_tokens = token.balance_of(stack.curve);
    assert(curve_base == 0, 'no base stranded in curve');
    assert(curve_tokens == 0, 'no tokens stranded in curve');
    assert(router_base >= GRAD_TARGET.into(), 'router base moved');
    // Curve physical tokens == supply - circulating, all moved to router.
    assert(router_tokens == token.total_supply() - token_disp(stack).balance_of(get_contract_address()), 'tokens accounted');
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
fn test_fee_split_creator_protocol_and_retained() {
    let stack = deploy_full_stack();
    let base = base_disp(stack);
    let who = get_contract_address();

    let out = buy_public(stack, who, base_unit(1));
    assert(out > 0, 'no tokens');

    let expected_creator = base_unit(1) * CREATOR_FEE_BPS / 10_000;
    let expected_protocol = base_unit(1) * PROTOCOL_FEE_BPS / 10_000;
    // Creator (deployer = test contract) and treasury each received their share in STRK.
    assert(base.balance_of(creator()) == expected_creator.into(), 'creator fee in STRK');
    assert(base.balance_of(treasury()) == expected_protocol.into(), 'protocol fee in STRK');

    // The reserve counts the net base: everything that actually stayed in the pool.
    let (br, tr) = curve_disp(stack).get_real_reserves();
    assert(br == base_unit(1) - expected_creator - expected_protocol, 'reserve counts net');
    assert(tr == out, 'token reserve tracks output');
}

#[test]
#[should_panic(expected: ('MAX_TRADE_EXCEEDED',))]
fn test_max_trade_cap_reverts() {
    let stack = deploy_full_stack();
    let _ = buy_public(stack, get_contract_address(), base_unit(5));
}

#[test]
#[should_panic(expected: ('MAX_TRADE_EXCEEDED',))]
fn test_quote_buy_reverts_on_oversized_order() {
    let stack = deploy_full_stack();
    let _ = curve_disp(stack).quote_buy(base_unit(5));
}

#[test]
fn test_max_trade_cap_never_exceeded_in_compliant_buys() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let cap = max_trade_cap();
    let mut out: u128 = 0;
    let mut guard: u32 = 0;
    while guard < 5 {
        let o = buy_public(stack, who, base_unit(1));
        assert(o <= cap, 'buy within cap');
        out = out + o;
        guard += 1;
    }
    assert(out > 0, 'accumulated tokens');
}

#[test]
fn test_set_graduation_recipient_before_liquidity_ok() {
    let stack = deploy_stack_with_deployer(get_contract_address());
    let other = contract_address_const::<'OTHR'>();
    curve_disp(stack).set_graduation_recipient(other);
    let (br, _tr) = curve_disp(stack).get_real_reserves();
    assert(br == 0, 'still no liquidity');
}

#[test]
#[should_panic(expected: ('LIQUIDITY_LOCKED',))]
fn test_graduation_recipient_locked_after_liquidity() {
    let stack = deploy_stack_with_deployer(get_contract_address());
    let _ = buy_public(stack, get_contract_address(), base_unit(1));
    let other = contract_address_const::<'OTHR'>();
    curve_disp(stack).set_graduation_recipient(other);
}

#[test]
fn test_round_trip_cannot_extract_value() {
    let stack = deploy_full_stack();
    let who = get_contract_address();
    let base = base_disp(stack);
    let token = token_disp(stack);
    let curve = curve_disp(stack);

    // Fixed budget. Repeated buy->sell round trips must always lose value (1% fee per leg
    // + pool-favorable ceil rounding) — a rounding exploit is impossible.
    let budget = base_unit(5);
    mint_base(stack.base, who, budget.into());
    assert(base.approve(stack.curve, budget.into()), 'approve');

    let mut i: u32 = 0;
    while i < 5 {
        let tokens = curve.buy(base_unit(1), who);
        assert(token.approve(stack.curve, tokens.into()), 'approve failed');
        let _base_out = curve.sell(tokens, who);
        assert(base.approve(stack.curve, budget.into()), 'reapprove');
        i += 1;
    }
    // After 5 round trips the buyer must hold strictly less than the original budget.
    assert(base.balance_of(who) < budget.into(), 'round trip must lose value');
}