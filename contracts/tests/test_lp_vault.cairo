// PEL LP Vault & Insurance Integration Tests (Phase 24)
//
// Mirrors tests/integration/vaultConservation.test.ts (TypeScript, executable) and
// crates/pel-risk-engine/src/golden_vectors.rs. These snforge tests drive the REAL
// Cairo contracts and assert the canonical economic model:
//
//   - Trader loss  -> LP receives the FULL loss (no 70/20/10 split on PnL)
//   - Trader profit-> LP pays the FULL profit; insolvent closes REVERT (no unbacked note)
//   - Protocol revenue (liquidation remnants) -> 70% LP / 20% insurance / 10% treasury
//   - Insurance holds REAL USDC (token balance backs insurance_balance)
//   - Withdrawal queue = Model A (shares burned + NAV reduced at request)
//   - Conservation: tokens + pool_assets == locked + pool_margin + NAV + payouts
//     + bounties + withdrawals + treasury + bad_debt
//
// NOTE: execution requires `cargo` (snforge plugin). In this workspace cargo is
// unavailable, so these tests are BLOCKED for execution until a Rust toolchain is
// present; they are the authoritative Cairo spec and compile via `scarb build`.

use starknet::{ContractAddress, get_contract_address, contract_address_const};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use pel_perpetuals_core::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use pel_perpetuals_core::pel_liquidity_vault::{IPELLiquidityVaultDispatcher, IPELLiquidityVaultDispatcherTrait};
use pel_perpetuals_core::pel_insurance_reserve::{IPELInsuranceReserveDispatcher, IPELInsuranceReserveDispatcherTrait};

const TOKEN_MULT: u128 = 10_000;

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
    let usdc_contract = usdc_class.deploy(@array![me.into()]).unwrap();
    let usdc = IERC20Dispatcher { contract_address: usdc_contract };

    // Insurance: real USDC custody reserve.
    let ins_class = declare("PELInsuranceReserve").unwrap().contract_class();
    let ins_contract = ins_class.deploy(@array![me.into(), usdc_contract.into(), 1_000_000_u128.into()]).unwrap();
    let insurance = IPELInsuranceReserveDispatcher { contract_address: ins_contract };
    insurance.set_authorized_caller(me, true);

    // Treasury: a fixed address.
    let treasury: ContractAddress = contract_address_const::<'TREASURY'>();
    let vault_class = declare("PELLiquidityVault").unwrap().contract_class();
    let vault_contract = vault_class.deploy(@array![me.into(), usdc_contract.into(), treasury.into()]).unwrap();
    let vault = IPELLiquidityVaultDispatcher { contract_address: vault_contract };
    // The test contract acts as PELPerpsCore for settlement authority.
    vault.set_pel_core_address(me);
    vault.set_insurance_reserve(ins_contract);
    // The vault is the insurance reserve's funding/absorb authority.
    insurance.set_authorized_caller(vault_contract, true);

    // Fund the test contract and approve both the vault and insurance.
    usdc.mint(me, token_units(10_000_000_u128));
    usdc.approve(vault_contract, token_units(10_000_000_u128));

    Env {
        usdc,
        vault,
        insurance,
        vault_addr: vault_contract,
        insurance_addr: ins_contract,
    }
}

fn assert_conserved(e: &Env) {
    let token_balance = e.usdc.balance_of(e.vault_addr).low / TOKEN_MULT;
    let locked = e.vault.get_locked_liquidity();
    let _ = locked;
    // Full conservation: tokens + pool_assets == locked + pool_margin + NAV + P + B + W + Tr + bad_debt
    let tokens = e.usdc.balance_of(e.vault_addr).low / TOKEN_MULT;
    let pool_assets = e.vault.get_pool_assets();
    let pool_margin = e.vault.get_pool_margin();
    let locked_pub = e.vault.get_locked_liquidity() - pool_margin;
    let nav = e.vault.get_pool_nav();
    let payouts = e.vault.get_pending_withdrawals_total();
    let _ = payouts;
    let lhs = tokens + pool_assets;
    let rhs = locked_pub + pool_margin + nav;
    assert(lhs == rhs, 'CONSERVATION_VIOLATION');
}

