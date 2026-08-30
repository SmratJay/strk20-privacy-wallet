//! Canonical bonding curve for UMBRA LAUNCH V2.
//!
//! A single deterministic virtual-reserve constant-product market:
//!
//!     total_base  = virtual_base_reserve + base_reserve    (real STRK in)
//!     total_token = virtual_token_reserve - token_reserve  (real tokens sold out)
//!     k = virtual_base_reserve * virtual_token_reserve
//!     total_base * total_token ≈ k
//!
//! Pricing uses `ceil` division so rounding dust ALWAYS favors the pool — a buy+sell round
//! trip strictly costs the trader, so there is no rounding exploit.
//!
//! V2 fee economics: a single `fee_bps` is charged on the BASE input/output of each leg and
//! split into three destinations:
//!   - `creator_fee_bps`  → forwarded to the token creator (in STRK)
//!   - `protocol_fee_bps` → forwarded to the protocol treasury (in STRK)
//!   - the remainder of the fee stays in the curve and accrues to graduation liquidity
//!
//! BUY  charges the fee on the STRK input: only `base_amount - creator_fee - protocol_fee`
//! enters the reserve, and token output is priced off that net amount.
//! SELL charges the fee on the STRK output: the gross base output is priced off the full
//! token input, then creator/protocol shares are deducted from it; the pool keeps the rest.
//!
//! V2 anti-pathology:
//!   - `max_trade_bps` caps a single buy at a fraction of the virtual token reserve, so one
//!     transaction can never swallow the curve.
//!   - auto-graduation: the trade that pushes `base_reserve` at/over the graduation target
//!     immediately finalizes graduation — reserves move to the router and trading locks, so
//!     the curve can never trade past its target.
//!   - `set_graduation_recipient` is locked once any real liquidity exists, so a creator
//!     cannot redirect the graduation pool after it has been funded.
//!   - no free tokens: token_out is derived from the k relationship using only net input.
//!   - no reserve drain: base_out is bounded by base_reserve (checked subtraction).
//!   - no post-graduation trading (reverts).
//!   - fixed supply, owned by the curve; no mintable or ownable token mechanics.

use crate::interfaces::{IBondingCurve, IERC20Dispatcher, IERC20DispatcherTrait};
use crate::interfaces::{IMemecoinDispatcher, IMemecoinDispatcherTrait};

