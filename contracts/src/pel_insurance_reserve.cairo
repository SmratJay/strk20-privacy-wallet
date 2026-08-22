// PEL Insurance Reserve Contract — V2.0 (REAL USDC CUSTODY)
//
// Isolated tail-risk reserve for absorbing liquidation bad debt and tail losses.
// The reserve HOLDS REAL collateral:
//   - deposit_fee_contribution / deposit_liquidation_remnant are called by the
//     vault AFTER it transfers real USDC into this contract; this contract asserts
//     its token balance actually backs the booked balance before recording it.
//   - absorb_bad_debt transfers REAL USDC back to the caller (the vault).
//
// PHYSICAL CONSERVATION:
//   IERC20.balanceOf(this) == insurance_balance * TOKEN_DECIMAL_MULTIPLIER
//
// `insurance_balance` can never exceed the real tokens this contract holds.
// When insurance is exhausted, absorb_bad_debt returns 0 and the caller records
// the exact remaining deficit as explicit bad debt — nothing is clamped silently.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IPELInsuranceReserve<TContractState> {
    fn deposit_fee_contribution(ref self: TContractState, amount_cents: u128);
    fn deposit_liquidation_remnant(ref self: TContractState, amount_cents: u128);
    fn absorb_bad_debt(ref self: TContractState, requested_cents: u128) -> u128;
    fn get_insurance_balance(self: @TContractState) -> u128;
    fn get_target_reserve(self: @TContractState) -> u128;
    fn get_total_bad_debt_absorbed(self: @TContractState) -> u128;
    fn get_contract_token_balance(self: @TContractState) -> u256;
    fn set_target_reserve(ref self: TContractState, target_cents: u128);
    fn set_authorized_caller(ref self: TContractState, caller: ContractAddress, is_authorized: bool);
    fn is_authorized_caller(self: @TContractState, caller: ContractAddress) -> bool;
    fn can_migrate(self: @TContractState) -> bool;
}

#[starknet::contract]
pub mod PELInsuranceReserve {
    use super::IPELInsuranceReserve;
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const TOKEN_DECIMAL_MULTIPLIER: u128 = 10000_u128; // 1 cent = 10,000 micro-USDC (6 decimals)