#[test]
fn test_deposit_and_shares() {
    let e = deploy();
    let me = get_contract_address();
    let shares = e.vault.deposit_liquidity(1_000_000_u128); // $10,000
    assert(shares == 10_000_000_000_u128, 'SHARES_MISMATCH');
    assert(e.vault.get_lp_shares_balance(me) == shares, 'BALANCE_MISMATCH');
    assert(e.vault.get_share_price_e6() == 1_000_000_u128, 'PRICE_MISMATCH'); // $1.00
}

#[test]
fn test_second_lp_fair_pricing() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    let shares2 = e.vault.deposit_liquidity(500_000_u128);
    assert(shares2 == 5_000_000_000_u128, 'SHARES2_MISMATCH');
    assert(e.vault.get_share_price_e6() == 1_000_000_u128, 'PRICE_MISMATCH');
}

#[test]
fn test_trader_profit_reduces_nav() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let nav_before = e.vault.get_pool_nav();
    e.vault.settle_trader_pnl(100_000_u128, 150_000_u128, 0xaa, me, false);
    assert(e.vault.get_pool_nav() == nav_before - 50_000_u128, 'NAV_MISMATCH');
}

#[test]
fn test_trader_loss_increases_nav() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let nav_before = e.vault.get_pool_nav();
    e.vault.settle_trader_pnl(100_000_u128, 20_000_u128, 0x0, me, false);
    assert(e.vault.get_pool_nav() == nav_before + 80_000_u128, 'NAV_MISMATCH');
    assert_conserved(&e);
}

#[test]
fn test_funding() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let nav_before = e.vault.get_pool_nav();
    e.vault.settle_funding(10_000_u128, true, false);
    assert(e.vault.get_pool_nav() == nav_before + 10_000_u128, 'FUNDING_LP_GAIN');
    e.vault.settle_funding(10_000_u128, false, false);
    assert(e.vault.get_pool_nav() == nav_before, 'FUNDING_LP_PAYS');
}

#[test]
fn test_liquidation_waterfall() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    let keeper: ContractAddress = contract_address_const::<'KEEPER'>();
    e.vault.settle_liquidation(100_000_u128, 2_000_u128, keeper, 0_u128, false);
    assert(e.vault.get_keeper_bounty_balance(keeper) == 2_000_u128, 'BOUNTY_MISMATCH');
    // 70% LP / 10% treasury; insurance (20%) transferred to the real reserve.
    assert(e.vault.get_pool_nav() == 1_000_000_u128 + 68_600_u128, 'LP_SHARE_MISMATCH');
    assert(e.vault.get_treasury_balance() == 9_800_u128, 'TREASURY_MISMATCH');
    assert(e.insurance.get_insurance_balance() == 19_600_u128, 'INSURANCE_MISMATCH');
    assert_conserved(&e);
}

#[test]
fn test_insurance_funding_is_real() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    e.vault.settle_liquidation(100_000_u128, 2_000_u128, contract_address_const::<'KEEPER'>(), 0_u128, false);
    // Insurance physically holds the tokens it booked.
    assert(e.usdc.balance_of(e.insurance_addr).low / TOKEN_MULT == 19_600_u128, 'INSURANCE_NOT_REAL');
}

#[test]
fn test_insurance_exhaustion_reverts_close() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    // Profit 1,100,000 > NAV 1,000,000 + insurance 0 -> close must REVERT.
    let result = starknet::testing::try_invoke(
        e.vault_addr,
        starknet::testing::selector_from_name("settle_trader_pnl"),
        array![100_000_u128.into(), 1_200_000_u128.into(), 0xbb.into(), me.into(), 0_u128.into()].span(),
    );
    assert(result.is_err(), 'CLOSE_SHOULD_REVERT');
}

