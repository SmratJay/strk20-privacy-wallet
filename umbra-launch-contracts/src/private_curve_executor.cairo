//! PrivateCurveExecutor — the STRK20 invoke anonymizer for a BondingCurve V2.
//!
//! Mirrors the official `EkuboSwapAnonymizer` contract shape exactly: it is called by the
//! STRK20 privacy pool via the `privacy_invoke` selector (INVOKE_SELECTOR), spends the
//! input tokens the pool withdrew to it on the canonical public BondingCurve, then returns
//! a single `OpenNoteDeposit` for the pool to apply (the pool pulls the output token from
//! this contract and fills the open note).
//!
//! One executor instance is deployed per curve, and its `privacy_pool`, `curve`,
//! `base_asset` and `token` are fixed at construction. `privacy_invoke` therefore:
//!   - only accepts calls from the configured privacy pool (get_caller_address)
//!   - only accepts the exact input token for the requested operation
//!     (BUY → base_asset, SELL → token)
//!   - only ever routes through the configured curve
//!   - never picks a recipient: the output always flows to the pool, which fills the open
//!     note the proof bound to the user's own address
//!
//! V2 private-execution awareness: the executor tracks cumulative private volume and a
//! private-trade counter (public state, no identity) so the UI can show how much of a
//! curve's activity ran through the shielded lane. A private trade moves the exact same
//! canonical curve reserves/price/graduation mechanics as a public trade.
//!
//! The curve sees THIS contract as the trader — never the end user's wallet.

use crate::interfaces::IPrivateCurveExecutor;
use crate::interfaces::{IBondingCurveDispatcher, IBondingCurveDispatcherTrait};
use crate::interfaces::{IERC20Dispatcher, IERC20DispatcherTrait};
use crate::interfaces::{IMemecoinDispatcher, IMemecoinDispatcherTrait};
use crate::objects::{curve_operation, OpenNoteDeposit};

#[starknet::contract]
pub mod PrivateCurveExecutor {
    use super::{
        IPrivateCurveExecutor, IBondingCurveDispatcher, IBondingCurveDispatcherTrait,
        IERC20Dispatcher, IERC20DispatcherTrait, IMemecoinDispatcher, IMemecoinDispatcherTrait,
        OpenNoteDeposit, curve_operation,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        curve: ContractAddress,
        base_asset: ContractAddress,
        token: ContractAddress,
        /// Cumulative private-trade count through this executor.
        private_trade_count: u128,
        /// Cumulative private volume in base units (buys add input base, sells add output base).
        private_volume_base: u128,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrivateBuyExecuted: PrivateBuyExecuted,
        PrivateSellExecuted: PrivateSellExecuted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateBuyExecuted {
        pub curve: ContractAddress,
        pub base_amount: u128,
        pub token_out: u128,
        pub note_id: felt252,
        /// Cumulative private volume (base) AFTER this trade.
        pub volume_base_after: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateSellExecuted {
        pub curve: ContractAddress,
        pub token_amount: u128,
        pub base_out: u128,
        pub note_id: felt252,
        /// Cumulative private volume (base) AFTER this trade.
        pub volume_base_after: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_pool: ContractAddress,
        curve: ContractAddress,
        base_asset: ContractAddress,
        token: ContractAddress,
    ) {
        assert(privacy_pool.is_non_zero(), 'ZERO_POOL');
        assert(curve.is_non_zero(), 'ZERO_CURVE');
        assert(base_asset.is_non_zero(), 'ZERO_BASE_ASSET');
        assert(token.is_non_zero(), 'ZERO_TOKEN');
        self.privacy_pool.write(privacy_pool);
        self.curve.write(curve);
        self.base_asset.write(base_asset);
        self.token.write(token);
        self.private_trade_count.write(0);
        self.private_volume_base.write(0);
    }

    #[abi(embed_v0)]
    impl PrivateCurveExecutorImpl of IPrivateCurveExecutor<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: u8,
            input_token: ContractAddress,
            amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let caller = get_caller_address();
            assert(caller == self.privacy_pool.read(), 'UNAUTHORIZED_CALLER');
            assert(amount > 0, 'ZERO_AMOUNT');
            assert(note_id.is_non_zero(), 'ZERO_NOTE_ID');

            let self_addr = get_contract_address();
            let curve = IBondingCurveDispatcher { contract_address: self.curve.read() };
            let base_asset = self.base_asset.read();
            let token = self.token.read();

            let mut deposit: OpenNoteDeposit = OpenNoteDeposit {
                note_id: 0, token: Zero::zero(), amount: 0,
            };

            if operation == curve_operation::BUY {
                assert(input_token == base_asset, 'BUY_INPUT_NOT_BASE');
                let base = IERC20Dispatcher { contract_address: base_asset };
                let approved = base.approve(self.curve.read(), amount.into());
                assert(approved, 'BUY_APPROVE_FAILED');
                let token_out = curve.buy(amount, self_addr);
                assert(token_out > 0, 'ZERO_TOKEN_OUT');

                let memecoin = IMemecoinDispatcher { contract_address: token };
                let ok = memecoin.approve(caller, token_out.into());
                assert(ok, 'BUY_OUTPUT_APPROVE_FAILED');

                deposit = OpenNoteDeposit { note_id, token, amount: token_out };
                self.private_trade_count.write(self.private_trade_count.read() + 1);
                let volume_after = self.private_volume_base.read() + amount;
                self.private_volume_base.write(volume_after);
                self
                    .emit(
                        PrivateBuyExecuted {
                            curve: self.curve.read(),
                            base_amount: amount,
                            token_out,
                            note_id,
                            volume_base_after: volume_after,
                        },
                    );
            } else if operation == curve_operation::SELL {
                assert(input_token == token, 'SELL_INPUT_NOT_TOKEN');
                let memecoin = IMemecoinDispatcher { contract_address: token };
                let approved = memecoin.approve(self.curve.read(), amount.into());
                assert(approved, 'SELL_APPROVE_FAILED');
                let base_out = curve.sell(amount, self_addr);
                assert(base_out > 0, 'ZERO_BASE_OUT');

                let base = IERC20Dispatcher { contract_address: base_asset };
                let ok = base.approve(caller, base_out.into());
                assert(ok, 'SELL_OUTPUT_APPROVE_FAILED');

                deposit = OpenNoteDeposit { note_id, token: base_asset, amount: base_out };
                self.private_trade_count.write(self.private_trade_count.read() + 1);
                let volume_after = self.private_volume_base.read() + base_out;
                self.private_volume_base.write(volume_after);
                self
                    .emit(
                        PrivateSellExecuted {
                            curve: self.curve.read(),
                            token_amount: amount,
                            base_out,
                            note_id,
                            volume_base_after: volume_after,
                        },
                    );
            } else {
                assert(false, 'INVALID_OPERATION');
            };

            [deposit].span()
        }

        fn get_privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn get_curve(self: @ContractState) -> ContractAddress {
            self.curve.read()
        }

        fn get_base_asset(self: @ContractState) -> ContractAddress {
            self.base_asset.read()
        }

        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }

        fn get_private_trade_count(self: @ContractState) -> u128 {
            self.private_trade_count.read()
        }

        fn get_private_volume_base(self: @ContractState) -> u128 {
            self.private_volume_base.read()
        }
    }
}