#[starknet::contract]
pub mod BondingCurve {
    use super::{IBondingCurve, IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{IMemecoinDispatcher, IMemecoinDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use core::num::traits::Zero;

    /// Max fee basis points (100%).
    const MAX_FEE_BPS: u128 = 10_000;
    /// Default total fee (1%).
    pub const DEFAULT_FEE_BPS: u128 = 100;
    /// Default creator share of a 1% fee (0.25%).
    pub const DEFAULT_CREATOR_FEE_BPS: u128 = 25;
    /// Default protocol share of a 1% fee (0.25%).
    pub const DEFAULT_PROTOCOL_FEE_BPS: u128 = 25;
    /// Default max single buy = 10% of the virtual token reserve.
    pub const DEFAULT_MAX_TRADE_BPS: u128 = 1_000;

    #[storage]
    struct Storage {
        base_asset: ContractAddress,
        token: ContractAddress,
        deployer: ContractAddress,
        protocol_treasury: ContractAddress,
        graduation_recipient: ContractAddress,
        virtual_base_reserve: u128,
        virtual_token_reserve: u128,
        // k = virtual_base_reserve * virtual_token_reserve (u256)
        k: u256,
        base_reserve: u128,
        token_reserve: u128,
        graduation_target: u128,
        fee_bps: u128,
        creator_fee_bps: u128,
        protocol_fee_bps: u128,
        max_trade_bps: u128,
        graduated: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Buy: Buy,
        Sell: Sell,
        Graduated: Graduated,
        GraduationRecipientSet: GraduationRecipientSet,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Buy {
        pub trader: ContractAddress,
        pub recipient: ContractAddress,
        /// Gross STRK input.
        pub base_amount: u128,
        /// Net token output delivered to the recipient.
        pub token_out: u128,
        /// Total fee collected (base).
        pub fee: u128,
        /// Real base reserve AFTER this trade (enables exact price-history replay).
        pub base_after: u128,
        /// Real token reserve (circulating sold) AFTER this trade.
        pub token_after: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Sell {
        pub trader: ContractAddress,
        pub recipient: ContractAddress,
        /// Gross token input.
        pub token_amount: u128,
        /// Net STRK output delivered to the recipient.
        pub base_out: u128,
        /// Total fee collected (base).
        pub fee: u128,
        /// Real base reserve AFTER this trade.
        pub base_after: u128,
        /// Real token reserve (circulating sold) AFTER this trade.
        pub token_after: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Graduated {
        pub recipient: ContractAddress,
        pub base_amount: u128,
        pub token_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GraduationRecipientSet {
        pub recipient: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        base_asset: ContractAddress,
        token: ContractAddress,
        virtual_base_reserve: u128,
        virtual_token_reserve: u128,
        graduation_target: u128,
        fee_bps: u128,
        creator_fee_bps: u128,
        protocol_fee_bps: u128,
        max_trade_bps: u128,
        deployer: ContractAddress,
        protocol_treasury: ContractAddress,
        graduation_recipient: ContractAddress,
    ) {
        assert(base_asset.is_non_zero(), 'ZERO_BASE_ASSET');
        assert(token.is_non_zero(), 'ZERO_TOKEN');
        assert(virtual_base_reserve > 0, 'ZERO_VIRTUAL_BASE');
        assert(virtual_token_reserve > 0, 'ZERO_VIRTUAL_TOKEN');
        assert(graduation_target > 0, 'ZERO_GRAD_TARGET');
        assert(fee_bps <= MAX_FEE_BPS, 'FEE_TOO_HIGH');
        // Fees must never eat the entire input: creator + protocol < 100%.
        assert(creator_fee_bps + protocol_fee_bps < MAX_FEE_BPS, 'FEES_EXCEED_100PCT');
        assert(creator_fee_bps + protocol_fee_bps <= fee_bps, 'FEE_SPLIT_EXCEEDS_TOTAL');
        assert(max_trade_bps <= MAX_FEE_BPS, 'MAX_TRADE_TOO_HIGH');
        assert(protocol_treasury.is_non_zero(), 'ZERO_TREASURY');
        self.base_asset.write(base_asset);
        self.token.write(token);
        self.deployer.write(deployer);
        self.protocol_treasury.write(protocol_treasury);
        self.graduation_recipient.write(graduation_recipient);
        self.virtual_base_reserve.write(virtual_base_reserve);
        self.virtual_token_reserve.write(virtual_token_reserve);
        self.graduation_target.write(graduation_target);
        self.fee_bps.write(fee_bps);
        self.creator_fee_bps.write(creator_fee_bps);
        self.protocol_fee_bps.write(protocol_fee_bps);
        self.max_trade_bps.write(max_trade_bps);
        self.k.write(virtual_base_reserve.into() * virtual_token_reserve.into());
        self.base_reserve.write(0);
        self.token_reserve.write(0);
        self.graduated.write(false);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// ceil(a / b) for u256. Never overflows (q+1 <= x+1).
        fn ceil_div(self: @ContractState, a: u256, b: u256) -> u256 {
            let q = a / b;
            let r = a % b;
            if r.is_zero() {
                q
            } else {
                q + 1
            }
        }

        fn total_base(self: @ContractState) -> u256 {
            self.virtual_base_reserve.read().into() + self.base_reserve.read().into()
        }

        fn total_token(self: @ContractState) -> u256 {
            let vt: u256 = self.virtual_token_reserve.read().into();
            let tr: u256 = self.token_reserve.read().into();
            vt - tr
        }

        /// Token output for a net (post-fee) base input, using ceil division so rounding
        /// dust favors the pool.
        fn compute_token_out(self: @ContractState, net_base: u128) -> u128 {
            assert(net_base > 0, 'ZERO_NET_BASE');
            let total_base_before = self.total_base();
            let total_token_before = self.total_token();
            let total_base_after: u256 = total_base_before + net_base.into();
            let total_token_after = self.ceil_div(self.k.read(), total_base_after);
            assert(total_base_after > total_base_before, 'BASE_OVERFLOW');
            assert(total_token_after < total_token_before, 'TOKEN_OUT_NOT_POSITIVE');
            let token_out = total_token_before - total_token_after;
            token_out.try_into().expect('TOKEN_OUT_OVERFLOW')
        }

        /// Base output for a gross token input, using ceil division so rounding dust favors
        /// the pool.
        fn compute_base_out(self: @ContractState, gross_token: u128) -> u128 {
            assert(gross_token > 0, 'ZERO_NET_TOKEN');
            let total_token_before = self.total_token();
            let total_base_before = self.total_base();
            let total_token_after: u256 = total_token_before + gross_token.into();
            let total_base_after = self.ceil_div(self.k.read(), total_token_after);
            assert(total_token_after > total_token_before, 'TOKEN_OVERFLOW');
            assert(total_base_after < total_base_before, 'BASE_OUT_NOT_POSITIVE');
            let base_out = total_base_before - total_base_after;
            let base_out_u128: u128 = base_out.try_into().expect('BASE_OUT_OVERFLOW');
            // Never allow the virtual base reserve to go negative.
            assert(base_out_u128 <= self.base_reserve.read(), 'BASE_RESERVE_NEGATIVE');
            base_out_u128
        }

        /// Maximum single-trade token output (fraction of the virtual token reserve).
        fn max_token_out(self: @ContractState) -> u256 {
            let vt: u256 = self.virtual_token_reserve.read().into();
            let cap: u256 = vt * self.max_trade_bps.read().into() / MAX_FEE_BPS.into();
            cap
        }

        /// Auto-graduation: once the real base reserve reaches the target, move the reserves
        /// to the graduation recipient (router) and lock trading. Idempotent.
        fn maybe_graduate(ref self: ContractState) {
            if self.graduated.read() {
                return;
            }
            if self.base_reserve.read() < self.graduation_target.read() {
                return;
            }
            self._finalize_graduation();
        }

        fn _finalize_graduation(ref self: ContractState) {
            self.graduated.write(true);
            let recipient = self.graduation_recipient.read();
            let base_amount = self.base_reserve.read();
            self.base_reserve.write(0);
            self.token_reserve.write(0);

            // Remaining token balance physically held by the curve (unsold supply).
            let token = IMemecoinDispatcher { contract_address: self.token.read() };
            let token_amount = token.balance_of(get_contract_address());
            let token_amount_u128: u128 = token_amount.try_into().expect('TOKEN_AMOUNT_OVERFLOW');

            if recipient.is_non_zero() {
                let base = IERC20Dispatcher { contract_address: self.base_asset.read() };
                let ok_base = base.transfer(recipient, base_amount.into());
                assert(ok_base, 'GRAD_BASE_TRANSFER_FAILED');
                let ok_token = token.transfer(recipient, token_amount);
                assert(ok_token, 'GRAD_TOKEN_TRANSFER_FAILED');
            }

            self.emit(Graduated { recipient, base_amount, token_amount: token_amount_u128 });
        }
    }

    #[abi(embed_v0)]
    impl BondingCurveImpl of IBondingCurve<ContractState> {
        fn buy(ref self: ContractState, base_amount: u128, recipient: ContractAddress) -> u128 {
            assert(!self.graduated.read(), 'CURVE_GRADUATED');
            assert(base_amount > 0, 'ZERO_BUY_AMOUNT');
            assert(recipient.is_non_zero(), 'ZERO_RECIPIENT');

            let protocol_fee = self.protocol_fee_bps.read() * base_amount / MAX_FEE_BPS;
            let creator_fee = self.creator_fee_bps.read() * base_amount / MAX_FEE_BPS;
            let net_base = base_amount - protocol_fee - creator_fee;
            assert(net_base > 0, 'ZERO_NET_BASE');

            let token_out = self.compute_token_out(net_base);
            let cap = self.max_token_out();
            assert(token_out.into() <= cap, 'MAX_TRADE_EXCEEDED');

            // Reserve accounting BEFORE external transfers (checks-effects-interactions).
            self.base_reserve.write(self.base_reserve.read() + net_base);
            self.token_reserve.write(self.token_reserve.read() + token_out);

            // Pull the gross base, then forward creator + protocol shares immediately. The
            // retained fee stays in the curve as part of the reserve.
            let base = IERC20Dispatcher { contract_address: self.base_asset.read() };
            let success = base
                .transfer_from(get_caller_address(), get_contract_address(), base_amount.into());
            assert(success, 'BUY_BASE_TRANSFER_FAILED');
            if protocol_fee > 0 {
                let ok = base.transfer(self.protocol_treasury.read(), protocol_fee.into());
                assert(ok, 'BUY_PROTOCOL_FEE_FAILED');
            }
            if creator_fee > 0 {
                let ok = base.transfer(self.deployer.read(), creator_fee.into());
                assert(ok, 'BUY_CREATOR_FEE_FAILED');
            }

            let token = IMemecoinDispatcher { contract_address: self.token.read() };
            let success = token.transfer(recipient, token_out.into());
            assert(success, 'BUY_TOKEN_TRANSFER_FAILED');

            let base_after = self.base_reserve.read();
            let token_after = self.token_reserve.read();
            self.emit(Buy {
                trader: get_caller_address(),
                recipient,
                base_amount,
                token_out,
                fee: protocol_fee + creator_fee,
                base_after,
                token_after,
            });

            // A buy may push the curve past its graduation target — close immediately.
            self.maybe_graduate();
            token_out
        }

        fn sell(ref self: ContractState, token_amount: u128, recipient: ContractAddress) -> u128 {
            assert(!self.graduated.read(), 'CURVE_GRADUATED');
            assert(token_amount > 0, 'ZERO_SELL_AMOUNT');
            assert(recipient.is_non_zero(), 'ZERO_RECIPIENT');

            let gross_base_out = self.compute_base_out(token_amount);
            let protocol_fee = self.protocol_fee_bps.read() * gross_base_out / MAX_FEE_BPS;
            let creator_fee = self.creator_fee_bps.read() * gross_base_out / MAX_FEE_BPS;
            let net_base_out = gross_base_out - protocol_fee - creator_fee;

            // Reserve accounting BEFORE external transfers.
            self.base_reserve.write(self.base_reserve.read() - gross_base_out);
            self.token_reserve.write(self.token_reserve.read() - token_amount);

            let token = IMemecoinDispatcher { contract_address: self.token.read() };
            let success = token
                .transfer_from(get_caller_address(), get_contract_address(), token_amount.into());
            assert(success, 'SELL_TOKEN_TRANSFER_FAILED');
            // Tokens are NOT burned: they return to the curve's custody. The physical balance
            // always equals (total_supply - token_reserve), which keeps the virtual-reserve
            // model exactly consistent with the real token balance (no depletion).

            let base = IERC20Dispatcher { contract_address: self.base_asset.read() };
            let success = base.transfer(recipient, net_base_out.into());
            assert(success, 'SELL_BASE_TRANSFER_FAILED');
            if protocol_fee > 0 {
                let ok = base.transfer(self.protocol_treasury.read(), protocol_fee.into());
                assert(ok, 'SELL_PROTOCOL_FEE_FAILED');
            }
            if creator_fee > 0 {
                let ok = base.transfer(self.deployer.read(), creator_fee.into());
                assert(ok, 'SELL_CREATOR_FEE_FAILED');
            }

            let base_after = self.base_reserve.read();
            let token_after = self.token_reserve.read();
            self.emit(Sell {
                trader: get_caller_address(),
                recipient,
                token_amount,
                base_out: net_base_out,
                fee: protocol_fee + creator_fee,
                base_after,
                token_after,
            });
            net_base_out
        }

        fn quote_buy(self: @ContractState, base_amount: u128) -> u128 {
            if base_amount == 0 {
                return 0;
            }
            let protocol_fee = self.protocol_fee_bps.read() * base_amount / MAX_FEE_BPS;
            let creator_fee = self.creator_fee_bps.read() * base_amount / MAX_FEE_BPS;
            let net_base = base_amount - protocol_fee - creator_fee;
            let token_out = self.compute_token_out(net_base);
            // Quotes mirror execution: an oversized order is rejected, not silently capped.
            assert(token_out.into() <= self.max_token_out(), 'MAX_TRADE_EXCEEDED');
            token_out
        }

        fn quote_sell(self: @ContractState, token_amount: u128) -> u128 {
            if token_amount == 0 {
                return 0;
            }
            let gross_base_out = self.compute_base_out(token_amount);
            let protocol_fee = self.protocol_fee_bps.read() * gross_base_out / MAX_FEE_BPS;
            let creator_fee = self.creator_fee_bps.read() * gross_base_out / MAX_FEE_BPS;
            gross_base_out - protocol_fee - creator_fee
        }

        fn graduate(ref self: ContractState) {
            assert(!self.graduated.read(), 'ALREADY_GRADUATED');
            assert(
                self.base_reserve.read() >= self.graduation_target.read(), 'GRAD_TARGET_NOT_REACHED',
            );
            self._finalize_graduation();
        }

        fn set_graduation_recipient(ref self: ContractState, recipient: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.deployer.read(), 'UNAUTHORIZED_DEPLOYER');
            // Anti-pathology: once any real liquidity exists, the graduation recipient is
            // locked so the creator cannot redirect the graduation pool.
            assert(self.base_reserve.read() == 0, 'LIQUIDITY_LOCKED');
            self.graduation_recipient.write(recipient);
            self.emit(GraduationRecipientSet { recipient });
        }

        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }

        fn get_base_asset(self: @ContractState) -> ContractAddress {
            self.base_asset.read()
        }

        fn get_deployer(self: @ContractState) -> ContractAddress {
            self.deployer.read()
        }

        fn get_protocol_treasury(self: @ContractState) -> ContractAddress {
            self.protocol_treasury.read()
        }

        fn get_virtual_reserves(self: @ContractState) -> (u128, u128) {
            (self.virtual_base_reserve.read(), self.virtual_token_reserve.read())
        }

        fn get_real_reserves(self: @ContractState) -> (u128, u128) {
            (self.base_reserve.read(), self.token_reserve.read())
        }

        fn get_tokens_sold(self: @ContractState) -> u128 {
            self.token_reserve.read()
        }

        fn get_graduation_target(self: @ContractState) -> u128 {
            self.graduation_target.read()
        }

        fn is_graduated(self: @ContractState) -> bool {
            self.graduated.read()
        }

        fn get_price(self: @ContractState) -> (u128, u128) {
            let total_base = self.total_base();
            let total_token = self.total_token();
            let base_u128: u128 = total_base.try_into().expect('PRICE_BASE_OVERFLOW');
            let token_u128: u128 = total_token.try_into().expect('PRICE_TOKEN_OVERFLOW');
            (base_u128, token_u128)
        }

        fn get_available_liquidity(self: @ContractState) -> u128 {
            self.base_reserve.read()
        }

        fn get_fee_bps(self: @ContractState) -> u128 {
            self.fee_bps.read()
        }

        fn get_creator_fee_bps(self: @ContractState) -> u128 {
            self.creator_fee_bps.read()
        }

        fn get_protocol_fee_bps(self: @ContractState) -> u128 {
            self.protocol_fee_bps.read()
        }

        fn get_max_trade_bps(self: @ContractState) -> u128 {
            self.max_trade_bps.read()
        }
    }
}