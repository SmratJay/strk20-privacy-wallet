// Conservation tests for STRK20Adapter accounting (PHASE 2).
//
// Global financial conservation invariant (cents):
//   token_balance_in_cents == total_locked_collateral + lp_pool_nav
//     + insurance_fund_balance + unclaimed_payouts_total + unclaimed_bounties_total
//
// token_balance_in_cents = IERC20.balance_of(this) / TOKEN_DECIMAL_MULTIPLIER (10000).

use starknet::{ContractAddress, get_contract_address, contract_address_const};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use pel_perpetuals_core::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use pel_perpetuals_core::strk20_adapter::{ISTRK20AdapterDispatcher, ISTRK20AdapterDispatcherTrait};

const M: u128 = 1_000_000; // 1,000,000 cents margin = $10,000

fn deploy() -> (IERC20Dispatcher, ISTRK20AdapterDispatcher, ContractAddress) {
    let me: ContractAddress = get_contract_address();

    let usdc_class = declare("TestUSDC").unwrap().contract_class();
    let (usdc_contract, _) = usdc_class.deploy(@array![me.into()]).unwrap();
    let usdc = IERC20Dispatcher { contract_address: usdc_contract };

    let adapter_class = declare("STRK20Adapter").unwrap().contract_class();
    // admin = me, pel_core = me (so this test contract can act as PELCore)
    let (adapter_contract, _) = adapter_class
        .deploy(@array![me.into(), me.into(), usdc_contract.into()])
        .unwrap();
    let adapter = ISTRK20AdapterDispatcher { contract_address: adapter_contract };

    // fund the test contract + approve the adapter for 3*M cents in token units
    let token_units: u256 = (3_u128 * M * 10000_u128).into();
    usdc.mint(me, token_units);
    usdc.approve(adapter_contract, token_units);

    (usdc, adapter, adapter_contract)
}

fn token_balance_cents(usdc: IERC20Dispatcher, adapter: ContractAddress) -> u128 {
    let bal = usdc.balance_of(adapter);
    (bal.low / 10000_u128)
}

fn assert_conserved(usdc: IERC20Dispatcher, adapter: ISTRK20AdapterDispatcher, adapter_addr: ContractAddress) {
    let bal = token_balance_cents(usdc, adapter_addr);
    let locked = adapter.get_total_locked_collateral();
    let lp = adapter.get_lp_pool_nav();
    let ins = adapter.get_insurance_fund_balance();
    let (snapshot_balance, s_locked, s_lp, s_ins, s_unclaimed_p, s_unclaimed_b, is_solvent) =
        adapter.get_solvency_snapshot();
    let liabilities = locked + lp + ins + s_unclaimed_p + s_unclaimed_b;
    assert(bal == liabilities, 'CONSERVATION_VIOLATION');
    assert(snapshot_balance.low / 10000_u128 == bal, 'BALANCE_MISMATCH');
    assert(s_locked == locked && s_lp == lp && s_ins == ins, 'SNAPSHOT_MISMATCH');
    assert(is_solvent, 'INSOLVENT');
}

#[test]
fn test_lock_margin_conservation() {
    let (usdc, adapter, adapter_addr) = deploy();
    let me = get_contract_address();
    adapter.lock_shielded_margin(me, 0x1, M);
    assert(adapter.get_total_locked_collateral() == M, 'LOCKED_MISMATCH');
    assert_conserved(usdc, adapter, adapter_addr);
}

#[test]
fn test_loss_collection_to_lp() {
    let (usdc, adapter, adapter_addr) = deploy();
    let me = get_contract_address();
    adapter.lock_shielded_margin(me, 0x1, M);
    // trader loses 400k -> LP NAV
    adapter.collect_insurance_contribution(0x1, 400_000);
    assert(adapter.get_total_locked_collateral() == 600_000, 'LOCKED_MISMATCH');
    assert(adapter.get_lp_pool_nav() == 400_000, 'LP_NAV_MISMATCH');
    assert_conserved(usdc, adapter, adapter_addr);
}

#[test]
fn test_loss_payout_and_lp_credit() {
    // losing close: payout P < margin M; LP must receive M - P.
    let (usdc, adapter, adapter_addr) = deploy();
    let me = get_contract_address();
    adapter.lock_shielded_margin(me, 0x1, M);
    // payout 200k (loss of 800k), no profit
    adapter.release_shielded_payout(0xaa, me, 200_000, 0);
    // core routes residual loss to LP
    adapter.collect_insurance_contribution(0x1, 800_000);
    assert(adapter.get_total_locked_collateral() == 0, 'LOCKED_MISMATCH');
    assert(adapter.get_lp_pool_nav() == 800_000, 'LP_NAV_MISMATCH');
    assert(adapter.get_registered_note_amount(0xaa) == 200_000, 'NOTE_MISMATCH');
    assert_conserved(usdc, adapter, adapter_addr);
}

#[test]
fn test_profit_payout_drains_lp() {
    // profitable close: payout P > margin M; profit = P - M funded from LP NAV.
    let (usdc, adapter, adapter_addr) = deploy();
    let me = get_contract_address();
    // LP deposits 500k via liquidity
    adapter.deposit_liquidity(500_000);
    adapter.lock_shielded_margin(me, 0x1, M);
    // payout 1.2M, profit 200k
    adapter.release_shielded_payout(0xbb, me, 1_200_000, 200_000);
    assert(adapter.get_total_locked_collateral() == 0, 'LOCKED_MISMATCH');
    assert(adapter.get_lp_pool_nav() == 300_000, 'LP_NAV_MISMATCH'); // 500k - 200k profit
    assert(adapter.get_registered_note_amount(0xbb) == 1_200_000, 'NOTE_MISMATCH');
    assert_conserved(usdc, adapter, adapter_addr);
}

#[test]
fn test_liquidation_seize() {
    // liquidation: 2% keeper bounty + 98% insurance; full margin seized.
    let (usdc, adapter, adapter_addr) = deploy();
    let me = get_contract_address();
    adapter.lock_shielded_margin(me, 0x1, M);
    let keeper: ContractAddress = contract_address_const::<'KEEPER'>();
    adapter.seize_liquidation_collateral(0x1, keeper, 20_000, 980_000);
    assert(adapter.get_total_locked_collateral() == 0, 'LOCKED_MISMATCH');
    assert(adapter.get_insurance_fund_balance() == 980_000, 'INSURANCE_MISMATCH');
    assert(adapter.get_keeper_bounty_balance(keeper) == 20_000, 'BOUNTY_MISMATCH');
    assert_conserved(usdc, adapter, adapter_addr);
}
