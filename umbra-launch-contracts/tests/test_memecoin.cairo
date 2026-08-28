use starknet::{ContractAddress, contract_address_const, get_contract_address};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use umbra_launch::interfaces::{IMemecoinDispatcher, IMemecoinDispatcherTrait};

use crate::test_utils::{deploy_memecoin, SUPPLY};

fn memecoin(addr: ContractAddress) -> IMemecoinDispatcher {
    IMemecoinDispatcher { contract_address: addr }
}

#[test]
fn test_token_metadata_and_supply() {
    let me = get_contract_address();
    let token = deploy_memecoin(me, SUPPLY);

    assert(memecoin(token).name() == 'HAMSTR', 'bad name');
    assert(memecoin(token).symbol() == 'HSTR', 'bad symbol');
    assert(memecoin(token).decimals() == 18, 'bad decimals');
    assert(memecoin(token).total_supply() == SUPPLY, 'bad supply');
    assert(memecoin(token).balance_of(me) == SUPPLY, 'bad holder balance');
}

#[test]
fn test_transfer_and_balances() {
    let me = get_contract_address();
    let alice: ContractAddress = contract_address_const::<'ALICE'>();
    let token = deploy_memecoin(me, SUPPLY);

    let ok = memecoin(token).transfer(alice, 1000);
    assert(ok, 'transfer failed');
    assert(memecoin(token).balance_of(me) == SUPPLY - 1000, 'sender balance wrong');
    assert(memecoin(token).balance_of(alice) == 1000, 'recipient balance wrong');
}

#[test]
fn test_approve_and_allowance() {
    let me = get_contract_address();
    let alice: ContractAddress = contract_address_const::<'ALICE'>();
    let token = deploy_memecoin(me, SUPPLY);

    assert(memecoin(token).approve(alice, 500), 'approve failed');
    assert(memecoin(token).allowance(me, alice) == 500, 'allowance wrong');
}

#[test]
#[should_panic(expected: ('ERC20_INSUFFICIENT_BALANCE',))]
fn test_transfer_insufficient_balance_reverts() {
    let me = get_contract_address();
    let alice: ContractAddress = contract_address_const::<'ALICE'>();
    let token = deploy_memecoin(me, SUPPLY);

    let _ = memecoin(token).transfer(alice, SUPPLY + 1);
}

#[test]
fn test_burn_reduces_supply() {
    let me = get_contract_address();
    let token = deploy_memecoin(me, SUPPLY);

    memecoin(token).burn(10_000);
    assert(memecoin(token).total_supply() == SUPPLY - 10_000, 'supply not reduced');
    assert(memecoin(token).balance_of(me) == SUPPLY - 10_000, 'balance not reduced');
}

#[test]
#[should_panic(expected: ('ERC20_INSUFFICIENT_BALANCE',))]
fn test_burn_insufficient_reverts() {
    let me = get_contract_address();
    let token = deploy_memecoin(me, SUPPLY);
    memecoin(token).burn(SUPPLY + 1);
}

#[test]
fn test_zero_supply_reverts() {
    let me = get_contract_address();
    let class = declare("Memecoin").unwrap().contract_class();
    let result = class
        .deploy(@array!['HAMSTR'.into(), 'HSTR'.into(), 18_u8.into(), me.into(), 0_u128.into(), 0_u128.into()]);
    assert(result.is_err(), 'zero-supply deploy must fail');
}