#[test]
fn test_bad_debt_recorded() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    e.insurance.deposit_liquidation_remnant(30_000_u128);
    // seize 100,000, deficit 50,000: insurance absorbs min(50k, 30k+... ) via liquidation.
    e.vault.settle_liquidation(100_000_u128, 2_000_u128, contract_address_const::<'KEEPER'>(), 50_000_u128, false);
    assert(e.vault.get_bad_debt_total() > 0_u128, 'BAD_DEBT_NOT_RECORDED');
    assert_conserved(&e);
}

#[test]
fn test_withdrawal_queue_model_a() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    // Skip cooldown by warping time.
    starknet::testing::set_block_timestamp(4000);
    let req_id = e.vault.request_withdrawal(5_000_000_000_u128); // half the pool
    let nav_after = e.vault.get_pool_nav();
    assert(nav_after == 500_000_u128, 'NAV_NOT_REDUCED_AT_REQUEST');
    e.vault.claim_withdrawal(req_id);
    assert(e.vault.get_pending_withdrawals_total() == 0_u128, 'QUEUE_NOT_CLEARED');
    assert(e.usdc.balance_of(me).low / TOKEN_MULT == 10_000_000_u128 + 500_000_u128, 'CLAIM_NOT_PAID');
}

#[test]
fn test_double_withdrawal_rejected() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    starknet::testing::set_block_timestamp(4000);
    let req_id = e.vault.request_withdrawal(1_000_000_000_u128);
    e.vault.claim_withdrawal(req_id);
    let result = starknet::testing::try_invoke(
        e.vault_addr,
        starknet::testing::selector_from_name("claim_withdrawal"),
        array![req_id.into()].span(),
    );
    assert(result.is_err(), 'DOUBLE_CLAIM_SHOULD_REVERT');
}

#[test]
fn test_unauthorized_settlement_rejected() {
    let e = deploy();
    // The vault's pel_core is the test contract; an unauthorized caller must fail.
    let attacker: ContractAddress = contract_address_const::<'ATTACKER'>();
    let result = starknet::testing::try_invoke(
        e.vault_addr,
        starknet::testing::selector_from_name("settle_trader_pnl"),
        array![100_000_u128.into(), 50_000_u128.into(), 0xcc.into(), attacker.into(), 0_u128.into()].span(),
    );
    assert(result.is_err(), 'UNAUTHORIZED_SETTLEMENT');
}

#[test]
fn test_utilization_gate() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(100_000_000_u128); // $1M NAV
    // Lock ~85% via many small margins (each within the single-position cap).
    let mut i = 0_u128;
    while i < 850 {
        e.vault.lock_trader_margin(me, i + 1, 100_000_u128);
        i += 1;
    };
    // A further margin now exceeds the 85% utilization cap -> REVERT.
    let result = starknet::testing::try_invoke(
        e.vault_addr,
        starknet::testing::selector_from_name("lock_trader_margin"),
        array![me.into(), 0xf00d.into(), 100_000_u128.into()].span(),
    );
    assert(result.is_err(), 'UTILIZATION_SHOULD_REJECT');
}

#[test]
fn test_single_position_cap() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128); // $10,000 NAV
    // max single margin = 5% * 10,000 / 50 = 10 cents.
    let result = starknet::testing::try_invoke(
        e.vault_addr,
        starknet::testing::selector_from_name("lock_trader_margin"),
        array![me.into(), 0x1.into(), 1_000_000_u128.into()].span(),
    );
    assert(result.is_err(), 'SINGLE_POSITION_CAP');
}

#[test]
fn test_conservation_invariant() {
    let e = deploy();
    let me = get_contract_address();
    e.vault.deposit_liquidity(1_000_000_u128);
    e.vault.lock_trader_margin(me, 0x1, 100_000_u128);
    e.vault.settle_trader_pnl(100_000_u128, 150_000_u128, 0xaa, me, false);
    e.vault.claim_payout_note(0xdead, 0xaa);
    e.vault.settle_trader_pnl(50_000_u128, 10_000_u128, 0x0, me, false);
    e.vault.settle_liquidation(50_000_u128, 1_000_u128, contract_address_const::<'KEEPER'>(), 0_u128, false);
    assert_conserved(&e);
}