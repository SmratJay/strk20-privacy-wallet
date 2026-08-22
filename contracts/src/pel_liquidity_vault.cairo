// PEL Liquidity & Counterparty Vault — V2.0 (Canonical Economic Counterparty)
//
// ============================================================================
// CANONICAL ECONOMIC MODEL (V2)
// ============================================================================
//
// The vault is the SINGLE custody + accounting boundary for protocol economic
// value that is not trader margin inside the STRK20 privacy pool.
//
// UNITS
//   - NAV units:        integer USD cents ($1.00 = 100 cents)
//   - ERC20 base units: collateral token base units (TestUSDC: 6 decimals)
//   - Token multiplier: 1 cent = 10_000 base units (TOKEN_DECIMAL_MULTIPLIER)
//   - Share units:      1 USD at bootstrap = SHARE_SCALE (1e6) shares
//                        1 cent at bootstrap = SHARE_SCALE / 100 = 10_000 shares
//   - Share price:      e6 fixed point of USD per share:
//                         sharePriceE6 = NAV_cents * 1e6 * 1e4 / total_shares
//
// BUCKETS (each is a distinct economic concept — never reused):
//   - lp_pool_nav                 LP economic value (shareholders' equity)
//   - total_locked_collateral     PUBLIC trader margins (real vault-held USDC)
//   - pool_margin_cents           SHIELDED trader claims on the STRK20 pool
//   - pool_assets_cents           real USDC held by the STRK20 pool for PEL
//   - unclaimed_payouts_total     payout note obligations owed to traders
//   - unclaimed_bounties_total    keeper bounty obligations
//   - pending_withdrawals_total   LP withdrawal obligations (Model A queue)
//   - treasury_balance            protocol treasury allocation
//   - bad_debt_total              cumulative unresolved deficit ledger (NOT an
//                                 asset — records value destroyed by insolvency)
//
// GLOBAL CONSERVATION INVARIANT (cents):
//   vault_token_balance_cents + pool_assets_cents
//     == total_locked_collateral + pool_margin_cents + lp_pool_nav
//        + unclaimed_payouts_total + unclaimed_bounties_total
//        + pending_withdrawals_total + treasury_balance
//
// ECONOMIC NAV (share value):
//   NAV = vault_tokens + pool_assets - (locked + pool_margin + payouts
//         + bounties + withdrawals + treasury)
//
// COUNTERPARTY PnL (Phase 3 resolution):
//   - Trader loss  -> LP receives the FULL loss (lp_pool_nav += loss)
//   - Trader profit-> LP pays the FULL profit (lp_pool_nav -= profit)
//   Protocol REVENUE (liquidation remnants) is split:
//     70% LP / 20% insurance (real transfer) / 10% treasury (bucket)
//   Every cent has a destination — nothing is computed and discarded.
//
// WITHDRAWAL QUEUE (Phase 11, Model A):
//   Shares are burned at request, removed from total_lp_shares immediately, and
//   the NAV is reduced by the frozen gross value at request time. Queued shares
//   never participate in subsequent PnL.
//
// AUTHORIZATION:
//   - LP ops: caller == owner
//   - settlement (lock/release/pnl/funding/liquidation): ONLY PELPerpsCore.
//   - insurance/token/treasury config: ONLY admin.
//   - admin is NOT a settlement superuser (assert_pel_core does not grant admin).
// ============================================================================

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
    fn get_economic_nav(self: @TContractState) -> u128;
    fn get_share_price_e6(self: @TContractState) -> u128;
    fn get_available_liquidity(self: @TContractState) -> u128;
    fn get_locked_liquidity(self: @TContractState) -> u128;
    fn get_utilization_bps(self: @TContractState) -> u16;
    fn get_withdrawal_request(self: @TContractState, request_id: u64) -> WithdrawalRequest;
    fn get_pending_withdrawals_total(self: @TContractState) -> u128;
    fn get_treasury_balance(self: @TContractState) -> u128;
    fn get_bad_debt_total(self: @TContractState) -> u128;
    fn get_pool_receivable(self: @TContractState) -> u128;
    fn get_pool_assets(self: @TContractState) -> u128;
    fn get_pool_margin(self: @TContractState) -> u128;
    fn get_solvency_snapshot(
        self: @TContractState
    ) -> (u256, u128, u128, u128, u128, u128, u128, bool);

    // Core Counterparty Settlement (Restricted to PELPerpsCore)
    fn lock_trader_margin(
        ref self: TContractState,
        collateral_owner: ContractAddress,
        nullifier: felt252,
        margin_cents: u128,
    );
    fn lock_pool_custodied_margin(ref self: TContractState, nullifier: felt252, margin_cents: u128);
    fn release_trader_margin(
        ref self: TContractState,
        collateral_owner: ContractAddress,
        nullifier: felt252,
        margin_cents: u128,
        is_pool_custodied: bool,
    );
    fn settle_trader_pnl(
        ref self: TContractState,
        position_margin_cents: u128,
        payout_cents: u128,
        recipient_note_commitment: felt252,
        recipient: ContractAddress,
        is_pool_custodied: bool,
    );
    fn settle_funding(
        ref self: TContractState,
        amount_cents: u128,
        is_long_pays: bool,
        is_pool_custodied: bool,
    );
    fn settle_liquidation(
        ref self: TContractState,
        seized_collateral_cents: u128,
        keeper_bounty_cents: u128,
        keeper_recipient: ContractAddress,
        insurance_deficit_cents: u128,
        is_pool_custodied: bool,
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
    fn set_pool_custodian(ref self: TContractState, custodian: ContractAddress);
    fn get_collateral_token(self: @TContractState) -> ContractAddress;
    fn get_contract_token_balance(self: @TContractState) -> u256;
    fn withdraw_treasury(ref self: TContractState, amount_cents: u128);
    fn collect_pool_receivable(ref self: TContractState, amount_cents: u128);
}