    #[storage]
    struct Storage {
        admin: ContractAddress,
        collateral_token: ContractAddress,
        insurance_balance: u128,
        target_reserve: u128,
        total_bad_debt_absorbed: u128,
        total_fee_contributions: u128,
        total_liquidation_remnants: u128,
        authorized_callers: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeContributionDeposited: FeeContributionDeposited,
        LiquidationRemnantDeposited: LiquidationRemnantDeposited,
        BadDebtAbsorbed: BadDebtAbsorbed,
        TargetReserveUpdated: TargetReserveUpdated,
        AuthorizedCallerUpdated: AuthorizedCallerUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeContributionDeposited {
        pub caller: ContractAddress,
        pub amount_cents: u128,
        pub new_balance: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidationRemnantDeposited {
        pub caller: ContractAddress,
        pub amount_cents: u128,
        pub new_balance: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BadDebtAbsorbed {
        pub caller: ContractAddress,
        pub requested_cents: u128,
        pub actual_absorbed_cents: u128,
        pub remaining_insurance_balance: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TargetReserveUpdated {
        pub old_target: u128,
        pub new_target: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AuthorizedCallerUpdated {
        pub caller: ContractAddress,
        pub is_authorized: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        collateral_token: ContractAddress,
        target_reserve_cents: u128
    ) {
        self.admin.write(admin);
        self.collateral_token.write(collateral_token);
        self.target_reserve.write(target_reserve_cents);
        self.insurance_balance.write(0_u128);
        self.total_bad_debt_absorbed.write(0_u128);
        self.total_fee_contributions.write(0_u128);
        self.total_liquidation_remnants.write(0_u128);
        self.authorized_callers.write(admin, true);
    }

    #[abi(embed_v0)]
    impl PELInsuranceReserveImpl of IPELInsuranceReserve<ContractState> {
        fn deposit_fee_contribution(ref self: ContractState, amount_cents: u128) {
            self.assert_authorized();
            assert(amount_cents > 0_u128, 'INSURANCE: ZERO_DEPOSIT');
            // REAL backing check: the vault must have transferred the tokens already.
            self.assert_token_backing(amount_cents);
            self.insurance_balance.write(self.insurance_balance.read() + amount_cents);
            self.total_fee_contributions.write(self.total_fee_contributions.read() + amount_cents);

            self.emit(FeeContributionDeposited {
                caller: get_caller_address(),
                amount_cents,
                new_balance: self.insurance_balance.read(),
            });
        }

        fn deposit_liquidation_remnant(ref self: ContractState, amount_cents: u128) {
            self.assert_authorized();
            assert(amount_cents > 0_u128, 'INSURANCE: ZERO_DEPOSIT');
            self.assert_token_backing(amount_cents);
            self.insurance_balance.write(self.insurance_balance.read() + amount_cents);
            self.total_liquidation_remnants.write(self.total_liquidation_remnants.read() + amount_cents);

            self.emit(LiquidationRemnantDeposited {
                caller: get_caller_address(),
                amount_cents,
                new_balance: self.insurance_balance.read(),
            });
        }

        // Absorb bad debt by transferring REAL USDC to the caller (the vault).
        // Returns the actually absorbed amount; the caller records the remainder
        // as explicit bad debt. Never covers more than the real balance.
        fn absorb_bad_debt(ref self: ContractState, requested_cents: u128) -> u128 {
            self.assert_authorized();
            let current_balance = self.insurance_balance.read();
            let absorbed = if requested_cents <= current_balance {
                requested_cents
            } else {
                current_balance
            };

            if absorbed > 0_u128 {
                self.insurance_balance.write(current_balance - absorbed);
                self.total_bad_debt_absorbed.write(self.total_bad_debt_absorbed.read() + absorbed);

                let token = self.collateral_token.read();
                let token_units: u256 = (absorbed * TOKEN_DECIMAL_MULTIPLIER).into();
                let ok = IERC20Dispatcher { contract_address: token }
                    .transfer(get_caller_address(), token_units);
                assert(ok, 'INSURANCE: TRANSFER_FAILED');
            }

            self.emit(BadDebtAbsorbed {
                caller: get_caller_address(),
                requested_cents,
                actual_absorbed_cents: absorbed,
                remaining_insurance_balance: self.insurance_balance.read(),
            });

            absorbed
        }

        fn get_insurance_balance(self: @ContractState) -> u128 {
            self.insurance_balance.read()
        }

        fn get_target_reserve(self: @ContractState) -> u128 {
            self.target_reserve.read()
        }

        fn get_total_bad_debt_absorbed(self: @ContractState) -> u128 {
            self.total_bad_debt_absorbed.read()
        }

        fn get_contract_token_balance(self: @ContractState) -> u256 {
            let token = self.collateral_token.read();
            IERC20Dispatcher { contract_address: token }.balance_of(get_contract_address())
        }

        fn set_target_reserve(ref self: ContractState, target_cents: u128) {
            self.assert_admin();
            let old_target = self.target_reserve.read();
            self.target_reserve.write(target_cents);
            self.emit(TargetReserveUpdated { old_target, new_target: target_cents });
        }

        fn set_authorized_caller(ref self: ContractState, caller: ContractAddress, is_authorized: bool) {
            self.assert_admin();
            self.authorized_callers.write(caller, is_authorized);
            self.emit(AuthorizedCallerUpdated { caller, is_authorized });
        }

        fn is_authorized_caller(self: @ContractState, caller: ContractAddress) -> bool {
            self.authorized_callers.read(caller)
        }

        fn can_migrate(self: @ContractState) -> bool {
            self.insurance_balance.read() == 0_u128
        }
    }

    #[generate_trait]
    impl InternalMethods of InternalMethodsTrait {
        fn assert_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'INSURANCE: CALLER_NOT_ADMIN');
        }

        fn assert_authorized(self: @ContractState) {
            let caller = get_caller_address();
            assert(self.authorized_callers.read(caller), 'INSURANCE: UNAUTHORIZED_CALLER');
        }

        // Fail-closed real-custody check: the contract must physically hold enough
        // USDC to back the booked balance plus this contribution.
        fn assert_token_backing(self: @ContractState, amount_cents: u128) {
            let token = self.collateral_token.read();
            let bal = IERC20Dispatcher { contract_address: token }.balance_of(get_contract_address());
            let required_units: u256 =
                ((self.insurance_balance.read() + amount_cents) * TOKEN_DECIMAL_MULTIPLIER).into();
            assert(bal >= required_units, 'INSURANCE: UNBACKED_DEPOSIT');
        }
    }
}