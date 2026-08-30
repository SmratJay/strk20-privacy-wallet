//! GraduationRouter — truthful graduation liquidity boundary for UMBRA LAUNCH V2.
//!
//! When a BondingCurve V2 graduates (automatically at its target, or via `graduate()`), it
//! moves its real base reserves and remaining token balance to the `graduation_recipient`
//! configured on the curve (this router).
//!
//! The router distinguishes two on-chain truths the UI must never blur:
//!   - CURVE GRADUATED  → `BondingCurve.is_graduated()` is true; the curve is closed and its
//!     reserves sit in this router.
//!   - LIQUIDITY MIGRATED → `GraduationRouter.is_migrated(curve)` is true; governance has
//!     called `forward_reserves`, which moved the router-held reserves to the configured
//!     `liquidity_manager` (a real DEX/Ekubo boundary).
//!
//! `forward_reserves` is governance-only, asserts the curve really graduated, and can only
//! run once per curve. It is the clean, auditable seam where a direct Ekubo pool migration
//! plugs in later — it is never faked: no "migration" is reported until reserves actually
//! move to the liquidity manager.
//!
//! `on_graduation` is a public observation hook that emits the exact seeded amounts for the
//! UI and asserts the curve is graduated. It does not move funds.

use crate::interfaces::IGraduationRouter;
use crate::interfaces::{IBondingCurveDispatcher, IBondingCurveDispatcherTrait};
use crate::interfaces::{IERC20Dispatcher, IERC20DispatcherTrait};
use crate::interfaces::{IMemecoinDispatcher, IMemecoinDispatcherTrait};

#[starknet::contract]
pub mod GraduationRouter {
    use super::{
        IGraduationRouter, IBondingCurveDispatcher, IBondingCurveDispatcherTrait,
        IERC20Dispatcher, IERC20DispatcherTrait, IMemecoinDispatcher, IMemecoinDispatcherTrait,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, Map,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        governance: ContractAddress,
        liquidity_manager: ContractAddress,
        /// Per-curve migration truth (only graduated curves may be migrated, once).
        migrated: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LiquidityManagerSet: LiquidityManagerSet,
        ReservesForwarded: ReservesForwarded,
        GraduationSeeded: GraduationSeeded,
        LiquidityMigrated: LiquidityMigrated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityManagerSet {
        pub manager: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReservesForwarded {
        pub curve: ContractAddress,
        pub token_amount: u256,
        pub base_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GraduationSeeded {
        pub curve: ContractAddress,
        pub token: ContractAddress,
        pub base_asset: ContractAddress,
        pub token_amount: u256,
        pub base_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityMigrated {
        pub curve: ContractAddress,
        pub manager: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, governance: ContractAddress) {
        assert(governance.is_non_zero(), 'ZERO_GOVERNANCE');
        self.governance.write(governance);
        self.liquidity_manager.write(Zero::zero());
    }

    #[abi(embed_v0)]
    impl GraduationRouterImpl of IGraduationRouter<ContractState> {
        fn set_liquidity_manager(ref self: ContractState, manager: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.governance.read(), 'UNAUTHORIZED_GOVERNANCE');
            self.liquidity_manager.write(manager);
            self.emit(LiquidityManagerSet { manager });
        }

        fn forward_reserves(
            ref self: ContractState, curve: ContractAddress, token: ContractAddress, base_asset: ContractAddress,
        ) {
            let caller = get_caller_address();
            assert(caller == self.governance.read(), 'UNAUTHORIZED_GOVERNANCE');
            let manager = self.liquidity_manager.read();
            assert(manager.is_non_zero(), 'NO_LIQUIDITY_MANAGER');
            // Only a graduated curve may forward reserves, and only once.
            let curve_disp = IBondingCurveDispatcher { contract_address: curve };
            assert(curve_disp.is_graduated(), 'CURVE_NOT_GRADUATED');
            assert(!self.migrated.read(curve), 'ALREADY_MIGRATED');

            let self_addr = get_contract_address();
            let token_disp = IMemecoinDispatcher { contract_address: token };
            let token_balance = token_disp.balance_of(self_addr);
            let base_disp = IERC20Dispatcher { contract_address: base_asset };
            let base_balance = base_disp.balance_of(self_addr);

            if !token_balance.is_zero() {
                assert(token_disp.transfer(manager, token_balance), 'TOKEN_FORWARD_FAILED');
            }
            if !base_balance.is_zero() {
                assert(base_disp.transfer(manager, base_balance), 'BASE_FORWARD_FAILED');
            }
            self.migrated.write(curve, true);
            self.emit(ReservesForwarded { curve, token_amount: token_balance, base_amount: base_balance });
            self.emit(LiquidityMigrated { curve, manager });
        }

        fn on_graduation(
            ref self: ContractState, curve: ContractAddress, token: ContractAddress, base_asset: ContractAddress,
        ) {
            let curve_disp = IBondingCurveDispatcher { contract_address: curve };
            assert(curve_disp.is_graduated(), 'CURVE_NOT_GRADUATED');

            let self_addr = get_contract_address();
            let token_disp = IMemecoinDispatcher { contract_address: token };
            let token_balance = token_disp.balance_of(self_addr);
            let base_disp = IERC20Dispatcher { contract_address: base_asset };
            let base_balance = base_disp.balance_of(self_addr);

            self.emit(GraduationSeeded {
                curve, token, base_asset, token_amount: token_balance, base_amount: base_balance,
            });
        }

        fn is_migrated(self: @ContractState, curve: ContractAddress) -> bool {
            self.migrated.read(curve)
        }

        fn get_governance(self: @ContractState) -> ContractAddress {
            self.governance.read()
        }

        fn get_liquidity_manager(self: @ContractState) -> ContractAddress {
            self.liquidity_manager.read()
        }
    }
}