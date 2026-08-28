//! Shared test helpers for UMBRA LAUNCH snforge tests.

use starknet::{ContractAddress, get_contract_address};
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

use umbra_launch::interfaces::{
    IBondingCurveDispatcher, IBondingCurveDispatcherTrait, IERC20Dispatcher,
    IERC20DispatcherTrait, IMemecoinDispatcher, IMemecoinDispatcherTrait,
};
use umbra_launch::interfaces::ITokenFactoryDispatcher;
use umbra_launch::test_base_asset::{
    ITestBaseAssetDispatcher, ITestBaseAssetDispatcherTrait,
};

pub const VIRTUAL_BASE: u128 = 15_000_000_000_000_000_000; // 15 base units (18 dp)
pub const VIRTUAL_TOKEN: u128 = 1_073_000_000_000_000_000_000_000_000; // 1.073e27 (18 dp)
pub const GRAD_TARGET: u128 = 50_000_000_000_000_000_000; // 50 base units
pub const FEE_BPS: u128 = 100; // 1%
pub const SUPPLY: u256 = 1_073_000_000_000_000_000_000_000_000; // 1.073e27

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

/// Deploy the bonding curve wired to `base` and `token` (deployer = test contract).
pub fn deploy_curve_with_token(
    base: ContractAddress, token: ContractAddress, graduation_recipient: ContractAddress,
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
                get_contract_address().into(),
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
/// the base). Tokens are paid to `recipient`.
pub fn buy_public(stack: CurveStack, recipient: ContractAddress, base_in: u128) -> u128 {
    mint_base(stack.base, get_contract_address(), base_in.into());
    let base = umbra_launch::interfaces::IERC20Dispatcher { contract_address: stack.base };
    assert(base.approve(stack.curve, base_in.into()), 'approve failed');
    let curve = umbra_launch::interfaces::IBondingCurveDispatcher { contract_address: stack.curve };
    curve.buy(base_in, recipient)
}

/// Deploy a complete standalone stack (base + memecoin + curve + executor + router).
/// The test contract plays the role of the privacy pool.
pub fn deploy_full_stack() -> CurveStack {
    let base = deploy_base_asset();
    let router = deploy_router(get_contract_address());
    let token = deploy_memecoin(get_contract_address(), SUPPLY);
    let curve = deploy_curve_with_token(base, token, router);
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
                (*memecoin_class.class_hash).into(),
                (*curve_class.class_hash).into(),
                (*executor_class.class_hash).into(),
            ],
        )
        .unwrap();
    ITokenFactoryDispatcher { contract_address: addr }
}