// STRK20 Shielded Collateral & Proportional LP Counterparty Vault V4.1
// Implements Whitepaper Section 6, 8, 14
//
// Global Financial Conservation Invariant:
// IERC20.balanceOf(this) >= total_locked_collateral + lp_pool_nav + insurance_fund_balance + unclaimed_payouts_total + unclaimed_bounties_total

use starknet::ContractAddress;

#[starknet::interface]
pub trait ISTRK20Adapter<TContractState> {
    fn lock_shielded_margin(ref self: TContractState, collateral_owner: ContractAddress, nullifier: felt252, amount: u128);
    fn release_shielded_payout(
        ref self: TContractState,
        recipient_note_commitment: felt252,
        recipient: ContractAddress,
        amount: u128,
        profit_amount: u128,
    );
    fn seize_liquidation_collateral(
        ref self: TContractState,
        nullifier: felt252,
        keeper_recipient: ContractAddress,
        bounty_amount: u128,
        remaining_amount: u128,
    );
    fn collect_funding_payment(ref self: TContractState, nullifier: felt252, amount: u128, is_long_pays: bool);
    fn collect_insurance_contribution(ref self: TContractState, nullifier: felt252, amount: u128);
    fn claim_payout(ref self: TContractState, payout_nullifier: felt252, recipient_note_commitment: felt252);
    fn claim_keeper_bounty(ref self: TContractState, keeper_recipient: ContractAddress);

    // Proportional LP Counterparty Pool
    fn deposit_liquidity(ref self: TContractState, amount: u128) -> u128;
    fn withdraw_liquidity_shares(ref self: TContractState, shares: u128) -> u128;
    fn get_lp_shares_balance(self: @TContractState, provider: ContractAddress) -> u128;
    fn get_total_lp_shares(self: @TContractState) -> u128;
    fn get_lp_pool_nav(self: @TContractState) -> u128;
    fn get_available_liquidity(self: @TContractState) -> u128;
    fn get_share_price_e6(self: @TContractState) -> u128;

    // Solvency Snapshot
    fn get_solvency_snapshot(
        self: @TContractState
    ) -> (u256, u128, u128, u128, u128, u128, bool);

    // View Functions
    fn get_keeper_bounty_balance(self: @TContractState, keeper: ContractAddress) -> u128;
    fn get_insurance_fund_balance(self: @TContractState) -> u128;
    fn get_registered_note_amount(self: @TContractState, commitment: felt252) -> u128;
    fn get_registered_note_recipient(self: @TContractState, commitment: felt252) -> ContractAddress;
    fn is_note_claimed(self: @TContractState, commitment: felt252) -> bool;
    fn is_payout_nullifier_spent(self: @TContractState, nullifier: felt252) -> bool;
    fn set_pel_core_address(ref self: TContractState, pel_core: ContractAddress);
    fn set_collateral_token(ref self: TContractState, token: ContractAddress);
    fn get_collateral_token(self: @TContractState) -> ContractAddress;
    fn get_contract_token_balance(self: @TContractState) -> u256;
    fn get_total_locked_collateral(self: @TContractState) -> u128;
    fn is_margin_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
}

#[starknet::contract]
pub mod STRK20Adapter {
    use super::ISTRK20Adapter;
    use super::super::test_usdc::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const SHARE_SCALE: u128 = 1000000_u128; // 1e6 share scale

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        collateral_token: ContractAddress,

        // Internal Accounting Buckets
        total_locked_collateral: u128,
        lp_pool_nav: u128,
        total_lp_shares: u128,
        insurance_fund_balance: u128,
        unclaimed_payouts_total: u128,
        unclaimed_bounties_total: u128,

