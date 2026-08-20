// STRK20 Shielded Collateral & LP Counterparty Vault V4
// Implements Whitepaper Section 6, 8, 14
//
// Protocol Invariant:
// IERC20.balanceOf(this) >= total_locked_collateral + total_lp_liquidity + insurance_fund_balance + unclaimed_payouts + unclaimed_bounties

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

    // LP Liquidity Pool
    fn deposit_liquidity(ref self: TContractState, amount: u128);
    fn withdraw_liquidity(ref self: TContractState, amount: u128);
    fn get_lp_balance(self: @TContractState, provider: ContractAddress) -> u128;
    fn get_total_lp_liquidity(self: @TContractState) -> u128;
    fn get_available_liquidity(self: @TContractState) -> u128;

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

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pel_core_address: ContractAddress,
        collateral_token: ContractAddress,
        total_locked_collateral: u128,
        total_lp_liquidity: u128,
        insurance_fund_balance: u128,
        unclaimed_payouts_total: u128,
        lp_shares: Map<ContractAddress, u128>,
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
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidityWithdrawn {
        pub provider: ContractAddress,
        pub amount: u128,
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
        self.total_lp_liquidity.write(0);
        self.insurance_fund_balance.write(0);
        self.unclaimed_payouts_total.write(0);
    }

    #[abi(embed_v0)]
    impl STRK20AdapterImpl of ISTRK20Adapter<ContractState> {

        // ─── LOCK MARGIN (P0: Real User Collateral Authorization) ─────────────
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

        // ─── RELEASE PAYOUT (P0: Recipient Binding & LP Counterparty PnL) ─────
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

            // 1. If trade is profitable (profit_amount > 0), fund profit from insurance fund or LP liquidity pool
            if profit_amount > 0 {
                let current_ins = self.insurance_fund_balance.read();
                if current_ins >= profit_amount {
                    self.insurance_fund_balance.write(current_ins - profit_amount);
                } else {
                    let remainder = profit_amount - current_ins;
                    self.insurance_fund_balance.write(0);
                    let current_lp = self.total_lp_liquidity.read();
                    assert(current_lp >= remainder, 'INSUFFICIENT_POOL_LIQUIDITY');
                    self.total_lp_liquidity.write(current_lp - remainder);
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

        // ─── CLAIM PAYOUT (P0: Recipient-Bound Anti-Theft) ───────────────────
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

            // Push real ERC20 tokens to the verified recipient
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(caller, amount.into());
            assert(success, 'ERC20_PAYOUT_TRANSFER_FAILED');

            self.emit(PayoutClaimed { note_commitment: recipient_note_commitment, recipient: caller, amount });
        }

        // ─── SEIZE LIQUIDATION COLLATERAL (P0: Strict Accounting) ────────────
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

        fn collect_funding_payment(ref self: ContractState, nullifier: felt252, amount: u128, is_long_pays: bool) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let current_locked = self.total_locked_collateral.read();
            assert(current_locked >= amount, 'INSUFFICIENT_LOCKED_MARGIN');
            self.total_locked_collateral.write(current_locked - amount);

            let current_insurance = self.insurance_fund_balance.read();
            self.insurance_fund_balance.write(current_insurance + amount);

            self.emit(FundingCollected { nullifier, amount, is_long_pays });
        }

        fn collect_insurance_contribution(ref self: ContractState, nullifier: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            if amount > 0 {
                let current_locked = self.total_locked_collateral.read();
                assert(current_locked >= amount, 'INSUFFICIENT_LOCKED_MARGIN');
                self.total_locked_collateral.write(current_locked - amount);

                let current_insurance = self.insurance_fund_balance.read();
                self.insurance_fund_balance.write(current_insurance + amount);
                self.emit(InsuranceContributionCollected { nullifier, amount });
            }
        }

        fn claim_keeper_bounty(ref self: ContractState, keeper_recipient: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == keeper_recipient || caller == self.admin.read(), 'UNAUTHORIZED_KEEPER');

            let bounty = self.keeper_bounties.read(keeper_recipient);
            assert(bounty > 0, 'NO_BOUNTY_AVAILABLE');

            self.keeper_bounties.write(keeper_recipient, 0);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(keeper_recipient, bounty.into());
            assert(success, 'ERC20_BOUNTY_TRANSFER_FAILED');

            self.emit(KeeperBountyClaimed { keeper: keeper_recipient, amount: bounty });
        }

        // ─── LP LIQUIDITY POOL (P1: Counterparty Model) ──────────────────────

        fn deposit_liquidity(ref self: ContractState, amount: u128) {
            let caller = get_caller_address();
            assert(amount > 0, 'INVALID_DEPOSIT_AMOUNT');

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let this_contract = get_contract_address();
            let success = token.transfer_from(caller, this_contract, amount.into());
            assert(success, 'ERC20_LP_TRANSFER_FAILED');

            let current_user_lp = self.lp_shares.read(caller);
            self.lp_shares.write(caller, current_user_lp + amount);

            let current_total_lp = self.total_lp_liquidity.read();
            self.total_lp_liquidity.write(current_total_lp + amount);

            self.emit(LiquidityDeposited { provider: caller, amount });
        }

        fn withdraw_liquidity(ref self: ContractState, amount: u128) {
            let caller = get_caller_address();
            assert(amount > 0, 'INVALID_WITHDRAW_AMOUNT');

            let user_lp = self.lp_shares.read(caller);
            assert(user_lp >= amount, 'INSUFFICIENT_LP_SHARES');

            let available = self.get_available_liquidity();
            assert(available >= amount, 'INSUFFICIENT_AVAIL_LIQUIDITY');

            self.lp_shares.write(caller, user_lp - amount);
            let total_lp = self.total_lp_liquidity.read();
            assert(total_lp >= amount, 'INSUFFICIENT_LP_LIQUIDITY');
            self.total_lp_liquidity.write(total_lp - amount);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(caller, amount.into());
            assert(success, 'ERC20_LP_WITHDRAW_FAILED');

            self.emit(LiquidityWithdrawn { provider: caller, amount });
        }

        fn get_lp_balance(self: @ContractState, provider: ContractAddress) -> u128 {
            self.lp_shares.read(provider)
        }

        fn get_total_lp_liquidity(self: @ContractState) -> u128 {
            self.total_lp_liquidity.read()
        }

        fn get_available_liquidity(self: @ContractState) -> u128 {
            self.total_lp_liquidity.read() + self.insurance_fund_balance.read()
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
