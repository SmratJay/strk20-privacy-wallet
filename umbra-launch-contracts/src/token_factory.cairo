//! TokenFactory — deploys a memecoin + its canonical BondingCurve + its private executor.
//!
//! Uses the standard Starknet class-deployment approach: the factory holds the declared
//! class hashes and deploys fresh instances per token. Deploy order inside one transaction:
//!   1. Memecoin (fixed supply minted to the factory)
//!   2. BondingCurve (deployer = creator, graduation_recipient = router)
//!   3. factory moves the full supply to the curve
//!   4. PrivateCurveExecutor (bound to the pool, curve, base asset and token)
//!
//! There is no owner-mintable token mechanic: the supply is minted once at construction
//! and owned by the curve.

use starknet::ContractAddress;

use crate::interfaces::{IMemecoinDispatcher, IMemecoinDispatcherTrait};

#[starknet::interface]
pub trait ITokenFactory<TContractState> {
    fn create_memecoin(
        ref self: TContractState,
        name: felt252,
        symbol: felt252,
        decimals: u8,
        metadata_uri: felt252,
        total_supply: u256,
        virtual_base_reserve: u128,
        virtual_token_reserve: u128,
        graduation_target: u128,
        fee_bps: u128,
    ) -> (ContractAddress, ContractAddress, ContractAddress);
    fn get_token_count(self: @TContractState) -> u128;
    fn get_token(self: @TContractState, id: u128) -> ContractAddress;
    fn get_curve(self: @TContractState, id: u128) -> ContractAddress;
    fn get_executor(self: @TContractState, id: u128) -> ContractAddress;
    fn get_metadata(self: @TContractState, token: ContractAddress) -> felt252;
    fn get_creator(self: @TContractState, token: ContractAddress) -> ContractAddress;
    fn get_router(self: @TContractState) -> ContractAddress;
    fn get_base_asset(self: @TContractState) -> ContractAddress;
    fn get_privacy_pool(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod TokenFactory {
    use super::{
        ITokenFactory, IMemecoinDispatcher, IMemecoinDispatcherTrait,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, Map,
    };
    use starknet::syscalls::deploy_syscall;
    use starknet::SyscallResultTrait;
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        governance: ContractAddress,
        base_asset: ContractAddress,
        privacy_pool: ContractAddress,
        router: ContractAddress,
        memecoin_class_hash: starknet::class_hash::ClassHash,
        curve_class_hash: starknet::class_hash::ClassHash,
        executor_class_hash: starknet::class_hash::ClassHash,
        token_count: u128,
        tokens: Map<u128, ContractAddress>,
        curves: Map<u128, ContractAddress>,
        executors: Map<u128, ContractAddress>,
        metadata: Map<ContractAddress, felt252>,
        /// creator of each token (for UI attribution)
        creators: Map<ContractAddress, ContractAddress>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TokenCreated: TokenCreated,
        CurveCreated: CurveCreated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokenCreated {
        pub id: u128,
        pub creator: ContractAddress,
        pub token: ContractAddress,
        pub curve: ContractAddress,
        pub executor: ContractAddress,
        pub name: felt252,
        pub symbol: felt252,
        pub total_supply: u256,
        pub metadata_uri: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CurveCreated {
        pub id: u128,
        pub curve: ContractAddress,
        pub base_asset: ContractAddress,
        pub token: ContractAddress,
        pub virtual_base_reserve: u128,
        pub virtual_token_reserve: u128,
        pub graduation_target: u128,
        pub fee_bps: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        governance: ContractAddress,
        base_asset: ContractAddress,
        privacy_pool: ContractAddress,
        router: ContractAddress,
        memecoin_class_hash: starknet::class_hash::ClassHash,
        curve_class_hash: starknet::class_hash::ClassHash,
        executor_class_hash: starknet::class_hash::ClassHash,
    ) {
        assert(governance.is_non_zero(), 'ZERO_GOVERNANCE');
        assert(base_asset.is_non_zero(), 'ZERO_BASE_ASSET');
        assert(privacy_pool.is_non_zero(), 'ZERO_POOL');
        assert(router.is_non_zero(), 'ZERO_ROUTER');
        self.governance.write(governance);
        self.base_asset.write(base_asset);
        self.privacy_pool.write(privacy_pool);
        self.router.write(router);
        self.memecoin_class_hash.write(memecoin_class_hash);
        self.curve_class_hash.write(curve_class_hash);
        self.executor_class_hash.write(executor_class_hash);
        self.token_count.write(0);
    }

    #[abi(embed_v0)]
    impl TokenFactoryImpl of ITokenFactory<ContractState> {
        fn create_memecoin(
            ref self: ContractState,
            name: felt252,
            symbol: felt252,
            decimals: u8,
            metadata_uri: felt252,
            total_supply: u256,
            virtual_base_reserve: u128,
            virtual_token_reserve: u128,
            graduation_target: u128,
            fee_bps: u128,
        ) -> (ContractAddress, ContractAddress, ContractAddress) {
            assert(name.is_non_zero(), 'ZERO_NAME');
            assert(symbol.is_non_zero(), 'ZERO_SYMBOL');
            assert(total_supply > 0, 'ZERO_SUPPLY');
            assert(virtual_base_reserve > 0, 'ZERO_VIRTUAL_BASE');
            assert(virtual_token_reserve > 0, 'ZERO_VIRTUAL_TOKEN');
            assert(graduation_target > 0, 'ZERO_GRAD_TARGET');
            assert(fee_bps <= 10_000, 'FEE_TOO_HIGH');

            let id = self.token_count.read();
            let salt: felt252 = id.into();
            let creator = get_caller_address();
            let factory = get_contract_address();

            // 1. Deploy the memecoin with the full supply minted to the factory.
            let mut token_calldata: Array<felt252> = array![];
            name.serialize(ref token_calldata);
            symbol.serialize(ref token_calldata);
            decimals.serialize(ref token_calldata);
            factory.serialize(ref token_calldata);
            total_supply.serialize(ref token_calldata);
            let (token, _) = deploy_syscall(
                self.memecoin_class_hash.read(), salt, token_calldata.span(), false,
            ).unwrap_syscall();

            // 2. Deploy the curve (deployer = creator, graduation_recipient = router).
            let mut curve_calldata: Array<felt252> = array![];
            self.base_asset.read().serialize(ref curve_calldata);
            token.serialize(ref curve_calldata);
            virtual_base_reserve.serialize(ref curve_calldata);
            virtual_token_reserve.serialize(ref curve_calldata);
            graduation_target.serialize(ref curve_calldata);
            fee_bps.serialize(ref curve_calldata);
            creator.serialize(ref curve_calldata);
            self.router.read().serialize(ref curve_calldata);
            let (curve, _) = deploy_syscall(
                self.curve_class_hash.read(), salt, curve_calldata.span(), false,
            ).unwrap_syscall();

            // 3. Move the full supply from the factory to the curve (one atomic step).
            let memecoin = IMemecoinDispatcher { contract_address: token };
            let ok = memecoin.transfer(curve, total_supply);
            assert(ok, 'SUPPLY_TRANSFER_FAILED');

            // 4. Deploy the private executor for this curve.
            let mut executor_calldata: Array<felt252> = array![];
            self.privacy_pool.read().serialize(ref executor_calldata);
            curve.serialize(ref executor_calldata);
            self.base_asset.read().serialize(ref executor_calldata);
            token.serialize(ref executor_calldata);
            let (executor, _) = deploy_syscall(
                self.executor_class_hash.read(), salt, executor_calldata.span(), false,
            ).unwrap_syscall();

            self.token_count.write(id + 1);
            self.tokens.write(id, token);
            self.curves.write(id, curve);
            self.executors.write(id, executor);
            self.metadata.write(token, metadata_uri);
            self.creators.write(token, creator);

            self.emit(TokenCreated {
                id, creator, token, curve, executor, name, symbol, total_supply, metadata_uri,
            });
            self.emit(CurveCreated {
                id, curve, base_asset: self.base_asset.read(), token,
                virtual_base_reserve, virtual_token_reserve, graduation_target, fee_bps,
            });

            (token, curve, executor)
        }

        fn get_token_count(self: @ContractState) -> u128 {
            self.token_count.read()
        }

        fn get_token(self: @ContractState, id: u128) -> ContractAddress {
            self.tokens.read(id)
        }

        fn get_curve(self: @ContractState, id: u128) -> ContractAddress {
            self.curves.read(id)
        }

        fn get_executor(self: @ContractState, id: u128) -> ContractAddress {
            self.executors.read(id)
        }

        fn get_metadata(self: @ContractState, token: ContractAddress) -> felt252 {
            self.metadata.read(token)
        }

        fn get_creator(self: @ContractState, token: ContractAddress) -> ContractAddress {
            self.creators.read(token)
        }

        fn get_router(self: @ContractState) -> ContractAddress {
            self.router.read()
        }

        fn get_base_asset(self: @ContractState) -> ContractAddress {
            self.base_asset.read()
        }

        fn get_privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }
    }
}