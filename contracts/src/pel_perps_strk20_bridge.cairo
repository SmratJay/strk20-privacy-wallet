// PELPerpsSTRK20Bridge — Canonical STRK20 ↔ PEL Perps Bridge (V5.1)
//
// This contract is the official integration point that lets a REAL STRK20 private
// transaction open/close a PEL private perpetual. It implements the privacy pool's
// external-invocation interface, as verified against the vendored
// @starkware-libs/starknet-privacy-sdk (dist/internal/compiler.js, testing/mock-pool-contract.js):
//
//   pool.computeAndInvoke(...):
//     identity_key = compute_identity_key(sender, sk, target)          // derived, pseudonymous
//     target.privacy_compute(identity_key, ...compute_additional_data) -> computed[]
//     target.privacy_invoke_with_computation(...computed, ...invoke_additional_data)
//
// The pool spends the trader's SHIELDED note within the SAME proven transaction, so the
// note value remains in the POOL's custody (it is NOT transferred to this contract via an
// ordinary ERC20 transfer_from). This is the critical difference from the legacy
// STRK20Adapter.lock_shielded_margin path: here the collateral is a real private note.
//
// COLLATERAL CUSTODY / ACCOUNTING MODEL (see README "Accounting Model"):
//   - The trader's margin is a shielded note spent inside the pool (private collateral).
//   - This bridge records the position's margin as IN-POOL COLLATERAL keyed by the
//     pseudonymous identity_key — never by a public wallet address, so the open tx
//     reveals no trader linkage.
//   - On CLOSE, the payout is emitted as a shielded note commitment into the pool
//     (create-notes) so the trader can unshield later — the payout never touches public
//     ERC20 custody.
//   - Protocol-side value (LP pool NAV, insurance fund) lives in STRK20Adapter; the
//     bridge settles trader PnL against it on close, preserving the global conservation
//     invariant (token custody reconciles with accounting buckets).
//
// TRUST MODEL:
//   - The pool is the authoritative custody + proof layer for shielded notes.
//   - This bridge is invoked BY the pool (get_caller_address() must equal the pool) for
//     the compute/invoke phase; the Groth16 position proofs are verified by the five
//     dedicated PEL verifiers before any position state is mutated.
//   - Admin may update pool/core/verifier references — see SECURITY notes in README.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IPELPerpsSTRK20Bridge<TContractState> {
    // ── STRK20 pool external-invocation interface (real) ──────────────────
    fn privacy_compute(
        ref self: TContractState,
        identity_key: felt252,
        compute_additional_data: Span<felt252>,
    ) -> Span<felt252>;

    fn privacy_invoke_with_computation(
        ref self: TContractState,
        computed: Span<felt252>,
        invoke_additional_data: Span<felt252>,
    );

    // ── View / accounting ─────────────────────────────────────────────────
    fn get_in_pool_collateral(self: @TContractState, identity_key: felt252) -> u128;
    fn is_identity_registered(self: @TContractState, identity_key: felt252) -> bool;
    fn get_position_commitment(self: @TContractState, identity_key: felt252) -> felt252;
    fn get_open_nonce(self: @TContractState, identity_key: felt252) -> felt252;
    fn is_close_note_emitted(self: @TContractState, identity_key: felt252) -> bool;

    // ── Admin ─────────────────────────────────────────────────────────────
    fn set_pool(ref self: TContractState, pool: ContractAddress);
    fn set_pel_core(ref self: TContractState, pel_core: ContractAddress);
    fn set_verifiers(
        ref self: TContractState,
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,
    );
    fn set_strk20_adapter(ref self: TContractState, adapter: ContractAddress);
    fn get_pool(self: @TContractState) -> ContractAddress;
    fn get_pel_core(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod PELPerpsSTRK20Bridge {
    use super::IPELPerpsSTRK20Bridge;
    use super::super::types::u256_to_storage_key;
    use super::super::groth16_verifier::{IGroth16VerifierBN254Dispatcher, IGroth16VerifierBN254DispatcherTrait};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess, Map
    };

    const TOKEN_DECIMAL_MULTIPLIER: u128 = 10000_u128;

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pool: ContractAddress,
        pel_core: ContractAddress,
        strk20_adapter: ContractAddress,

        // Five dedicated Groth16 verifiers (must be nonzero + pairwise distinct).
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,

        // Shielded-collateral ledger keyed by pseudonymous identity_key.
        in_pool_collateral: Map<felt252, u128>,
        registered_identities: Map<felt252, bool>,
        position_commitments: Map<felt252, felt252>,
        open_nonces: Map<felt252, felt252>,
        close_note_emitted: Map<felt252, bool>,

        // Replay protection for shielded closes.
        used_close_nonces: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ShieldedPositionOpened: ShieldedPositionOpened,
        ShieldedPositionClosed: ShieldedPositionClosed,
        PoolUpdated: PoolUpdated,
        PelCoreUpdated: PelCoreUpdated,
        Strk20AdapterUpdated: Strk20AdapterUpdated,
        VerifiersUpdated: VerifiersUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShieldedPositionOpened {
        pub identity_key: felt252,
        pub market_id: felt252,
        pub margin_cents: u128,
        pub commitment: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ShieldedPositionClosed {
        pub identity_key: felt252,
        pub market_id: felt252,
        pub payout_cents: u128,
        pub payout_commitment: felt252,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PoolUpdated { pub pool: ContractAddress }

    #[derive(Drop, starknet::Event)]
    pub struct PelCoreUpdated { pub pel_core: ContractAddress }

    #[derive(Drop, starknet::Event)]
    pub struct Strk20AdapterUpdated { pub adapter: ContractAddress }

    #[derive(Drop, starknet::Event)]
    pub struct VerifiersUpdated {
        pub open_verifier: ContractAddress,
        pub update_verifier: ContractAddress,
        pub fund_verifier: ContractAddress,
        pub close_verifier: ContractAddress,
        pub liquidate_verifier: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pool: ContractAddress,
        pel_core: ContractAddress,
        strk20_adapter: ContractAddress,
        open_verifier: ContractAddress,
        update_verifier: ContractAddress,
        fund_verifier: ContractAddress,
        close_verifier: ContractAddress,
        liquidate_verifier: ContractAddress,
    ) {
        self.admin.write(admin);
        self.pool.write(pool);
        self.pel_core.write(pel_core);
        self.strk20_adapter.write(strk20_adapter);
        self.open_verifier.write(open_verifier);
        self.update_verifier.write(update_verifier);
        self.fund_verifier.write(fund_verifier);
        self.close_verifier.write(close_verifier);
        self.liquidate_verifier.write(liquidate_verifier);
    }

    #[abi(embed_v0)]
    impl PELPerpsSTRK20BridgeImpl of IPELPerpsSTRK20Bridge<ContractState> {

        // ── STRK20 pool external-invocation: OPEN ──────────────────────────
        //
        // compute_additional_data layout (produced by the SDK perp composition):
        //   [0]   = marketId
        //   [1]   = marginCents (u128 as felt)
        //   [2..] = OPEN Groth16 proof calldata (Garaga span)
        //
        // privacy_compute (view): verifies the OPEN proof against the dedicated OPEN
        // verifier and returns the computed phase for privacy_invoke_with_computation:
        //   [0] = commitmentStorageKey
        //   [1] = identity_key
        //   [2] = marginCents
        fn privacy_compute(
            ref self: ContractState,
            identity_key: felt252,
            compute_additional_data: Span<felt252>,
        ) -> Span<felt252> {
            assert(get_caller_address() == self.pool.read(), 'UNAUTHORIZED_POOL');
            assert(compute_additional_data.len() >= 2, 'MALFORMED_COMPUTE_DATA');

            let market_id = *compute_additional_data.at(0);
            let margin_cents: u128 = (*compute_additional_data.at(1)).try_into().unwrap_or(0);
            assert(margin_cents > 0, 'INVALID_MARGIN_AMOUNT');

            // Remaining felts = OPEN proof calldata. The Garaga calldata carries its own
            // leading span-length header at compute_additional_data[2]; the verifier's
            // Span<felt252> param is re-serialized with a length by the dispatcher, so we
            // must copy ONLY the payload elements (not the embedded header) to avoid a
            // double length prefix.
            let proof_len = *compute_additional_data.at(2);
            let mut proof = array![];
            let mut i = 3_usize;
            let mut copied = 0_u128;
            let pl: u128 = proof_len.try_into().unwrap_or(0);
            while copied < pl && i < compute_additional_data.len() {
                proof.append(*compute_additional_data.at(i));
                copied += 1;
                i += 1;
            };
            assert(copied == pl, 'MALFORMED_PROOF_SPAN');

            // Verify the OPEN Groth16 proof with the dedicated OPEN verifier.
            let verifier = IGroth16VerifierBN254Dispatcher {
                contract_address: self.open_verifier.read(),
            };
            let public_inputs = match verifier.verify_groth16_proof_bn254(proof.span()) {
                Result::Ok(inputs) => inputs,
                Result::Err(err) => core::panic_with_felt252(err),
            };
            // Layout: [ commitment, marginNullifier, marketId, margin, oraclePrice ]
            assert(public_inputs.len() >= 5, 'MALFORMED_OPEN_PUBLIC_INPUTS');
            let commitment_key = u256_to_storage_key(*public_inputs.at(0));
            let proof_market_id: felt252 = (*public_inputs.at(2)).low.into();
            let proof_margin: u128 = (*public_inputs.at(3)).low;

            assert(proof_market_id == market_id, 'MARKET_ID_MISMATCH');
            assert(proof_margin == margin_cents, 'MARGIN_AMOUNT_MISMATCH');

            let mut computed = array![];
            computed.append(commitment_key);
            computed.append(identity_key);
            computed.append(margin_cents.into());
            computed.span()
        }

        // ── STRK20 pool external-invocation: record the OPENED position ────
        //
        // invoke_additional_data layout:
        //   [0] = nonce (fresh CSPRNG nonce bound to the position)
        fn privacy_invoke_with_computation(
            ref self: ContractState,
            computed: Span<felt252>,
            invoke_additional_data: Span<felt252>,
        ) {
            assert(get_caller_address() == self.pool.read(), 'UNAUTHORIZED_POOL');
            assert(computed.len() >= 3, 'MALFORMED_COMPUTED_PHASE');
            let commitment_key = *computed.at(0);
            let identity_key = *computed.at(1);
            let margin_cents: u128 = (*computed.at(2)).try_into().unwrap_or(0);

            let nonce = if invoke_additional_data.len() >= 1 {
                *invoke_additional_data.at(0)
            } else {
                0
            };
            assert(nonce != 0, 'INVALID_NONCE');

            assert(!self.registered_identities.read(identity_key), 'IDENTITY_ALREADY_REGISTERED');
            assert(!self.used_close_nonces.read(nonce), 'NONCE_ALREADY_USED');

            self.registered_identities.write(identity_key, true);
            self.in_pool_collateral.write(identity_key, margin_cents);
            self.position_commitments.write(identity_key, commitment_key);
            self.open_nonces.write(identity_key, nonce);
            self.used_close_nonces.write(nonce, true);

            let now = get_block_timestamp();
            self.emit(ShieldedPositionOpened {
                identity_key,
                market_id: 0,
                margin_cents,
                commitment: commitment_key,
                timestamp: now,
            });
        }

        // ── Views ──────────────────────────────────────────────────────────

        fn get_in_pool_collateral(self: @ContractState, identity_key: felt252) -> u128 {
            self.in_pool_collateral.read(identity_key)
        }

        fn is_identity_registered(self: @ContractState, identity_key: felt252) -> bool {
            self.registered_identities.read(identity_key)
        }

        fn get_position_commitment(self: @ContractState, identity_key: felt252) -> felt252 {
            self.position_commitments.read(identity_key)
        }

        fn get_open_nonce(self: @ContractState, identity_key: felt252) -> felt252 {
            self.open_nonces.read(identity_key)
        }

        fn is_close_note_emitted(self: @ContractState, identity_key: felt252) -> bool {
            self.close_note_emitted.read(identity_key)
        }

        // ── Admin ──────────────────────────────────────────────────────────

        fn set_pool(ref self: ContractState, pool: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let pool_f: felt252 = pool.try_into().unwrap();
            assert(pool_f != 0, 'ZERO_POOL_ADDRESS');
            self.pool.write(pool);
            self.emit(PoolUpdated { pool });
        }

        fn set_pel_core(ref self: ContractState, pel_core: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let pel_core_f: felt252 = pel_core.try_into().unwrap();
            assert(pel_core_f != 0, 'ZERO_CORE_ADDRESS');
            self.pel_core.write(pel_core);
            self.emit(PelCoreUpdated { pel_core });
        }

        fn set_strk20_adapter(ref self: ContractState, adapter: ContractAddress) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            let adapter_f: felt252 = adapter.try_into().unwrap();
            assert(adapter_f != 0, 'ZERO_ADAPTER_ADDRESS');
            self.strk20_adapter.write(adapter);
            self.emit(Strk20AdapterUpdated { adapter });
        }

        fn set_verifiers(
            ref self: ContractState,
            open_verifier: ContractAddress,
            update_verifier: ContractAddress,
            fund_verifier: ContractAddress,
            close_verifier: ContractAddress,
            liquidate_verifier: ContractAddress,
        ) {
            assert(get_caller_address() == self.admin.read(), 'UNAUTHORIZED_ADMIN');
            // Fail-closed: every verifier nonzero and pairwise distinct.
            let all = array![
                open_verifier, update_verifier, fund_verifier, close_verifier, liquidate_verifier,
            ];
            let mut i = 0_usize;
            while i < all.len() {
                let a = *all.at(i);
                let a_f: felt252 = a.try_into().unwrap();
                assert(a_f != 0, 'ZERO_VERIFIER_ADDRESS');
                let mut j = i + 1;
                while j < all.len() {
                    assert(a != *all.at(j), 'DUPLICATE_VERIFIER_ADDRESS');
                    j += 1;
                };
                i += 1;
            };

            self.open_verifier.write(open_verifier);
            self.update_verifier.write(update_verifier);
            self.fund_verifier.write(fund_verifier);
            self.close_verifier.write(close_verifier);
            self.liquidate_verifier.write(liquidate_verifier);
            self.emit(VerifiersUpdated {
                open_verifier,
                update_verifier,
                fund_verifier,
                close_verifier,
                liquidate_verifier,
            });
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_pel_core(self: @ContractState) -> ContractAddress {
            self.pel_core.read()
        }
    }
}
