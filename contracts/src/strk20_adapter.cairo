// STRK20 Shielded Collateral Adapter V4 (Real ERC20 Custody)
// V4 changes: All financial operations now execute real ERC20 transfers.
// lock_shielded_margin → transferFrom(caller, this, amount)
// claim_payout → transfer(recipient, amount)
// claim_keeper_bounty → transfer(keeper, bounty)
// deposit_insurance_liquidity → transferFrom(caller, this, amount)

use starknet::ContractAddress;

#[starknet::interface]
pub trait ISTRK20Adapter<TContractState> {
    fn lock_shielded_margin(ref self: TContractState, nullifier: felt252, amount: u128);
    fn release_shielded_payout(ref self: TContractState, recipient_note_commitment: felt252, amount: u128);
    fn seize_liquidation_collateral(
        ref self: TContractState,
        nullifier: felt252,
        keeper_recipient: ContractAddress,
        bounty_amount: u128,
        remaining_amount: u128,
    );
    fn collect_funding_payment(ref self: TContractState, nullifier: felt252, amount: u128, is_long_pays: bool);
    fn collect_insurance_contribution(ref self: TContractState, nullifier: felt252, amount: u128);
    fn claim_payout(ref self: TContractState, recipient_note_commitment: felt252, recipient: ContractAddress);
    fn claim_keeper_bounty(ref self: TContractState, keeper_recipient: ContractAddress);
    fn deposit_insurance_liquidity(ref self: TContractState, amount: u128);
    fn get_keeper_bounty_balance(self: @TContractState, keeper: ContractAddress) -> u128;
    fn get_insurance_fund_balance(self: @TContractState) -> u128;
    fn get_registered_note_amount(self: @TContractState, commitment: felt252) -> u128;
    fn is_note_claimed(self: @TContractState, commitment: felt252) -> bool;
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
        insurance_fund_balance: u128,
        used_margin_nullifiers: Map<felt252, bool>,
        keeper_bounties: Map<ContractAddress, u128>,
        registered_notes: Map<felt252, u128>,
        claimed_notes: Map<felt252, bool>,
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
        InsuranceLiquidityDeposited: InsuranceLiquidityDeposited,
        PelCoreAddressUpdated: PelCoreAddressUpdated,
        CollateralTokenUpdated: CollateralTokenUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarginLocked {
        pub nullifier: felt252,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PayoutReleased {
        pub note_commitment: felt252,
        pub amount: u128,
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
    pub struct InsuranceLiquidityDeposited {
        pub depositor: ContractAddress,
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
        self.insurance_fund_balance.write(0);
    }

    #[abi(embed_v0)]
    impl STRK20AdapterImpl of ISTRK20Adapter<ContractState> {

        // ─── LOCK MARGIN ─────────────────────────────────────────────────
        // V4: Pulls real ERC20 tokens from the transaction sender.
        // The sender (PELPerpsCore or user via multicall) must have
        // called approve(adapter_address, amount) on the collateral token.
        fn lock_shielded_margin(ref self: ContractState, nullifier: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');
            assert(!self.used_margin_nullifiers.read(nullifier), 'MARGIN_NULLIFIER_ALREADY_USED');
            assert(amount > 0, 'INVALID_MARGIN_AMOUNT');

            // V4: Pull real ERC20 tokens from the original transaction sender
            // In a multicall, the caller is PELPerpsCore, but the tokens come
            // from the user who approved the adapter. We use transfer_from(caller, this).
            // The user must approve this contract before the multicall.
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let this_contract = get_contract_address();
            let success = token.transfer_from(caller, this_contract, amount.into());
            assert(success, 'ERC20_MARGIN_TRANSFER_FAILED');

            self.used_margin_nullifiers.write(nullifier, true);
            let current = self.total_locked_collateral.read();
            self.total_locked_collateral.write(current + amount);

            self.emit(MarginLocked { nullifier, amount });
        }

        // ─── RELEASE PAYOUT ──────────────────────────────────────────────
        // Called by PELPerpsCore on close_position.
        // Registers a note commitment with an amount. Does NOT transfer yet.
        // The user must call claim_payout to receive actual ERC20 tokens.
        fn release_shielded_payout(ref self: ContractState, recipient_note_commitment: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            let current = self.total_locked_collateral.read();
            if current >= amount {
                self.total_locked_collateral.write(current - amount);
            } else {
                self.total_locked_collateral.write(0);
            }

            // Register verifiable note commitment on-chain
            self.registered_notes.write(recipient_note_commitment, amount);

            self.emit(PayoutReleased { note_commitment: recipient_note_commitment, amount });
        }

        // ─── CLAIM PAYOUT ────────────────────────────────────────────────
        // V4: Transfers real ERC20 tokens to the recipient.
        // Anyone with knowledge of the note commitment can claim.
        fn claim_payout(ref self: ContractState, recipient_note_commitment: felt252, recipient: ContractAddress) {
            let amount = self.registered_notes.read(recipient_note_commitment);
            assert(amount > 0, 'NOTE_NOT_FOUND_OR_EMPTY');
            assert(!self.claimed_notes.read(recipient_note_commitment), 'NOTE_ALREADY_CLAIMED');

            self.claimed_notes.write(recipient_note_commitment, true);

            // V4: Push real ERC20 tokens to recipient
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(recipient, amount.into());
            assert(success, 'ERC20_PAYOUT_TRANSFER_FAILED');

            self.emit(PayoutClaimed { note_commitment: recipient_note_commitment, recipient, amount });
        }

        // ─── SEIZE LIQUIDATION COLLATERAL ────────────────────────────────
        // Collateral stays in contract but is re-allocated:
        // 2% → keeper bounty ledger, 98% → insurance fund.
        // Keeper calls claim_keeper_bounty to withdraw their share.
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
            if current >= total_seized {
                self.total_locked_collateral.write(current - total_seized);
            } else {
                self.total_locked_collateral.write(0);
            }

            // Credit 2% liquidation bounty to keeper ledger
            let current_bounty = self.keeper_bounties.read(keeper_recipient);
            self.keeper_bounties.write(keeper_recipient, current_bounty + bounty_amount);

            // Credit remaining 98% collateral to protocol insurance fund
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

            // Funding payments move collateral from locked → insurance fund
            // Tokens stay in contract, only internal accounting changes
            let current_insurance = self.insurance_fund_balance.read();
            self.insurance_fund_balance.write(current_insurance + amount);

            self.emit(FundingCollected { nullifier, amount, is_long_pays });
        }

        fn collect_insurance_contribution(ref self: ContractState, nullifier: felt252, amount: u128) {
            let caller = get_caller_address();
            assert(caller == self.pel_core_address.read() || caller == self.admin.read(), 'UNAUTHORIZED_PEL_CORE');

            if amount > 0 {
                let current_insurance = self.insurance_fund_balance.read();
                self.insurance_fund_balance.write(current_insurance + amount);
                self.emit(InsuranceContributionCollected { nullifier, amount });
            }
        }

        // ─── CLAIM KEEPER BOUNTY ─────────────────────────────────────────
        // V4: Transfers real ERC20 tokens to the keeper.
        fn claim_keeper_bounty(ref self: ContractState, keeper_recipient: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == keeper_recipient || caller == self.admin.read(), 'UNAUTHORIZED_KEEPER');

            let bounty = self.keeper_bounties.read(keeper_recipient);
            assert(bounty > 0, 'NO_BOUNTY_AVAILABLE');

            self.keeper_bounties.write(keeper_recipient, 0);

            // V4: Push real ERC20 tokens to keeper
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(keeper_recipient, bounty.into());
            assert(success, 'ERC20_BOUNTY_TRANSFER_FAILED');

            self.emit(KeeperBountyClaimed { keeper: keeper_recipient, amount: bounty });
        }

        // ─── DEPOSIT INSURANCE LIQUIDITY ─────────────────────────────────
        // V4: Pulls real ERC20 tokens from caller into insurance fund.
        fn deposit_insurance_liquidity(ref self: ContractState, amount: u128) {
            let caller = get_caller_address();
            assert(amount > 0, 'INVALID_DEPOSIT_AMOUNT');

            // V4: Pull real ERC20 tokens from depositor
            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let this_contract = get_contract_address();
            let success = token.transfer_from(caller, this_contract, amount.into());
            assert(success, 'ERC20_INSURANCE_TRANSFER_FAILED');

            let current = self.insurance_fund_balance.read();
            self.insurance_fund_balance.write(current + amount);
            self.emit(InsuranceLiquidityDeposited { depositor: caller, amount });
        }

        // ─── VIEW FUNCTIONS ──────────────────────────────────────────────

        fn get_keeper_bounty_balance(self: @ContractState, keeper: ContractAddress) -> u128 {
            self.keeper_bounties.read(keeper)
        }

        fn get_insurance_fund_balance(self: @ContractState) -> u128 {
            self.insurance_fund_balance.read()
        }

        fn get_registered_note_amount(self: @ContractState, commitment: felt252) -> u128 {
            self.registered_notes.read(commitment)
        }

        fn is_note_claimed(self: @ContractState, commitment: felt252) -> bool {
            self.claimed_notes.read(commitment)
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
