// PEL Insurance Reserve Contract — V1.0 (Whitepaper Section 9)
// Isolated Tail-Risk Reserve for Absorbing Liquidation Bad Debt and Tail Losses

use starknet::ContractAddress;

#[starknet::interface]
pub trait IPELInsuranceReserve<TContractState> {
    fn deposit_fee_contribution(ref self: TContractState, amount_cents: u128);
    fn deposit_liquidation_remnant(ref self: TContractState, amount_cents: u128);
    fn absorb_bad_debt(ref self: TContractState, requested_cents: u128) -> u128;
    fn get_insurance_balance(self: @TContractState) -> u128;
    fn get_target_reserve(self: @TContractState) -> u128;
    fn get_total_bad_debt_absorbed(self: @TContractState) -> u128;
    fn set_target_reserve(ref self: TContractState, target_cents: u128);
    fn set_authorized_caller(ref self: TContractState, caller: ContractAddress, is_authorized: bool);
    fn is_authorized_caller(self: @TContractState, caller: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod PELInsuranceReserve {
    use super::IPELInsuranceReserve;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    #[storage]
    struct Storage {
        admin: ContractAddress,
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
    fn constructor(ref self: ContractState, admin: ContractAddress, target_reserve_cents: u128) {
        self.admin.write(admin);
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
            let current = self.insurance_balance.read();
            let updated = current + amount_cents;
            self.insurance_balance.write(updated);
            self.total_fee_contributions.write(self.total_fee_contributions.read() + amount_cents);

            self.emit(FeeContributionDeposited {
                caller: get_caller_address(),
                amount_cents,
                new_balance: updated,
            });
        }

        fn deposit_liquidation_remnant(ref self: ContractState, amount_cents: u128) {
            self.assert_authorized();
            let current = self.insurance_balance.read();
            let updated = current + amount_cents;
            self.insurance_balance.write(updated);
            self.total_liquidation_remnants.write(self.total_liquidation_remnants.read() + amount_cents);

            self.emit(LiquidationRemnantDeposited {
                caller: get_caller_address(),
                amount_cents,
                new_balance: updated,
            });
        }

        fn absorb_bad_debt(ref self: ContractState, requested_cents: u128) -> u128 {
            self.assert_authorized();
            let current_balance = self.insurance_balance.read();
            let absorbed = if requested_cents <= current_balance {
                requested_cents
            } else {
                current_balance
            };

            self.insurance_balance.write(current_balance - absorbed);
            self.total_bad_debt_absorbed.write(self.total_bad_debt_absorbed.read() + absorbed);

            self.emit(BadDebtAbsorbed {
                caller: get_caller_address(),
                requested_cents,
                actual_absorbed_cents: absorbed,
                remaining_insurance_balance: current_balance - absorbed,
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
    }
}
