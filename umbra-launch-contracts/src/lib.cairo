//! UMBRA LAUNCH — private memecoin launchpad on Starknet.
//!
//! Public market + private execution. The market (BondingCurve) is a single canonical
//! virtual-reserve constant-product curve. Private trades run through the STRK20 privacy
//! pool's invoke-anonymizer model (`PrivateCurveExecutor`), exactly like the official
//! Ekubo swap anonymizer.

pub mod objects;
pub mod interfaces;
pub mod memecoin;
pub mod bonding_curve;
pub mod token_factory;
pub mod private_curve_executor;
pub mod graduation_router;
/// Test-only ERC20 with public mint (used as the base asset in snforge tests).
pub mod test_base_asset;