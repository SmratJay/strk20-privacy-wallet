// PEL LP Vault & Insurance Integration Tests (Phase 24)
//
// Mirrors tests/integration/vaultConservation.test.ts (TypeScript) and
// crates/pel-risk-engine/src/golden_vectors.rs. These snforge tests drive the REAL
// Cairo contracts and assert the canonical economic model:
//   - Trader loss  -> LP receives the FULL loss (no 70/20/10 split on PnL)
//   - Trader profit-> LP pays the FULL profit; insolvent closes REVERT (no unbacked note)
//   - Protocol revenue (liquidation remnants) -> 70% LP / 20% insurance / 10% treasury
//   - Insurance holds REAL USDC (token balance backs insurance_balance)
//   - Withdrawal queue = Model A (shares burned + NAV reduced at request)
//   - Conservation: tokens + pool_assets == locked + pool_margin + NAV + payouts
//     + bounties + withdrawals + treasury + bad_debt
//
// The vault enforces a conservative single-position cap: margin * MAX_LEVERAGE <= 5% NAV
// (i.e. margin <= NAV / 1000). Tests use $10M NAV with $1,000 margins unless noted.

use starknet::{ContractAddress, get_contract_address, contract_address_const};
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_block_timestamp_global, start_cheat_caller_address_global,
};
use pel_perpetuals_core::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use pel_perpetuals_core::pel_liquidity_vault::{IPELLiquidityVaultDispatcher, IPELLiquidityVaultDispatcherTrait};
use pel_perpetuals_core::pel_insurance_reserve::{IPELInsuranceReserveDispatcher, IPELInsuranceReserveDispatcherTrait};

const TOKEN_MULT: u128 = 10_000;

#[derive(Drop)]
struct Env {
    usdc: IERC20Dispatcher,
    vault: IPELLiquidityVaultDispatcher,
    insurance: IPELInsuranceReserveDispatcher,
    vault_addr: ContractAddress,
    insurance_addr: ContractAddress,
}

fn token_units(cents: u128) -> u256 {
    (cents * TOKEN_MULT).into()
}

fn deploy() -> Env {
    let me: ContractAddress = get_contract_address();

    let usdc_class = declare("TestUSDC").unwrap().contract_class();
    let (usdc_contract, _) = usdc_class.deploy(@array![me.into()]).unwrap();
    let usdc = IERC20Dispatcher { contract_address: usdc_contract };

    // Insurance: real USDC custody reserve (target reserve $10k in cents).
    let ins_class = declare("PELInsuranceReserve").unwrap().contract_class();
    let (ins_contract, _) = ins_class
        .deploy(@array![me.into(), usdc_contract.into(), 1_000_000_u128.into()])
        .unwrap();
    let insurance = IPELInsuranceReserveDispatcher { contract_address: ins_contract };

    // Vault: admin = me, collateral = usdc, treasury = a constant.
    let treasury: ContractAddress = contract_address_const::<'TREASURY'>();
    let vault_class = declare("PELLiquidityVault").unwrap().contract_class();
    let (vault_contract, _) = vault_class
        .deploy(@array![me.into(), usdc_contract.into(), treasury.into()])
        .unwrap();
    let vault = IPELLiquidityVaultDispatcher { contract_address: vault_contract };

    // The test contract acts as PELPerpsCore for settlement authority.
    vault.set_pel_core_address(me);
    vault.set_insurance_reserve(ins_contract);
    // The vault is the insurance reserve's funding/absorb authority.
    insurance.set_authorized_caller(vault_contract, true);

    // Fund the test contract + approve the vault.
    usdc.mint(me, token_units(10_000_000_000_u128));
    usdc.approve(vault_contract, token_units(10_000_000_000_u128));

    Env { usdc, vault, insurance, vault_addr: vault_contract, insurance_addr: ins_contract }
}