#[starknet::contract]
pub mod PELLiquidityVault {
    use super::{IPELLiquidityVault, WithdrawalRequest};
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::super::pel_insurance_reserve::{IPELInsuranceReserveDispatcher, IPELInsuranceReserveDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const SHARE_SCALE: u128 = 1000000_u128;              // 1e6 share scale (1 USD = 1e6 shares)
    const TOKEN_DECIMAL_MULTIPLIER: u128 = 10000_u128;   // 1 cent = 10,000 micro-USDC (6 decimals)
    const RESERVE_BUFFER_BPS: u128 = 5000_u128;          // 50% locked margin reserve buffer
    const WITHDRAWAL_COOLDOWN_SECS: u64 = 3600_u64;      // 1 hour (1 funding epoch) cooldown
    const MAX_UTILIZATION_BPS: u16 = 8500_u16;           // 85% max pool utilization cap
    const MAX_LEVERAGE: u128 = 50_u128;                  // nominal max leverage (matches MarketConfig)
    const MAX_SINGLE_POSITION_BPS: u128 = 500_u128;      // 5% LP NAV single-position notional cap
    const KEEPER_BOUNTY_BPS: u128 = 200_u128;            // 2% liquidation bounty
    const KEEPER_BOUNTY_CAP_CENTS: u128 = 50000_u128;    // $500.00 cap
    const LP_FEE_SHARE_BPS: u128 = 7000_u128;            // 70% protocol revenue -> LP NAV
    const INSURANCE_FEE_SHARE_BPS: u128 = 2000_u128;     // 20% protocol revenue -> insurance
    const TREASURY_FEE_SHARE_BPS: u128 = 1000_u128;      // 10% protocol revenue -> treasury

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        insurance_reserve: ContractAddress,
        treasury_address: ContractAddress,
        collateral_token: ContractAddress,
        pool_custodian: ContractAddress,

        // Core Accounting Buckets (in cents)
        lp_pool_nav: u128,
        total_lp_shares: u128,
        total_locked_collateral: u128,    // PUBLIC margins (vault-held USDC)
        pool_margin_cents: u128,          // SHIELDED trader claims (backed by pool)
        pool_assets_cents: u128,          // real USDC held by the STRK20 pool for PEL
        unclaimed_payouts_total: u128,
        unclaimed_bounties_total: u128,
        pending_withdrawals_total: u128,
        treasury_balance: u128,
        bad_debt_total: u128,

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

        // Margin replay protection
        used_margin_nullifiers: Map<felt252, bool>,
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
        TreasuryWithdrawn: TreasuryWithdrawn,
        PoolReceivableCollected: PoolReceivableCollected,
        BadDebtRecorded: BadDebtRecorded,
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
        pub margin_cents: u128,
        pub payout_cents: u128,
        pub profit_cents: u128,
        pub loss_cents: u128,
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
        pub treasury_share_cents: u128,
        pub insurance_absorbed_cents: u128,
        pub bad_debt_cents: u128,
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

    #[derive(Drop, starknet::Event)]
    pub struct TreasuryWithdrawn {
        pub to: ContractAddress,
        pub amount_cents: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PoolReceivableCollected {
        pub from: ContractAddress,
        pub amount_cents: u128,
        pub new_pool_assets: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BadDebtRecorded {
        pub amount_cents: u128,
        pub cumulative: u128,
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
        self.pool_margin_cents.write(0_u128);
        self.pool_assets_cents.write(0_u128);
        self.unclaimed_payouts_total.write(0_u128);
        self.unclaimed_bounties_total.write(0_u128);
        self.pending_withdrawals_total.write(0_u128);
        self.treasury_balance.write(0_u128);
        self.bad_debt_total.write(0_u128);
        self.withdrawal_request_count.write(0_u64);
        self.pool_custodian.write(admin);
    }

    #[abi(embed_v0)]
    impl PELLiquidityVaultImpl of IPELLiquidityVault<ContractState> {
        fn deposit_liquidity(ref self: ContractState, amount_cents: u128) -> u128 {
            assert(amount_cents > 0_u128, 'VAULT: DEPOSIT_ZERO');
            let caller = get_caller_address();
            let token = self.collateral_token.read();

            // Pull real USDC from LP
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }
                .transfer_from(caller, get_contract_address(), token_units);
            assert(success, 'VAULT: TRANSFER_FROM_FAILED');

            let current_nav = self.lp_pool_nav.read();
            let current_shares = self.total_lp_shares.read();

            // Proportional Share Pricing (canonical, matches Rust + TypeScript):
            // Bootstrap: 1 cent -> SHARE_SCALE/100 = 10,000 shares (1 USD = 1e6 shares).
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

        // Model A withdrawal queue: shares burned at request, NAV reduced at
        // request by the frozen gross value. Queued shares do NOT participate in
        // subsequent PnL. Claim only transfers real USDC.
        fn request_withdrawal(ref self: ContractState, shares: u128) -> u64 {
            assert(shares > 0_u128, 'VAULT: WITHDRAW_ZERO');
            let caller = get_caller_address();
            let user_shares = self.lp_shares_balances.read(caller);
            assert(user_shares >= shares, 'VAULT: INSUFFICIENT_SHARES');

            // Enforce Withdrawal Cooldown (1 funding epoch)
            let deposit_time = self.deposit_timestamps.read(caller);
            let now = get_block_timestamp();
            assert(now >= deposit_time + WITHDRAWAL_COOLDOWN_SECS, 'VAULT: COOLDOWN_ACTIVE');

            let nav = self.lp_pool_nav.read();
            let total_shares = self.total_lp_shares.read();
            assert(total_shares > 0_u128 && nav > 0_u128, 'VAULT: POOL_EMPTY');

            let gross_cents = (shares * nav) / total_shares;
            assert(gross_cents > 0_u128, 'VAULT: ZERO_GROSS_PAYOUT');

            // Solvency gate: ensure the frozen obligation is backed by free real liquidity.
            let avail = self.get_available_liquidity();
            assert(avail >= gross_cents, 'VAULT: INSUFFICIENT_FREE_LIQ');

            // Model A: burn shares now and reduce NAV by the frozen value.
            self.lp_shares_balances.write(caller, user_shares - shares);
            self.total_lp_shares.write(total_shares - shares);
            self.lp_pool_nav.write(nav - gross_cents);
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

            let gross_cents = req.gross_cents;
            let pending = self.pending_withdrawals_total.read();
            assert(pending >= gross_cents, 'VAULT: ACCOUNTING_MISMATCH');
            self.pending_withdrawals_total.write(pending - gross_cents);

            // Transfer real USDC to provider (shares/NAV already burned at request).
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

        // Economic NAV = LP share value backed by real assets net of obligations.
        fn get_economic_nav(self: @ContractState) -> u128 {
            let tokens = self.token_balance_cents();
            let pool_assets = self.pool_assets_cents.read();
            let locked = self.total_locked_collateral.read();
            let pool_margin = self.pool_margin_cents.read();
            let payouts = self.unclaimed_payouts_total.read();
            let bounties = self.unclaimed_bounties_total.read();
            let withdrawals = self.pending_withdrawals_total.read();
            let treasury = self.treasury_balance.read();

            let assets = tokens + pool_assets;
            let obligations = locked + pool_margin + payouts + bounties + withdrawals + treasury;
            if assets > obligations {
                assets - obligations
            } else {
                0_u128
            }
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

        // Available liquidity = real free vault-held USDC beyond locked margins,
        // obligations, and the counterparty reserve buffer. No double-counting.
        fn get_available_liquidity(self: @ContractState) -> u128 {
            let tokens = self.token_balance_cents();
            let locked = self.total_locked_collateral.read();
            let pool_margin = self.pool_margin_cents.read();
            let reserve_buf = ((locked + pool_margin) * RESERVE_BUFFER_BPS) / 10000_u128;
            let pending_payouts = self.unclaimed_payouts_total.read();
            let pending_bounties = self.unclaimed_bounties_total.read();
            let pending_withdr = self.pending_withdrawals_total.read();
            let treasury = self.treasury_balance.read();

            let total_obligations = locked + reserve_buf + pending_payouts + pending_bounties + pending_withdr + treasury;
            if tokens > total_obligations {
                tokens - total_obligations
            } else {
                0_u128
            }
        }

        fn get_locked_liquidity(self: @ContractState) -> u128 {
            self.total_locked_collateral.read() + self.pool_margin_cents.read()
        }

        fn get_utilization_bps(self: @ContractState) -> u16 {
            let nav = self.lp_pool_nav.read();
            let locked = self.total_locked_collateral.read() + self.pool_margin_cents.read();
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

        fn get_treasury_balance(self: @ContractState) -> u128 {
            self.treasury_balance.read()
        }

        fn get_bad_debt_total(self: @ContractState) -> u128 {
            self.bad_debt_total.read()
        }

        // Net receivable from the STRK20 pool domain: real pool-held assets minus
        // trader claims. Only the positive surplus is realizable.
        fn get_pool_receivable(self: @ContractState) -> u128 {
            let assets = self.pool_assets_cents.read();
            let margin = self.pool_margin_cents.read();
            if assets > margin { assets - margin } else { 0_u128 }
        }

        fn get_pool_assets(self: @ContractState) -> u128 {
            self.pool_assets_cents.read()
        }

        fn get_pool_margin(self: @ContractState) -> u128 {
            self.pool_margin_cents.read()
        }

        // (token_balance_u256, locked_cents, lp_nav, unclaimed_payouts, unclaimed_bounties,
        //  pending_withdrawals, treasury, is_solvent)
        fn get_solvency_snapshot(
            self: @ContractState
        ) -> (u256, u128, u128, u128, u128, u128, u128, bool) {
            let token_balance = self.get_contract_token_balance();
            let tokens_cents = self.token_balance_cents();
            let pool_assets = self.pool_assets_cents.read();
            let locked = self.total_locked_collateral.read();
            let pool_margin = self.pool_margin_cents.read();
            let lp_nav = self.lp_pool_nav.read();
            let payouts = self.unclaimed_payouts_total.read();
            let bounties = self.unclaimed_bounties_total.read();
            let withdrawals = self.pending_withdrawals_total.read();
            let treasury = self.treasury_balance.read();
            let bad_debt = self.bad_debt_total.read();

            let total_assets_cents = tokens_cents + pool_assets;
            let total_liabilities_cents = locked + pool_margin + lp_nav + payouts + bounties + withdrawals + treasury + bad_debt;
            let is_solvent = total_assets_cents >= total_liabilities_cents;

            (token_balance, locked + pool_margin, lp_nav, payouts, bounties, withdrawals, treasury, is_solvent)
        }

        // ─── CORE SETTLEMENT (PELPerpsCore only — admin has NO settlement authority) ──

        fn lock_trader_margin(
            ref self: ContractState,
            collateral_owner: ContractAddress,
            nullifier: felt252,
            margin_cents: u128,
        ) {
            self.assert_pel_core();
            assert(margin_cents > 0_u128, 'VAULT: INVALID_MARGIN');
            assert(!self.used_margin_nullifiers.read(nullifier), 'VAULT: MARGIN_NULLIFIER_USED');

            // Protocol-enforced risk gates (Phases 12-14). Conservative single-position
            // cap: margin * MAX_LEVERAGE <= MAX_SINGLE_POSITION_BPS * NAV / 10000, which
            // guarantees position notional <= 5% NAV for any leverage <= MAX_LEVERAGE.
            let nav = self.lp_pool_nav.read();
            let max_single_margin = (nav * MAX_SINGLE_POSITION_BPS) / (10000_u128 * MAX_LEVERAGE);
            assert(margin_cents <= max_single_margin, 'VAULT: SINGLE_POSITION_CAP');

            let locked = self.total_locked_collateral.read() + self.pool_margin_cents.read();
            let util_after = ((locked + margin_cents) * 10000_u128) / nav;
            assert(util_after <= MAX_UTILIZATION_BPS.into(), 'VAULT: UTILIZATION_LIMIT');

            // Real custody: pull the trader's margin USDC into the vault.
            let token = self.collateral_token.read();
            let token_units: u256 = (margin_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let success = IERC20Dispatcher { contract_address: token }
                .transfer_from(collateral_owner, get_contract_address(), token_units);
            assert(success, 'VAULT: MARGIN_TRANSFER_FAILED');

            self.used_margin_nullifiers.write(nullifier, true);
            self.total_locked_collateral.write(self.total_locked_collateral.read() + margin_cents);
        }

        // Shielded (STRK20 pool-custodied) margin: recorded as a pool receivable.
        fn lock_pool_custodied_margin(ref self: ContractState, nullifier: felt252, margin_cents: u128) {
            self.assert_pel_core();
            assert(margin_cents > 0_u128, 'VAULT: INVALID_MARGIN');
            assert(!self.used_margin_nullifiers.read(nullifier), 'VAULT: MARGIN_NULLIFIER_USED');

            let nav = self.lp_pool_nav.read();
            let max_single_margin = (nav * MAX_SINGLE_POSITION_BPS) / (10000_u128 * MAX_LEVERAGE);
            assert(margin_cents <= max_single_margin, 'VAULT: SINGLE_POSITION_CAP');

            let locked = self.total_locked_collateral.read() + self.pool_margin_cents.read();
            let util_after = ((locked + margin_cents) * 10000_u128) / nav;
            assert(util_after <= MAX_UTILIZATION_BPS.into(), 'VAULT: UTILIZATION_LIMIT');

            self.used_margin_nullifiers.write(nullifier, true);
            // The pool holds the trader's USDC; record the claim and the physical asset.
            self.pool_margin_cents.write(self.pool_margin_cents.read() + margin_cents);
            self.pool_assets_cents.write(self.pool_assets_cents.read() + margin_cents);
        }

        fn release_trader_margin(
            ref self: ContractState,
            collateral_owner: ContractAddress,
            nullifier: felt252,
            margin_cents: u128,
            is_pool_custodied: bool,
        ) {
            self.assert_pel_core();
            if is_pool_custodied {
                let cur = self.pool_margin_cents.read();
                assert(cur >= margin_cents, 'VAULT: INSUFF_POOL_MARGIN');
                self.pool_margin_cents.write(cur - margin_cents);
            } else {
                let cur = self.total_locked_collateral.read();
                assert(cur >= margin_cents, 'VAULT: INSUFF_LOCKED_MARGIN');
                self.total_locked_collateral.write(cur - margin_cents);

                // Real push: return the margin USDC to the owner.
                let token = self.collateral_token.read();
                let token_units: u256 = (margin_cents * TOKEN_DECIMAL_MULTIPLIER).into();
                let success = IERC20Dispatcher { contract_address: token }
                    .transfer(collateral_owner, token_units);
                assert(success, 'VAULT: TRANSFER_FAILED');
            }
        }

        // Canonical counterparty PnL settlement.
        //   profit = payout > margin  -> LP pays full profit
        //   loss   = margin > payout  -> LP receives full loss
        // Every cent has a destination.
        fn settle_trader_pnl(
            ref self: ContractState,
            position_margin_cents: u128,
            payout_cents: u128,
            recipient_note_commitment: felt252,
            recipient: ContractAddress,
            is_pool_custodied: bool,
        ) {
            self.assert_pel_core();

            // Release the position margin.
            if is_pool_custodied {
                let cur_margin = self.pool_margin_cents.read();
                assert(cur_margin >= position_margin_cents, 'VAULT: INSUFF_POOL_MARGIN');
                // The pool still physically holds the margin; it becomes protocol surplus
                // (pool_assets - pool_margin grows) that the operator sweeps to the vault.
                self.pool_margin_cents.write(cur_margin - position_margin_cents);
            } else {
                let cur_locked = self.total_locked_collateral.read();
                assert(cur_locked >= position_margin_cents, 'VAULT: INSUFF_LOCKED_MARGIN');
                // Tokens stay in the vault: they back the payout note (if any) and the
                // realized LP gain. No token movement needed here.
                self.total_locked_collateral.write(cur_locked - position_margin_cents);
            }

            let profit_cents = if payout_cents > position_margin_cents {
                payout_cents - position_margin_cents
            } else {
                0_u128
            };
            let loss_cents = if position_margin_cents > payout_cents {
                position_margin_cents - payout_cents
            } else {
                0_u128
            };

            let mut nav = self.lp_pool_nav.read();
            if profit_cents > 0_u128 {
                if nav >= profit_cents {
                    nav = nav - profit_cents;
                } else {
                    // LP absorbs what it can (lp_contribution = nav).
                    // Insurance absorbs the remaining deficit with REAL USDC.
                    // If combined LP + insurance backing is insufficient, the close REVERTS.
                    let lp_contribution = nav;
                    let deficit = profit_cents - nav;
                    let absorbed = self.absorb_bad_debt(deficit);
                    if lp_contribution + absorbed < profit_cents {
                        core::panic_with_felt252('VAULT: INSUFFICIENT_NAV');
                    }
                    nav = 0_u128;
                }
            }
            if loss_cents > 0_u128 {
                nav = nav + loss_cents;
            }
            self.lp_pool_nav.write(nav);

            // Register the payout note (real USDC claimable from the vault).
            if payout_cents > 0_u128 && recipient_note_commitment != 0 {
                self.registered_notes.write(recipient_note_commitment, payout_cents);
                self.registered_note_recipients.write(recipient_note_commitment, recipient);
                self.unclaimed_payouts_total.write(self.unclaimed_payouts_total.read() + payout_cents);
            }

            self.emit(TraderPnLSettled {
                margin_cents: position_margin_cents,
                payout_cents,
                profit_cents,
                loss_cents,
                new_pool_nav: nav,
            });
        }

        // Funding clearing: counterparty (LP) vs trader. 100% counterparty PnL.
        fn settle_funding(
            ref self: ContractState,
            amount_cents: u128,
            is_long_pays: bool,
            is_pool_custodied: bool,
        ) {
            self.assert_pel_core();
            assert(amount_cents > 0_u128, 'VAULT: INVALID_FUNDING');
            let current_nav = self.lp_pool_nav.read();

            if is_long_pays {
                // Trader pays funding -> LP gains.
                if is_pool_custodied {
                    // The trader's claim on the pool shrinks; pool surplus grows.
                    let cur = self.pool_margin_cents.read();
                    assert(cur >= amount_cents, 'VAULT: INSUFF_POOL_MARGIN');
                    self.pool_margin_cents.write(cur - amount_cents);
                } else {
                    let cur = self.total_locked_collateral.read();
                    assert(cur >= amount_cents, 'VAULT: INSUFF_LOCKED_MARGIN');
                    self.total_locked_collateral.write(cur - amount_cents);
                }
                self.lp_pool_nav.write(current_nav + amount_cents);
            } else {
                // Counterparty pays trader funding -> LP pays.
                if is_pool_custodied {
                    // The trader's claim on the pool grows (backed by LP-funded value).
                    self.pool_margin_cents.write(self.pool_margin_cents.read() + amount_cents);
                } else {
                    self.total_locked_collateral.write(self.total_locked_collateral.read() + amount_cents);
                }
                assert(current_nav >= amount_cents, 'VAULT: INSUFFICIENT_NAV');
                self.lp_pool_nav.write(current_nav - amount_cents);
            }

            self.emit(FundingSettled {
                amount_cents,
                is_long_pays,
                new_pool_nav: self.lp_pool_nav.read(),
            });
        }

        // Liquidation waterfall:
        //   seized margin -> keeper bounty -> 70% LP / 20% insurance / 10% treasury.
        //   insurance_deficit_cents (bad debt) -> insurance absorbs real USDC,
        //   remainder recorded as explicit bad debt.
        fn settle_liquidation(
            ref self: ContractState,
            seized_collateral_cents: u128,
            keeper_bounty_cents: u128,
            keeper_recipient: ContractAddress,
            insurance_deficit_cents: u128,
            is_pool_custodied: bool,
        ) {
            self.assert_pel_core();

            // Release the seized margin.
            if is_pool_custodied {
                let cur_margin = self.pool_margin_cents.read();
                assert(cur_margin >= seized_collateral_cents, 'VAULT: INSUFF_POOL_MARGIN');
                self.pool_margin_cents.write(cur_margin - seized_collateral_cents);
            } else {
                let cur_locked = self.total_locked_collateral.read();
                assert(cur_locked >= seized_collateral_cents, 'VAULT: INSUFF_LOCKED_MARGIN');
                self.total_locked_collateral.write(cur_locked - seized_collateral_cents);
            }

            // Enforce the bounded keeper bounty.
            let max_bounty = (seized_collateral_cents * KEEPER_BOUNTY_BPS) / 10000_u128;
            let bounded_bounty = if keeper_bounty_cents > KEEPER_BOUNTY_CAP_CENTS {
                KEEPER_BOUNTY_CAP_CENTS
            } else {
                keeper_bounty_cents
            };
            assert(bounded_bounty <= max_bounty, 'VAULT: EXCESSIVE_BOUNTY');
            let bounty = bounded_bounty;

            if bounty > 0_u128 {
                self.keeper_bounties.write(keeper_recipient, self.keeper_bounties.read(keeper_recipient) + bounty);
                self.unclaimed_bounties_total.write(self.unclaimed_bounties_total.read() + bounty);
            }

            // Distribute the remnant across LP / insurance / treasury. Treasury takes
            // the integer remainder so every cent is routed.
            let net_seized = seized_collateral_cents - bounty;
            let lp_share = (net_seized * LP_FEE_SHARE_BPS) / 10000_u128;
            let insurance_share = (net_seized * INSURANCE_FEE_SHARE_BPS) / 10000_u128;
            let treasury_share = net_seized - lp_share - insurance_share;

            self.lp_pool_nav.write(self.lp_pool_nav.read() + lp_share);
            self.treasury_balance.write(self.treasury_balance.read() + treasury_share);

            // Insurance holds REAL USDC: transfer it in before booking the contribution.
            let ins_addr = self.insurance_reserve.read();
            let mut insurance_absorbed_cents: u128 = 0_u128;
            if insurance_share > 0_u128 {
                assert(ins_addr != 0.try_into().unwrap(), 'VAULT: INS_NOT_CONFIGURED');
                let token = self.collateral_token.read();
                let token_units: u256 = (insurance_share * TOKEN_DECIMAL_MULTIPLIER).into();
                let ok = IERC20Dispatcher { contract_address: token }.transfer(ins_addr, token_units);
                assert(ok, 'VAULT: INS_TFR_FAILED');
                IPELInsuranceReserveDispatcher { contract_address: ins_addr }
                    .deposit_liquidation_remnant(insurance_share);
            }

            // Bad debt absorption: insurance transfers REAL USDC back to the vault.
            if insurance_deficit_cents > 0_u128 {
                assert(ins_addr != 0.try_into().unwrap(), 'VAULT: INS_NOT_CONFIGURED');
                let absorbed = IPELInsuranceReserveDispatcher { contract_address: ins_addr }
                    .absorb_bad_debt(insurance_deficit_cents);
                self.lp_pool_nav.write(self.lp_pool_nav.read() + absorbed);
                insurance_absorbed_cents = absorbed;
                let remaining = insurance_deficit_cents - absorbed;
                if remaining > 0_u128 {
                    self.bad_debt_total.write(self.bad_debt_total.read() + remaining);
                    self.emit(BadDebtRecorded {
                        amount_cents: remaining,
                        cumulative: self.bad_debt_total.read(),
                    });
                }
            }

            self.emit(LiquidationSettled {
                seized_cents: seized_collateral_cents,
                bounty_cents: bounty,
                lp_share_cents: lp_share,
                insurance_share_cents: insurance_share,
                treasury_share_cents: treasury_share,
                insurance_absorbed_cents: insurance_absorbed_cents,
                bad_debt_cents: insurance_deficit_cents - insurance_absorbed_cents,
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
            let pending = self.unclaimed_payouts_total.read();
            assert(pending >= amount_cents, 'VAULT: ACCOUNTING_MISMATCH');
            self.unclaimed_payouts_total.write(pending - amount_cents);

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
            let pending = self.unclaimed_bounties_total.read();
            assert(pending >= amount_cents, 'VAULT: ACCOUNTING_MISMATCH');
            self.unclaimed_bounties_total.write(pending - amount_cents);

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

        fn set_pool_custodian(ref self: ContractState, custodian: ContractAddress) {
            self.assert_admin();
            self.pool_custodian.write(custodian);
        }

        fn get_collateral_token(self: @ContractState) -> ContractAddress {
            self.collateral_token.read()
        }

        fn get_contract_token_balance(self: @ContractState) -> u256 {
            let token = self.collateral_token.read();
            IERC20Dispatcher { contract_address: token }.balance_of(get_contract_address())
        }

        // Treasury withdrawal: real USDC transfer to the configured treasury address.
        fn withdraw_treasury(ref self: ContractState, amount_cents: u128) {
            self.assert_admin();
            let treasury = self.treasury_address.read();
            assert(treasury != 0.try_into().unwrap(), 'VAULT: TREASURY_NOT_CONFIGURED');
            let cur = self.treasury_balance.read();
            assert(cur >= amount_cents, 'VAULT: INSUFFICIENT_TREASURY');
            self.treasury_balance.write(cur - amount_cents);

            let token = self.collateral_token.read();
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let ok = IERC20Dispatcher { contract_address: token }.transfer(treasury, token_units);
            assert(ok, 'VAULT: TRANSFER_FAILED');

            self.emit(TreasuryWithdrawn { to: treasury, amount_cents });
        }

        // Realize pool receivable: pull real USDC from the pool custodian (the operator
        // that swept value out of the STRK20 pool) and reduce the pool asset ledger.
        // Fail-closed: the transfer must succeed or the whole call reverts.
        fn collect_pool_receivable(ref self: ContractState, amount_cents: u128) {
            self.assert_admin();
            assert(amount_cents > 0_u128, 'VAULT: ZERO_AMOUNT');
            let receivable = self.get_pool_receivable();
            assert(amount_cents <= receivable, 'VAULT: EXCEEDS_POOL_RECEIVABLE');
            assert(self.pool_assets_cents.read() >= amount_cents, 'VAULT: INSUFF_POOL_ASSETS');

            let custodian = self.pool_custodian.read();
            let token = self.collateral_token.read();
            let token_units: u256 = (amount_cents * TOKEN_DECIMAL_MULTIPLIER).into();
            let ok = IERC20Dispatcher { contract_address: token }
                .transfer_from(custodian, get_contract_address(), token_units);
            assert(ok, 'VAULT: POOL_TRANSFER_FAILED');

            self.pool_assets_cents.write(self.pool_assets_cents.read() - amount_cents);
            self.emit(PoolReceivableCollected {
                from: custodian,
                amount_cents,
                new_pool_assets: self.pool_assets_cents.read(),
            });
        }
    }

    #[generate_trait]
    impl InternalMethods of InternalMethodsTrait {
        fn assert_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'VAULT: CALLER_NOT_ADMIN');
        }

        // Settlement authority is STRICTLY PELPerpsCore. Admin is NOT a settlement
        // superuser (prevents arbitrary NAV/insurance manipulation).
        fn assert_pel_core(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read(), 'VAULT: UNAUTHORIZED_CORE');
        }

        fn token_balance_cents(self: @ContractState) -> u128 {
            let token = self.collateral_token.read();
            let bal = IERC20Dispatcher { contract_address: token }.balance_of(get_contract_address());
            (bal.low / TOKEN_DECIMAL_MULTIPLIER.into()).try_into().unwrap_or(0)
        }

        fn absorb_bad_debt(self: @ContractState, deficit_cents: u128) -> u128 {
            if deficit_cents == 0_u128 {
                return 0_u128;
            }
            let ins_addr = self.insurance_reserve.read();
            if ins_addr == 0.try_into().unwrap() {
                return 0_u128;
            }
            let absorbed = IPELInsuranceReserveDispatcher { contract_address: ins_addr }
                .absorb_bad_debt(deficit_cents);
            // absorb_bad_debt on a REAL-custody insurance contract transfers absorbed
            // tokens into the vault, backing the NAV credit.
            absorbed
        }
    }
}
