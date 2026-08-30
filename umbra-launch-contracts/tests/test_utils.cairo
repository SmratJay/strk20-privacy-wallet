//! Shared test helpers for UMBRA LAUNCH V2 snforge tests.

use starknet::{ContractAddress, contract_address_const, get_contract_address};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use umbra_launch::interfaces::{
    IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher,
    IERC20DispatcherTrait, IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::interfaces::ITokenFactoryDispatcher;
use umbra_launch::test_base_asset::{
    ITestBaseAssetDispatcher, ITestBaseAssetDispatcherTrait,
};

// V2 curve parameters (locked via scripts/launch_sim.mjs):
pub const VIRTUAL_BASE: u128 = 30_000_000_000_000_000_000; // 30 base units (18 dp)
pub const VIRTUAL_TOKEN: u128 = 1_000_000_000_000_000_000_000_000_000; // 1e27 (1B @ 18dp)
pub const GRAD_TARGET: u128 = 120_000_000_000_000_000_000; // 120 base units
pub const FEE_BPS: u128 = 100; // 1% total
pub const CREATOR_FEE_BPS: u128 = 25; // 0.25%
pub const PROTOCOL_FEE_BPS: u128 = 25; // 0.25%
pub const MAX_TRADE_BPS: u128 = 1000; // 10% of virtual token reserve per buy
pub const SUPPLY: u256 = 1_000_000_000_000_000_000_000_000_000; // 1e27

/// The protocol treasury receives the protocol share of every trade fee.
pub fn treasury() -> ContractAddress {
    contract_address_const::<'TRESY'>()
}

/// The creator (deployer) of every `deploy_full_stack` curve. Kept distinct from the test
/// contract so the test contract (trader/pool) never accidentally receives creator fees.
pub fn creator() -> ContractAddress {
    contract_address_const::<'CREAT'>()
}

/// A deployed curve + its token + executor + router.
#[derive(Copy, Drop)]
pub struct CurveStack {
    pub token: ContractAddress,
    pub curve: ContractAddress,
    pub executor: ContractAddress,
    pub router: ContractAddress,
    pub base: ContractAddress,
}

/// Fresh dispatcher accessors — generated dispatchers are moved on use, so always
/// construct a new one per call site.
pub fn curve_disp(stack: CurveStack) -> umbra_launch::interfaces::IBondingCurveDispatcher {
    umbra_launch::interfaces::IBondingCurveDispatcher { contract_address: stack.curve }
}

pub fn base_disp(stack: CurveStack) -> umbra_launch::interfaces::IERC20Dispatcher {
    umbra_launch::interfaces::IERC20Dispatcher { contract_address: stack.base }
}

pub fn token_disp(stack: CurveStack) -> umbra_launch::interfaces::IMemecoinDispatcher {
    umbra_launch::interfaces::IMemecoinDispatcher { contract_address: stack.token }
}

/// Deploy the (mock) base asset ERC20.
pub fn deploy_base_asset() -> ContractAddress {
    let class = declare("TestBaseAsset").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![]).unwrap();
    addr
}

/// Mint base to `to`.
pub fn mint_base(base: ContractAddress, to: ContractAddress, amount: u256) {
    ITestBaseAssetDispatcher { contract_address: base }.mint(to, amount);
}

/// Deploy a fresh memecoin with supply minted to `initial_holder`.
pub fn deploy_memecoin(initial_holder: ContractAddress, supply: u256) -> ContractAddress {
    let class = declare("Memecoin").unwrap().contract_class();
    let (addr, _) = class
        .deploy(@array!['HAMSTR'.into(), 'HSTR'.into(), 18_u8.into(), initial_holder.into(), supply.low.into(), supply.high.into()])
        .unwrap();
    addr
}

/// Deploy a BondingCurve V2 wired to `base` and `token` (deployer = `creator()`,
/// treasury = TREASURY, graduation recipient passed in).
pub fn deploy_curve_with_token(
    base: ContractAddress, token: ContractAddress, graduation_recipient: ContractAddress,
) -> ContractAddress {
    deploy_curve_as(base, token, graduation_recipient, creator())
}

