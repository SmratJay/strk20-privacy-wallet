//! Shared on-chain types for UMBRA LAUNCH.
//!
//! `OpenNoteDeposit` mirrors `privacy::objects::OpenNoteDeposit` (byte-for-byte Serde
//! layout) so the privacy pool can deserialize the `Span<OpenNoteDeposit>` returned by
//! `PrivateCurveExecutor::privacy_invoke`. It is re-declared locally to keep this package
//! free of the upstream `privacy` crate dependency.

use starknet::ContractAddress;

/// Deposit to apply to an open note. Returned by a `privacy_invoke` executor and applied
/// by the STRK20 privacy pool: the pool pulls `amount` of `token` from the executor and
/// fills the open note `note_id`.
#[derive(Serde, Drop, Copy)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

/// Curve operation selector used in `PrivateCurveExecutor::privacy_invoke` calldata.
pub mod curve_operation {
    pub const BUY: u8 = 0;
    pub const SELL: u8 = 1;
}