fn assert_conserved(e: @Env) {
    let (token_balance, locked, lp_nav, payouts, bounties, withdrawals, treasury, is_solvent) =
        e.vault.get_solvency_snapshot();
    let tokens_cents = token_balance.low / TOKEN_MULT;
    let pool_assets = e.vault.get_pool_assets();
    let pool_margin = e.vault.get_pool_margin();
    let bad_debt = e.vault.get_bad_debt_total();

    let assets = tokens_cents + pool_assets;
    let liabilities = locked + pool_margin + lp_nav + payouts + bounties + withdrawals + treasury + bad_debt;
    assert(assets == liabilities, 'CONSERVATION_VIOLATION');
    assert(is_solvent, 'INSOLVENT');
}

#[test]
fn test_deposit_and_shares() {
    let e = deploy();
    let me = get_contract_address();
    let shares = e.vault.deposit_liquidity(1_000_000_u128); // $10,000
    assert(shares == 10_000_000_000_u128, 'SHARES_MISMATCH');
    assert(e.vault.get_lp_shares_balance(me) == shares, 'BALANCE_MISMATCH');
    assert(e.vault.get_share_price_e6() == 1_000_000_u128, 'PRICE_MISMATCH');
    assert_conserved(@e);
}

#[test]
fn test_second_lp_fair_pricing() {
    let e = deploy();
    e.vault.deposit_liquidity(1_000_000_u128);
    let shares2 = e.vault.deposit_liquidity(500_000_u128);
    assert(shares2 == 5_000_000_000_u128, 'SHARES2_MISMATCH');
    assert(e.vault.get_share_price_e6() == 1_000_000_u128, 'PRICE_MISMATCH');
    assert_conserved(@e);
}

#[test]
fn test_trader_profit_reduces_nav() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128); // $10M NAV
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128); // $1,000 margin
    let nav_before = e.vault.get_pool_nav();
    // payout 150,000 on 100,000 margin -> profit 50,000 -> LP pays full profit.
    e.vault.settle_trader_pnl(100_000_u128, 150_000_u128, 0xaa, me, false);
    assert(e.vault.get_pool_nav() == nav_before - 50_000_u128, 'NAV_MISMATCH');
    assert(e.vault.get_registered_note_amount(0xaa) == 150_000_u128, 'NOTE_MISMATCH');
    assert_conserved(@e);
}

#[test]
fn test_trader_loss_increases_nav() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let nav_before = e.vault.get_pool_nav();
    // payout 20,000 on 100,000 margin -> loss 80,000 -> FULL loss to LP.
    e.vault.settle_trader_pnl(100_000_u128, 20_000_u128, 0xcc, me, false);
    assert(e.vault.get_pool_nav() == nav_before + 80_000_u128, 'NAV_MISMATCH');
    assert_conserved(@e);
}

#[test]
fn test_funding() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let nav_before = e.vault.get_pool_nav();
    e.vault.settle_funding(10_000_u128, true, false);
    assert(e.vault.get_pool_nav() == nav_before + 10_000_u128, 'FUNDING_LP_GAIN');
    e.vault.settle_funding(10_000_u128, false, false);
    assert(e.vault.get_pool_nav() == nav_before, 'FUNDING_LP_PAYS');
    assert_conserved(@e);
}

#[test]
fn test_liquidation_waterfall() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let keeper: ContractAddress = contract_address_const::<'KEEPER'>();
    // seize 100,000, bounty 2,000, deficit 0 -> net 98,000 -> 70/20/10.
    e.vault.settle_liquidation(100_000_u128, 100_000_u128, 2_000_u128, keeper, 0_u128, false);
    assert(e.vault.get_keeper_bounty_balance(keeper) == 2_000_u128, 'BOUNTY_MISMATCH');
    assert(e.vault.get_treasury_balance() == 9_800_u128, 'TREASURY_MISMATCH');
    assert(e.insurance.get_insurance_balance() == 19_600_u128, 'INSURANCE_MISMATCH');
    assert_conserved(@e);
}

#[test]
fn test_insurance_funding_is_real() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    e.vault.settle_liquidation(100_000_u128, 100_000_u128, 2_000_u128, contract_address_const::<'KEEPER'>(), 0_u128, false);
    // Insurance physically holds the tokens it booked.
    let bal = e.usdc.balance_of(e.insurance_addr);
    assert(bal.low / TOKEN_MULT == 19_600_u128, 'INSURANCE_NOT_REAL');
    assert_conserved(@e);
}