/// Deploy a BondingCurve V2 with an explicit deployer.
pub fn deploy_curve_as(
    base: ContractAddress,
    token: ContractAddress,
    graduation_recipient: ContractAddress,
    deployer: ContractAddress,
) -> ContractAddress {
    let class = declare("BondingCurve").unwrap().contract_class();
    let (addr, _) = class
        .deploy(
            @array![
                base.into(),
                token.into(),
                VIRTUAL_BASE.into(),
                VIRTUAL_TOKEN.into(),
                GRAD_TARGET.into(),
                FEE_BPS.into(),
                CREATOR_FEE_BPS.into(),
                PROTOCOL_FEE_BPS.into(),
                MAX_TRADE_BPS.into(),
                deployer.into(),
                treasury().into(),
                graduation_recipient.into(),
            ],
        )
        .unwrap();
    addr
}

pub fn deploy_router(governance: ContractAddress) -> ContractAddress {
    let class = declare("GraduationRouter").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![governance.into()]).unwrap();
    addr
}

pub fn deploy_executor(
    pool: ContractAddress, curve: ContractAddress, base: ContractAddress, token: ContractAddress,
) -> ContractAddress {
    let class = declare("PrivateCurveExecutor").unwrap().contract_class();
    let (addr, _) = class
        .deploy(@array![pool.into(), curve.into(), base.into(), token.into()])
        .unwrap();
    addr
}

/// Public buy executed by the TEST CONTRACT (it is the caller, so it must hold and approve
/// the base). Tokens are paid to `recipient`. Use cap-compliant amounts (≤ ~3 STRK).
pub fn buy_public(stack: CurveStack, recipient: ContractAddress, base_in: u128) -> u128 {
    mint_base(stack.base, get_contract_address(), base_in.into());
    let base = umbra_launch::interfaces::IERC20Dispatcher { contract_address: stack.base };
    assert(base.approve(stack.curve, base_in.into()), 'approve failed');
    let curve = umbra_launch::interfaces::IBondingCurveDispatcher { contract_address: stack.curve };
    curve.buy(base_in, recipient)
}

/// Deploy a complete standalone stack (base + memecoin + curve V2 + executor + router).
/// The test contract plays the role of the privacy pool; the curve's creator is `creator()`.
pub fn deploy_full_stack() -> CurveStack {
    deploy_stack_with_deployer(creator())
}

/// Like `deploy_full_stack` but with an explicit curve deployer.
pub fn deploy_stack_with_deployer(deployer: ContractAddress) -> CurveStack {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let token = deploy_memecoin(get_contract_address(), SUPPLY);
    let curve = deploy_curve_as(base, token, router, deployer);
    let token_disp = umbra_launch::interfaces::IMemecoinDispatcher { contract_address: token };
    token_disp.transfer(curve, SUPPLY);
    let executor = deploy_executor(get_contract_address(), curve, base, token);
    CurveStack { token, curve, executor, router, base }
}

pub fn declare_factory(
    base: ContractAddress, pool: ContractAddress, router: ContractAddress,
) -> ITokenFactoryDispatcher {
    let memecoin_class = declare("Memecoin").unwrap().contract_class();
    let curve_class = declare("BondingCurve").unwrap().contract_class();
    let executor_class = declare("PrivateCurveExecutor").unwrap().contract_class();
    let factory_class = declare("TokenFactory").unwrap().contract_class();
    let (addr, _) = factory_class
        .deploy(
            @array![
                get_contract_address().into(),
                base.into(),
                pool.into(),
                router.into(),
                treasury().into(),
                (*memecoin_class.class_hash).into(),
                (*curve_class.class_hash).into(),
                (*executor_class.class_hash).into(),
            ],
        )
        .unwrap();
    ITokenFactoryDispatcher { contract_address: addr }
}