// PEL Liquidity & Counterparty Vault — V1.0 (Whitepaper Section 6 & 13)
// Explicit Economic Counterparty, Share Pricing, Solvency & Settlement Authority

use starknet::ContractAddress;

#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct WithdrawalRequest {
    pub provider: ContractAddress,
    pub shares: u128,
    pub gross_cents: u128,
    pub request_timestamp: u64,
    pub is_claimed: bool,
}

#[starknet::interface]
pub trait IPELLiquidityVault<TContractState> {
    // LP User Operations
    fn deposit_liquidity(ref self: TContractState, amount_cents: u128) -> u128;
    fn request_withdrawal(ref self: TContractState, shares: u128) -> u64;
    fn claim_withdrawal(ref self: TContractState, request_id: u64) -> u128;

    // View Metrics & Solvency
    fn get_lp_shares_balance(self: @TContractState, provider: ContractAddress) -> u128;
    fn get_total_lp_shares(self: @TContractState) -> u128;
    fn get_pool_nav(self: @TContractState) -> u128;
    fn get_share_price_e6(self: @TContractState) -> u128;
    fn get_available_liquidity(self: @TContractState) -> u128;
    fn get_locked_liquidity(self: @TContractState) -> u128;
    fn get_utilization_bps(self: @TContractState) -> u16;
    fn get_withdrawal_request(self: @TContractState, request_id: u64) -> WithdrawalRequest;
    fn get_pending_withdrawals_total(self: @TContractState) -> u128;

    // Core Counterparty Settlement (Restricted to PELPerpsCore)
    fn lock_trader_margin(ref self: TContractState, margin_cents: u128);
    fn release_trader_margin(ref self: TContractState, margin_cents: u128);
    fn settle_trader_pnl(
        ref self: TContractState,
        pnl_cents: u128,
        is_profit: bool,
        recipient_note_commitment: felt252,
        recipient: ContractAddress
    );
    fn settle_funding(ref self: TContractState, amount_cents: u128, is_long_pays: bool);
    fn settle_liquidation(
        ref self: TContractState,
        seized_collateral_cents: u128,
        keeper_bounty_cents: u128,
        keeper_recipient: ContractAddress
    );

    // Note Claiming & Keeper Bounties
    fn claim_payout_note(ref self: TContractState, payout_nullifier: felt252, recipient_note_commitment: felt252);
    fn claim_keeper_bounty(ref self: TContractState, keeper_recipient: ContractAddress);
    fn get_keeper_bounty_balance(self: @TContractState, keeper: ContractAddress) -> u128;
    fn get_registered_note_amount(self: @TContractState, commitment: felt252) -> u128;
    fn get_registered_note_recipient(self: @TContractState, commitment: felt252) -> ContractAddress;
    fn is_note_claimed(self: @TContractState, commitment: felt252) -> bool;