#[test]
#[should_panic(expected: 'VAULT: INSUFFICIENT_NAV')]
fn test_insurance_exhaustion_reverts_close() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    // payout 1,100,000,000 -> profit ~1,099,900,000 > NAV + insurance -> REVERT.
    e.vault.settle_trader_pnl(100_000_u128, 1_100_000_000_u128, 0xbb, me, false);
}

#[test]
fn test_bad_debt_recorded() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    // seize 100,000, deficit 50,000 -> insurance (19,600 revenue) absorbs 19,600;
    // remaining 30,400 recorded as explicit bad debt.
    e.vault.settle_liquidation(100_000_u128, 100_000_u128, 2_000_u128, contract_address_const::<'KEEPER'>(), 50_000_u128, false);
    assert(e.vault.get_bad_debt_total() == 30_400_u128, 'BAD_DEBT_NOT_RECORDED');
    assert_conserved(@e);
}

#[test]
fn test_withdrawal_queue_model_a() {
    let e = deploy();
    e.vault.deposit_liquidity(1_000_000_u128);
    // Warp past the 1-hour cooldown.
    start_cheat_block_timestamp_global(4000);
    let nav_before = e.vault.get_pool_nav();
    let req_id = e.vault.request_withdrawal(5_000_000_000_u128); // half the pool
    assert(e.vault.get_pool_nav() == nav_before - 500_000_u128, 'NAV_NOT_REDUCED');
    assert(e.vault.get_pending_withdrawals_total() == 500_000_u128, 'QUEUE_NOT_RECORDED');
    e.vault.claim_withdrawal(req_id);
    assert(e.vault.get_pending_withdrawals_total() == 0_u128, 'QUEUE_NOT_CLEARED');
    assert_conserved(@e);
}

#[test]
#[should_panic(expected: 'VAULT: ALREADY_CLAIMED')]
fn test_double_withdrawal_rejected() {
    let e = deploy();
    e.vault.deposit_liquidity(1_000_000_u128);
    start_cheat_block_timestamp_global(4000);
    let req_id = e.vault.request_withdrawal(1_000_000_000_u128);
    e.vault.claim_withdrawal(req_id);
    e.vault.claim_withdrawal(req_id);
}

#[test]
#[should_panic(expected: 'VAULT: UNAUTHORIZED_CORE')]
fn test_unauthorized_settlement_rejected() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    // Impersonate a non-core caller.
    start_cheat_caller_address_global(contract_address_const::<'ATTACKER'>());
    e.vault.settle_trader_pnl(100_000_u128, 50_000_u128, 0xcc, me, false);
}

#[test]
#[should_panic(expected: 'VAULT: UTILIZATION_LIMIT')]
fn test_utilization_gate() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(100_000_000_u128); // $1M NAV
    // Lock ~85% via many small margins (each within the single-position cap).
    let mut i = 0_u128;
    while i < 850 {
        e.vault.lock_trader_margin(me, (i + 1).into(), 100_000_u128);
        i += 1;
    };
    // A further margin now exceeds the 85% utilization cap.
    e.vault.lock_trader_margin(me, 0xf00d, 100_000_u128);
}

#[test]
#[should_panic(expected: 'VAULT: SINGLE_POSITION_CAP')]
fn test_single_position_cap() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128); // $10,000 NAV
    // max single margin = 5% * 10,000 / 50 = 10 cents; 1,000,000 cents exceeds it.
    e.vault.lock_trader_margin(me, 0x1, 1_000_000_u128);
}

#[test]
fn test_conservation_invariant() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    e.vault.settle_trader_pnl(100_000_u128, 150_000_u128, 0xaa, me, false);
    e.vault.claim_payout_note(0xdead, 0xaa);
    e.vault.lock_trader_margin(me, 0x2, 100_000_u128);
    e.vault.settle_trader_pnl(100_000_u128, 20_000_u128, 0xbb, me, false);
    e.vault.lock_trader_margin(me, 0x3, 100_000_u128);
    e.vault.settle_liquidation(100_000_u128, 100_000_u128, 2_000_u128, contract_address_const::<'KEEPER'>(), 0_u128, false);
    assert_conserved(@e);
}