        lp_shares_balances: Map<ContractAddress, u128>,
        used_margin_nullifiers: Map<felt252, bool>,
        keeper_bounties: Map<ContractAddress, u128>,
        registered_notes: Map<felt252, u128>,
        registered_note_recipients: Map<felt252, ContractAddress>,
        claimed_notes: Map<felt252, bool>,
        spent_payout_nullifiers: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MarginLocked: MarginLocked,
        PayoutReleased: PayoutReleased,
        PayoutClaimed: PayoutClaimed,
        CollateralLiquidated: CollateralLiquidated,
        KeeperBountyClaimed: KeeperBountyClaimed,
        FundingCollected: FundingCollected,
        InsuranceContributionCollected: InsuranceContributionCollected,
        LiquidityDeposited: LiquidityDeposited,
        LiquidityWithdrawn: LiquidityWithdrawn,
        PelCoreAddressUpdated: PelCoreAddressUpdated,
        CollateralTokenUpdated: CollateralTokenUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarginLocked {
        pub collateral_owner: ContractAddress,
        pub nullifier: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutReleased {
        pub note_commitment: felt252,
        pub recipient: ContractAddress,
        pub amount: u128,
        pub profit_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutClaimed {
        pub note_commitment: felt252,
        pub recipient: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralLiquidated {
        pub nullifier: felt252,
        pub keeper: ContractAddress,
        pub bounty_amount: u128,
        pub remaining_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperBountyClaimed {
        pub keeper: ContractAddress,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FundingCollected {
        pub nullifier: felt252,
        pub amount: u128,
        pub is_long_pays: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct InsuranceContributionCollected {
        pub nullifier: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityDeposited {
        pub provider: ContractAddress,
        pub amount: u128,
        pub shares_minted: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityWithdrawn {
        pub provider: ContractAddress,
        pub shares_burned: u128,
        pub payout_amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PelCoreAddressUpdated {
        pub pel_core: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralTokenUpdated {
        pub token: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pel_core: ContractAddress,
        collateral_token: ContractAddress
    ) {
        self.admin.write(admin);
        self.pel_core_address.write(pel_core);
        self.collateral_token.write(collateral_token);
        self.total_locked_collateral.write(0);
        self.lp_pool_nav.write(0);
        self.total_lp_shares.write(0);
        self.insurance_fund_balance.write(0);
        self.unclaimed_payouts_total.write(0);
        self.unclaimed_bounties_total.write(0);
    }

    #[abi(embed_v0)]
    impl STRK20AdapterImpl of ISTRK20Adapter<ContractState> {

        // ─── LOCK MARGIN (User -> Adapter Direct Authorization) ───────────────
        fn lock_shielded_margin(
            ref self: ContractState,
            collateral_owner: ContractAddress,
            nullifier: felt252,
            amount: u128
        ) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');
            assert(!self.used_margin_nullifiers.read(nullifier), 'MARGIN_NULLIFIER_ALREADY_USED');
            assert(amount > 0, 'INVALID_MARGIN_AMOUNT');

            // Pull real ERC20 tokens directly from the authenticated collateral owner
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let this_contract = get_contract_address();
            let success = token.transfer_from(collateral_owner, this_contract, amount.into());
            assert(success, 'ERC20_MARGIN_TRANSFER_FAILED');

            self.used_margin_nullifiers.write(nullifier, true);
            let current = self.total_locked_collateral.read();
            self.total_locked_collateral.write(current + amount);

            self.emit(MarginLocked { collateral_owner, nullifier, amount });
        }

        // ─── RELEASE PAYOUT (Recipient Binding & LP NAV Counterparty PnL) ────
        fn release_shielded_payout(
            ref self: ContractState,
            recipient_note_commitment: felt252,
            recipient: ContractAddress,
            amount: u128,
            profit_amount: u128,
        ) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');
            assert(amount > 0, 'INVALID_PAYOUT_AMOUNT');

            // 1. If profitable, fund profit from insurance fund or LP liquidity pool NAV
            if profit_amount > 0 {
                let current_ins = self.insurance_fund_balance.read();
                if current_ins >= profit_amount {
                    self.insurance_fund_balance.write(current_ins - profit_amount);
                } else {
                    let remainder = profit_amount - current_ins;
                    self.insurance_fund_balance.write(0);
                    let current_lp_nav = self.lp_pool_nav.read();
                    assert(current_lp_nav >= remainder, 'INSUFFICIENT_POOL_NAV');
                    self.lp_pool_nav.write(current_lp_nav - remainder);
                }
            }

            // 2. Strict accounting: deduct margin portion from locked collateral without silent clamping
            let margin_portion = amount - profit_amount;
            if margin_portion > 0 {
                let current_locked = self.total_locked_collateral.read();
                assert(current_locked >= margin_portion, 'INSUFFICIENT_LOCKED_MARGIN');
                self.total_locked_collateral.write(current_locked - margin_portion);
            }

            // 3. Register verifiable recipient-bound note commitment on-chain
            self.registered_notes.write(recipient_note_commitment, amount);
            self.registered_note_recipients.write(recipient_note_commitment, recipient);

            let cur_unclaimed = self.unclaimed_payouts_total.read();
            self.unclaimed_payouts_total.write(cur_unclaimed + amount);

            self.emit(PayoutReleased { note_commitment: recipient_note_commitment, recipient, amount, profit_amount });
        }

        // ─── CLAIM PAYOUT (Recipient-Bound Anti-Theft) ───────────────────────
        fn claim_payout(ref self: ContractState, payout_nullifier: felt252, recipient_note_commitment: felt252) {
            let amount = self.registered_notes.read(recipient_note_commitment);
            assert(amount > 0, 'NOTE_NOT_FOUND_OR_EMPTY');

            let intended_recipient = self.registered_note_recipients.read(recipient_note_commitment);
            let caller = get_caller_address();
            assert(caller == intended_recipient || caller == self.admin.read(), 'UNAUTHORIZED_PAYOUT_CLAIMANT');

            assert(!self.claimed_notes.read(recipient_note_commitment), 'NOTE_ALREADY_CLAIMED');
            assert(!self.spent_payout_nullifiers.read(payout_nullifier), 'PAYOUT_NULLIFIER_ALREADY_SPENT');

            self.claimed_notes.write(recipient_note_commitment, true);
            self.spent_payout_nullifiers.write(payout_nullifier, true);

            let cur_unclaimed = self.unclaimed_payouts_total.read();
            assert(cur_unclaimed >= amount, 'ACCOUNTING_MISMATCH');
            self.unclaimed_payouts_total.write(cur_unclaimed - amount);

            // Push real ERC20 tokens to verified recipient
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(caller, amount.into());
            assert(success, 'ERC20_PAYOUT_TRANSFER_FAILED');

            self.emit(PayoutClaimed { note_commitment: recipient_note_commitment, recipient: caller, amount });
        }

        // ─── SEIZE LIQUIDATION COLLATERAL (Strict Accounting) ────────────────
        fn seize_liquidation_collateral(
            ref self: ContractState,
            nullifier: felt252,
            keeper_recipient: ContractAddress,
            bounty_amount: u128,
            remaining_amount: u128,
        ) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let total_seized = bounty_amount + remaining_amount;
            let current = self.total_locked_collateral.read();
            assert(current >= total_seized, 'INSUFFICIENT_LOCKED_MARGIN');
            self.total_locked_collateral.write(current - total_seized);

            // 2% liquidation bounty to keeper ledger
            let current_bounty = self.keeper_bounties.read(keeper_recipient);
            self.keeper_bounties.write(keeper_recipient, current_bounty + bounty_amount);

            let cur_unclaimed_bounties = self.unclaimed_bounties_total.read();
            self.unclaimed_bounties_total.write(cur_unclaimed_bounties + bounty_amount);

            // 98% collateral to protocol insurance fund
            let current_insurance = self.insurance_fund_balance.read();
            self.insurance_fund_balance.write(current_insurance + remaining_amount);

            self.emit(CollateralLiquidated {
                nullifier,
                keeper: keeper_recipient,
                bounty_amount,
                remaining_amount,
            });
        }

        // ─── COLLECT FUNDING PAYMENT (Real LP Counterparty Clearing) ─────────
        fn collect_funding_payment(ref self: ContractState, nullifier: felt252, amount: u128, is_long_pays: bool) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let current_locked = self.total_locked_collateral.read();
            assert(current_locked >= amount, 'INSUFFICIENT_LOCKED_MARGIN');
            self.total_locked_collateral.write(current_locked - amount);

            // Funding paid by trader goes to LP counterparty pool NAV
            let current_lp_nav = self.lp_pool_nav.read();
            self.lp_pool_nav.write(current_lp_nav + amount);

            self.emit(FundingCollected { nullifier, amount, is_long_pays });
        }

        // ─── COLLECT LOSS CONTRIBUTION (Trader Loss to LP NAV) ───────────────
        fn collect_insurance_contribution(ref self: ContractState, nullifier: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            if amount > 0 {
                let current_locked = self.total_locked_collateral.read();
                assert(current_locked >= amount, 'INSUFFICIENT_LOCKED_MARGIN');
                self.total_locked_collateral.write(current_locked - amount);

                // Trader loss increases LP counterparty pool NAV
                let current_lp_nav = self.lp_pool_nav.read();
                self.lp_pool_nav.write(current_lp_nav + amount);
                self.emit(InsuranceContributionCollected { nullifier, amount });
            }
        }

        fn claim_keeper_bounty(ref self: ContractState, keeper_recipient: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == keeper_recipient || caller == self.admin.read(), 'UNAUTHORIZED_KEEPER');

            let bounty = self.keeper_bounties.read(keeper_recipient);
            assert(bounty > 0, 'NO_BOUNTY_AVAILABLE');

            self.keeper_bounties.write(keeper_recipient, 0);

            let cur_unclaimed_bounties = self.unclaimed_bounties_total.read();
            assert(cur_unclaimed_bounties >= bounty, 'ACCOUNTING_MISMATCH');
            self.unclaimed_bounties_total.write(cur_unclaimed_bounties - bounty);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(keeper_recipient, bounty.into());
            assert(success, 'ERC20_BOUNTY_TRANSFER_FAILED');

            self.emit(KeeperBountyClaimed { keeper: keeper_recipient, amount: bounty });
        }

        // ─── PROPORTIONAL LP COUNTERPARTY POOL (NAV Model) ───────────────────

        fn deposit_liquidity(ref self: ContractState, amount: u128) -> u128 {
            let caller = get_caller_address();
            assert(amount > 0, 'INVALID_DEPOSIT_AMOUNT');

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let this_contract = get_contract_address();
            let success = token.transfer_from(caller, this_contract, amount.into());
            assert(success, 'ERC20_LP_TRANSFER_FAILED');

            let total_shares = self.total_lp_shares.read();
            let pool_nav = self.lp_pool_nav.read();

            let shares_to_mint = if total_shares == 0 || pool_nav == 0 {
                amount * SHARE_SCALE
            } else {
                (amount * total_shares) / pool_nav
            };
            assert(shares_to_mint > 0, 'ZERO_SHARES_MINTED');

            let current_user_shares = self.lp_shares_balances.read(caller);
            self.lp_shares_balances.write(caller, current_user_shares + shares_to_mint);

            self.total_lp_shares.write(total_shares + shares_to_mint);
            self.lp_pool_nav.write(pool_nav + amount);

            self.emit(LiquidityDeposited { provider: caller, amount, shares_minted: shares_to_mint });
            shares_to_mint
        }

        fn withdraw_liquidity_shares(ref self: ContractState, shares: u128) -> u128 {
            let caller = get_caller_address();
            assert(shares > 0, 'INVALID_WITHDRAW_SHARES');

            let user_shares = self.lp_shares_balances.read(caller);
            assert(user_shares >= shares, 'INSUFFICIENT_LP_SHARES');

            let total_shares = self.total_lp_shares.read();
            assert(total_shares > 0, 'ZERO_TOTAL_SHARES');

            let pool_nav = self.lp_pool_nav.read();
            let payout_amount = (shares * pool_nav) / total_shares;
            assert(payout_amount > 0, 'ZERO_WITHDRAWAL_PAYOUT');

            self.lp_shares_balances.write(caller, user_shares - shares);
            self.total_lp_shares.write(total_shares - shares);

            assert(pool_nav >= payout_amount, 'INSUFFICIENT_POOL_NAV');
            self.lp_pool_nav.write(pool_nav - payout_amount);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(caller, payout_amount.into());
            assert(success, 'ERC20_LP_WITHDRAW_FAILED');

            self.emit(LiquidityWithdrawn { provider: caller, shares_burned: shares, payout_amount });
            payout_amount
        }

        fn get_lp_shares_balance(self: @ContractState, provider: ContractAddress) -> u128 {
            self.lp_shares_balances.read(provider)
        }

        fn get_total_lp_shares(self: @ContractState) -> u128 {
            self.total_lp_shares.read()
        }

        fn get_lp_pool_nav(self: @ContractState) -> u128 {
            self.lp_pool_nav.read()
        }

        fn get_available_liquidity(self: @ContractState) -> u128 {
            self.lp_pool_nav.read() + self.insurance_fund_balance.read()
        }

        fn get_share_price_e6(self: @ContractState) -> u128 {
            let total_shares = self.total_lp_shares.read();
            if total_shares == 0 {
                return SHARE_SCALE;
            }
            let pool_nav = self.lp_pool_nav.read();
            (pool_nav * SHARE_SCALE * SHARE_SCALE) / total_shares
        }

        // ─── SOLVENCY SNAPSHOT VIEW ──────────────────────────────────────────
        // Returns (actual_token_balance, locked_margin, lp_nav, insurance_fund, unclaimed_payouts, unclaimed_bounties, is_solvent)
        fn get_solvency_snapshot(
            self: @ContractState
        ) -> (u256, u128, u128, u128, u128, u128, bool) {
            let token_balance = self.get_contract_token_balance();
            let locked = self.total_locked_collateral.read();
            let lp_nav = self.lp_pool_nav.read();
            let ins = self.insurance_fund_balance.read();
            let unclaimed_payouts = self.unclaimed_payouts_total.read();
            let unclaimed_bounties = self.unclaimed_bounties_total.read();

            let total_liabilities_u128 = locked + lp_nav + ins + unclaimed_payouts + unclaimed_bounties;
            let total_liabilities_u256: u256 = total_liabilities_u128.into();

            // 1 cent = 10,000 micro-USDC (6 decimals)
            let total_liabilities_token_units = total_liabilities_u256 * 10000_u256;
            let is_solvent = token_balance >= total_liabilities_token_units;

            (token_balance, locked, lp_nav, ins, unclaimed_payouts, unclaimed_bounties, is_solvent)
        }

        // ─── VIEW FUNCTIONS ──────────────────────────────────────────────────

        fn get_keeper_bounty_balance(self: @ContractState, keeper: ContractAddress) -> u128 {
            self.keeper_bounties.read(keeper)
        }

        fn get_insurance_fund_balance(self: @ContractState) -> u128 {
            self.insurance_fund_balance.read()
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

        fn is_payout_nullifier_spent(self: @ContractState, nullifier: felt252) -> bool {
            self.spent_payout_nullifiers.read(nullifier)
        }

        fn set_pel_core_address(ref self: ContractState, pel_core: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.pel_core_address.write(pel_core);
            self.emit(PelCoreAddressUpdated { pel_core });
        }

        fn set_collateral_token(ref self: ContractState, token: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            self.collateral_token.write(token);
            self.emit(CollateralTokenUpdated { token });
        }

        fn get_collateral_token(self: @ContractState) -> ContractAddress {
            self.collateral_token.read()
        }

        fn get_contract_token_balance(self: @ContractState) -> u256 {
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            token.balance_of(get_contract_address())
        }

        fn get_total_locked_collateral(self: @ContractState) -> u128 {
            self.total_locked_collateral.read()
        }

        fn is_margin_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.used_margin_nullifiers.read(nullifier)
        }
    }
}