    // Admin & Configuration
    fn set_pel_core_address(ref self: TContractState, pel_core: ContractAddress);
    fn set_insurance_reserve(ref self: TContractState, insurance: ContractAddress);
    fn set_treasury_address(ref self: TContractState, treasury: ContractAddress);
    fn set_collateral_token(ref self: TContractState, token: ContractAddress);
    fn get_collateral_token(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod PELLiquidityVault {
    use super::{IPELLiquidityVault, WithdrawalRequest};
    use super::super::test_usdc::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::super::pel_insurance_reserve::{IPELInsuranceReserveDispatcher, IPELInsuranceReserveDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const SHARE_SCALE: u128 = 1000000_u128;              // 1e6 fixed point scale
    const TOKEN_DECIMAL_MULTIPLIER: u128 = 10000_u128;   // 1 cent = 10,000 micro-USDC (6 decimals)
    const RESERVE_BUFFER_BPS: u128 = 5000_u128;          // 50% locked margin reserve buffer
    const WITHDRAWAL_COOLDOWN_SECS: u64 = 3600_u64;      // 1 hour (1 funding epoch) cooldown
    const MAX_UTILIZATION_BPS: u16 = 8500_u16;           // 85% max pool utilization cap

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        insurance_reserve: ContractAddress,
        treasury_address: ContractAddress,
        collateral_token: ContractAddress,

        // Core Accounting Buckets (in cents)
        lp_pool_nav: u128,
        total_lp_shares: u128,
        total_locked_collateral: u128,
        unclaimed_payouts_total: u128,
        unclaimed_bounties_total: u128,
        pending_withdrawals_total: u128,

        lp_shares_balances: Map<ContractAddress, u128>,
        deposit_timestamps: Map<ContractAddress, u64>,
        withdrawal_requests: Map<u64, WithdrawalRequest>,
        withdrawal_request_count: u64,

        // Shielded Note Registrations for Payouts
        registered_notes: Map<felt252, u128>,
        registered_note_recipients: Map<felt252, ContractAddress>,
        claimed_notes: Map<felt252, bool>,
        used_payout_nullifiers: Map<felt252, bool>,

        // Keeper Bounty Balances
        keeper_bounties: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LiquidityDeposited: LiquidityDeposited,
        WithdrawalRequested: WithdrawalRequested,
        WithdrawalClaimed: WithdrawalClaimed,
        TraderPnLSettled: TraderPnLSettled,
        FundingSettled: FundingSettled,
        LiquidationSettled: LiquidationSettled,
        PayoutClaimed: PayoutClaimed,
        BountyClaimed: BountyClaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityDeposited {
        pub provider: ContractAddress,
        pub amount_cents: u128,
        pub shares_minted: u128,
        pub new_pool_nav: u128,
        pub new_total_shares: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WithdrawalRequested {
        pub request_id: u64,
        pub provider: ContractAddress,
        pub shares: u128,
        pub gross_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WithdrawalClaimed {
        pub request_id: u64,
        pub provider: ContractAddress,
        pub amount_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TraderPnLSettled {
        pub pnl_cents: u128,
        pub is_profit: bool,
        pub new_pool_nav: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FundingSettled {
        pub amount_cents: u128,
        pub is_long_pays: bool,
        pub new_pool_nav: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidationSettled {
        pub seized_cents: u128,
        pub bounty_cents: u128,
        pub lp_share_cents: u128,
        pub insurance_share_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutClaimed {
        pub recipient: ContractAddress,
        pub commitment: felt252,
        pub amount_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BountyClaimed {
        pub keeper: ContractAddress,
        pub amount_cents: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        collateral_token: ContractAddress,
        treasury: ContractAddress
    ) {
        self.admin.write(admin);
        self.collateral_token.write(collateral_token);
        self.treasury_address.write(treasury);
        self.lp_pool_nav.write(0_u128);
        self.total_lp_shares.write(0_u128);
        self.total_locked_collateral.write(0_u128);
        self.unclaimed_payouts_total.write(0_u128);
        self.unclaimed_bounties_total.write(0_u128);
        self.pending_withdrawals_total.write(0_u128);
        self.withdrawal_request_count.write(0_u64);
    }

    #[abi(embed_v0)]
    impl PELLiquidityVaultImpl of IPELLiquidityVault<ContractState> {
        fn deposit_liquidity(ref self: ContractState, amount_cents: u128) -> u128 {
            assert(amount_cents > 0_u128, 'VAULT: DEPOSIT_ZERO');
            let caller = get_caller_address();
            let token = self.collateral_token.read();

            // Pull USDC from LP
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }
                .transfer_from(caller, get_contract_address(), token_units);
            assert(success, 'VAULT: TRANSFER_FROM_FAILED');

            let current_nav = self.lp_pool_nav.read();
            let current_shares = self.total_lp_shares.read();

            // Proportional Share Pricing Math (Section 6.4)
            // Initial Bootstrap: 1 USDC ( = 100 cents) = 1 share (scaled by SHARE_SCALE)
            let shares_to_mint = if current_shares == 0_u128 || current_nav == 0_u128 {
                amount_cents * (SHARE_SCALE / 100_u128)
            } else {
                (amount_cents * current_shares) / current_nav
            };
            assert(shares_to_mint > 0_u128, 'VAULT: ZERO_SHARES_MINTED');

            let new_nav = current_nav + amount_cents;
            let new_shares = current_shares + shares_to_mint;

            self.lp_pool_nav.write(new_nav);
            self.total_lp_shares.write(new_shares);
            self.lp_shares_balances.write(caller, self.lp_shares_balances.read(caller) + shares_to_mint);
            self.deposit_timestamps.write(caller, get_block_timestamp());

            self.emit(LiquidityDeposited {
                provider: caller,
                amount_cents,
                shares_minted: shares_to_mint,
                new_pool_nav: new_nav,
                new_total_shares: new_shares,
            });

            shares_to_mint
        }

        fn request_withdrawal(ref self: ContractState, shares: u128) -> u64 {
            assert(shares > 0_u128, 'VAULT: WITHDRAW_ZERO');
            let caller = get_caller_address();
            let user_shares = self.lp_shares_balances.read(caller);
            assert(user_shares >= shares, 'VAULT: INSUFFICIENT_SHARES');

            // Enforce Withdrawal Cooldown (Section 6.6)
            let deposit_time = self.deposit_timestamps.read(caller);
            let now = get_block_timestamp();
            assert(now >= deposit_time + WITHDRAWAL_COOLDOWN_SECS, 'VAULT: COOLDOWN_ACTIVE');

            let nav = self.lp_pool_nav.read();
            let total_shares = self.total_lp_shares.read();
            assert(total_shares > 0_u128 && nav > 0_u128, 'VAULT: POOL_EMPTY');

            let gross_cents = (shares * nav) / total_shares;
            assert(gross_cents > 0_u128, 'VAULT: ZERO_GROSS_PAYOUT');

            // Solvency Gate: Ensure withdrawal does not breach required reserves (Section 6.5 & 15.1)
            let avail = self.get_available_liquidity();
            assert(avail >= gross_cents, 'VAULT: INSUFFICIENT_FREE_LIQ');

            // Lock shares from user balance
            self.lp_shares_balances.write(caller, user_shares - shares);
            self.pending_withdrawals_total.write(self.pending_withdrawals_total.read() + gross_cents);

            let request_id = self.withdrawal_request_count.read() + 1_u64;
            self.withdrawal_request_count.write(request_id);

            let req = WithdrawalRequest {
                provider: caller,
                shares,
                gross_cents,
                request_timestamp: now,
                is_claimed: false,
            };
            self.withdrawal_requests.write(request_id, req);

            self.emit(WithdrawalRequested {
                request_id,
                provider: caller,
                shares,
                gross_cents,
            });

            request_id
        }

        fn claim_withdrawal(ref self: ContractState, request_id: u64) -> u128 {
            let caller = get_caller_address();
            let mut req = self.withdrawal_requests.read(request_id);
            assert(!req.is_claimed, 'VAULT: ALREADY_CLAIMED');
            assert(req.provider == caller, 'VAULT: NOT_REQUEST_OWNER');

            req.is_claimed = true;
            self.withdrawal_requests.write(request_id, req);

            let nav = self.lp_pool_nav.read();
            let total_shares = self.total_lp_shares.read();
            let gross_cents = req.gross_cents;
            let shares = req.shares;

            // Burn shares and deduct NAV
            if nav >= gross_cents {
                self.lp_pool_nav.write(nav - gross_cents);
            } else {
                self.lp_pool_nav.write(0_u128);
            }

            if total_shares >= shares {
                self.total_lp_shares.write(total_shares - shares);
            } else {
                self.total_lp_shares.write(0_u128);
            }

            self.pending_withdrawals_total.write(self.pending_withdrawals_total.read() - gross_cents);

            // Transfer USDC to provider
            let token = self.collateral_token.read();
            let token_units: u256 = (gross_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }.transfer(caller, token_units);
            assert(success, 'VAULT: TRANSFER_FAILED');

            self.emit(WithdrawalClaimed {
                request_id,
                provider: caller,
                amount_cents: gross_cents,
            });

            gross_cents
        }

        fn get_lp_shares_balance(self: @ContractState, provider: ContractAddress) -> u128 {
            self.lp_shares_balances.read(provider)
        }

        fn get_total_lp_shares(self: @ContractState) -> u128 {
            self.total_lp_shares.read()
        }

        fn get_pool_nav(self: @ContractState) -> u128 {
            self.lp_pool_nav.read()
        }

        fn get_share_price_e6(self: @ContractState) -> u128 {
            let total = self.total_lp_shares.read();
            let nav = self.lp_pool_nav.read();
            if total == 0_u128 {
                SHARE_SCALE
            } else {
                (nav * SHARE_SCALE * 10000_u128) / total
            }
        }

        fn get_available_liquidity(self: @ContractState) -> u128 {
            let nav = self.lp_pool_nav.read();
            let locked = self.total_locked_collateral.read();
            let reserve_buf = (locked * RESERVE_BUFFER_BPS) / 10000_u128;
            let pending_payouts = self.unclaimed_payouts_total.read();
            let pending_bounties = self.unclaimed_bounties_total.read();
            let pending_withdr = self.pending_withdrawals_total.read();

            let total_obligations = reserve_buf + pending_payouts + pending_bounties + pending_withdr;
            if nav > total_obligations {
                nav - total_obligations
            } else {
                0_u128
            }
        }

        fn get_locked_liquidity(self: @ContractState) -> u128 {
            self.total_locked_collateral.read()
        }

        fn get_utilization_bps(self: @ContractState) -> u16 {
            let nav = self.lp_pool_nav.read();
            let locked = self.total_locked_collateral.read();
            if nav == 0_u128 {
                if locked > 0_u128 { 10000_u16 } else { 0_u16 }
            } else {
                let ratio = (locked * 10000_u128) / nav;
                if ratio > 10000_u128 { 10000_u16 } else { ratio.try_into().unwrap() }
            }
        }

        fn get_withdrawal_request(self: @ContractState, request_id: u64) -> WithdrawalRequest {
            self.withdrawal_requests.read(request_id)
        }

        fn get_pending_withdrawals_total(self: @ContractState) -> u128 {
            self.pending_withdrawals_total.read()
        }

        fn lock_trader_margin(ref self: ContractState, margin_cents: u128) {
            self.assert_pel_core();
            self.total_locked_collateral.write(self.total_locked_collateral.read() + margin_cents);
        }

        fn release_trader_margin(ref self: ContractState, margin_cents: u128) {
            self.assert_pel_core();
            let locked = self.total_locked_collateral.read();
            if locked >= margin_cents {
                self.total_locked_collateral.write(locked - margin_cents);
            } else {
                self.total_locked_collateral.write(0_u128);
            }
        }

        fn settle_trader_pnl(
            ref self: ContractState,
            pnl_cents: u128,
            is_profit: bool,
            recipient_note_commitment: felt252,
            recipient: ContractAddress
        ) {
            self.assert_pel_core();
            let current_nav = self.lp_pool_nav.read();

            if is_profit {
                // Trader Wins: LP Pool pays profit (Section 4.2 & 4.3)
                if current_nav >= pnl_cents {
                    self.lp_pool_nav.write(current_nav - pnl_cents);
                } else {
                    // Pool deficit -> absorbs bad debt from insurance if available
                    let deficit = pnl_cents - current_nav;
                    self.lp_pool_nav.write(0_u128);
                    let ins_addr = self.insurance_reserve.read();
                    if ins_addr != 0.try_into().unwrap() {
                        let _ = IPELInsuranceReserveDispatcher { contract_address: ins_addr }.absorb_bad_debt(deficit);
                    }
                }

                // Register payout note
                if pnl_cents > 0_u128 && recipient_note_commitment != 0 {
                    self.registered_notes.write(recipient_note_commitment, pnl_cents);
                    self.registered_note_recipients.write(recipient_note_commitment, recipient);
                    self.unclaimed_payouts_total.write(self.unclaimed_payouts_total.read() + pnl_cents);
                }
            } else {
                // Trader Loses: 70% to LP NAV, 20% to Insurance, 10% to Treasury (Section 9.2)
                let lp_share = (pnl_cents * 7000_u128) / 10000_u128;
                let insurance_share = (pnl_cents * 2000_u128) / 10000_u128;
                let _treasury_share = pnl_cents - lp_share - insurance_share;

                self.lp_pool_nav.write(current_nav + lp_share);

                let ins_addr = self.insurance_reserve.read();
                if ins_addr != 0.try_into().unwrap() && insurance_share > 0_u128 {
                    IPELInsuranceReserveDispatcher { contract_address: ins_addr }.deposit_fee_contribution(insurance_share);
                }
            }

            self.emit(TraderPnLSettled {
                pnl_cents,
                is_profit,
                new_pool_nav: self.lp_pool_nav.read(),
            });
        }

        fn settle_funding(ref self: ContractState, amount_cents: u128, is_long_pays: bool) {
            self.assert_pel_core();
            let current_nav = self.lp_pool_nav.read();
            if is_long_pays {
                // Longs pay counterparty -> LP NAV increases (Section 8.3)
                self.lp_pool_nav.write(current_nav + amount_cents);
            } else {
                // Counterparty pays longs -> LP NAV decreases
                if current_nav >= amount_cents {
                    self.lp_pool_nav.write(current_nav - amount_cents);
                } else {
                    self.lp_pool_nav.write(0_u128);
                }
            }

            self.emit(FundingSettled {
                amount_cents,
                is_long_pays,
                new_pool_nav: self.lp_pool_nav.read(),
            });
        }

        fn settle_liquidation(
            ref self: ContractState,
            seized_collateral_cents: u128,
            keeper_bounty_cents: u128,
            keeper_recipient: ContractAddress
        ) {
            self.assert_pel_core();
            let net_seized = if seized_collateral_cents >= keeper_bounty_cents {
                seized_collateral_cents - keeper_bounty_cents
            } else {
                0_u128
            };

            // Credit Keeper Bounty
            if keeper_bounty_cents > 0_u128 {
                self.keeper_bounties.write(keeper_recipient, self.keeper_bounties.read(keeper_recipient) + keeper_bounty_cents);
                self.unclaimed_bounties_total.write(self.unclaimed_bounties_total.read() + keeper_bounty_cents);
            }

            // Distribute Remnants: 70% to LP NAV, 20% to Insurance, 10% to Treasury (Section 9.3 & 10.3)
            let lp_share = (net_seized * 7000_u128) / 10000_u128;
            let insurance_share = (net_seized * 2000_u128) / 10000_u128;

            self.lp_pool_nav.write(self.lp_pool_nav.read() + lp_share);

            let ins_addr = self.insurance_reserve.read();
            if ins_addr != 0.try_into().unwrap() && insurance_share > 0_u128 {
                IPELInsuranceReserveDispatcher { contract_address: ins_addr }.deposit_liquidation_remnant(insurance_share);
            }

            self.emit(LiquidationSettled {
                seized_cents: seized_collateral_cents,
                bounty_cents: keeper_bounty_cents,
                lp_share_cents: lp_share,
                insurance_share_cents: insurance_share,
            });
        }

        fn claim_payout_note(ref self: ContractState, payout_nullifier: felt252, recipient_note_commitment: felt252) {
            assert(!self.used_payout_nullifiers.read(payout_nullifier), 'VAULT: NULLIFIER_SPENT');
            assert(!self.claimed_notes.read(recipient_note_commitment), 'VAULT: NOTE_ALREADY_CLAIMED');

            let amount_cents = self.registered_notes.read(recipient_note_commitment);
            assert(amount_cents > 0_u128, 'VAULT: NOTE_NOT_FOUND');

            let caller = get_caller_address();
            let note_recipient = self.registered_note_recipients.read(recipient_note_commitment);
            if note_recipient != 0.try_into().unwrap() {
                assert(caller == note_recipient, 'VAULT: UNAUTHORIZED_RECIPIENT');
            }

            self.used_payout_nullifiers.write(payout_nullifier, true);
            self.claimed_notes.write(recipient_note_commitment, true);
            self.unclaimed_payouts_total.write(self.unclaimed_payouts_total.read() - amount_cents);

            let token = self.collateral_token.read();
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }.transfer(caller, token_units);
            assert(success, 'VAULT: TRANSFER_FAILED');

            self.emit(PayoutClaimed {
                recipient: caller,
                commitment: recipient_note_commitment,
                amount_cents,
            });
        }

        fn claim_keeper_bounty(ref self: ContractState, keeper_recipient: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == keeper_recipient, 'VAULT: CALLER_NOT_KEEPER');
            let amount_cents = self.keeper_bounties.read(keeper_recipient);
            assert(amount_cents > 0_u128, 'VAULT: NO_BOUNTY_AVAILABLE');

            self.keeper_bounties.write(keeper_recipient, 0_u128);
            self.unclaimed_bounties_total.write(self.unclaimed_bounties_total.read() - amount_cents);

            let token = self.collateral_token.read();
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }.transfer(keeper_recipient, token_units);
            assert(success, 'VAULT: TRANSFER_FAILED');

            self.emit(BountyClaimed {
                keeper: keeper_recipient,
                amount_cents,
            });
        }

        fn get_keeper_bounty_balance(self: @ContractState, keeper: ContractAddress) -> u128 {
            self.keeper_bounties.read(keeper)
        }

        fn get_registered_note_amount(self: @ContractState, commitment: felt252) -> u128 {
            self.registered_notes.read(commitment)
        }

        fn get_registered_note_recipient(self: @ContractState, commitment: felt252) -> ContractAddress {
            self.registered_note_recipients.read(commitment)
        }

        fn is_note_claimed(self: @ContractState, commitment: felt252) -> bool {
            self.claimed_notes.read(commitment)
        }

        fn set_pel_core_address(ref self: ContractState, pel_core: ContractAddress) {
            self.assert_admin();
            self.pel_core_address.write(pel_core);
        }

        fn set_insurance_reserve(ref self: ContractState, insurance: ContractAddress) {
            self.assert_admin();
            self.insurance_reserve.write(insurance);
        }

        fn set_treasury_address(ref self: ContractState, treasury: ContractAddress) {
            self.assert_admin();
            self.treasury_address.write(treasury);
        }

        fn set_collateral_token(ref self: ContractState, token: ContractAddress) {
            self.assert_admin();
            self.collateral_token.write(token);
        }

        fn get_collateral_token(self: @ContractState) -> ContractAddress {
            self.collateral_token.read()
        }
    }

    #[generate_trait]
    impl InternalMethods of InternalMethodsTrait {
        fn assert_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'VAULT: CALLER_NOT_ADMIN');
        }

        fn assert_pel_core(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'VAULT: UNAUTHORIZED_CORE');
        }
    }
}
