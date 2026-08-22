# PEL Liquidity & Counterparty System Architecture

**Document Version:** 1.0.0  
**Specification:** PEL Liquidity & Counterparty System Design v1.0 (22 Aug 2026)

---

## 1. Executive Overview

The **PEL Liquidity & Counterparty System** provides the explicit economic counterparty backing private perpetual positions on Starknet. Rather than relying on a complex private orderbook, PEL implements an **oracle-priced synthetic market** where the `PELLiquidityVault` acts as the counterparty to all traders.

The architecture is governed by the core separation of responsibilities:
- **Cairo = LAW**: On-chain custody, proportional LP shares, economic NAV, fee routing, insurance reserve, and settlement execution.
- **Rust = BRAIN**: High-throughput risk calculations, market-data aggregation, autonomous keeper monitoring, stress simulation, and transaction orchestration.
- **STRK20 = PRIVATE MONEY**: Shielded ERC-20 notes, private transfers, and note-based payout settlement.
- **Groth16/Garaga = PRIVATE VALIDITY**: Cryptographic proofs demonstrating valid position opening, state rollover, funding settlement, and liquidation without disclosing trader secrets.
- **TypeScript = UX**: Client interface, intent assembly, and terminal analytics (with **No Fake Yield** disclosures).

---

## 2. Core Contract Subsystems

### A. `PELLiquidityVault.cairo`
- **State Managed**: `lp_pool_nav`, `total_lp_shares`, `lp_shares_balances`, `total_locked_collateral`, `unclaimed_payouts_total`, `unclaimed_bounties_total`, `pending_withdrawals_total`.
- **Key Operations**:
  - `deposit_liquidity(amount_cents)`: Mints proportional LP shares with anti-inflation virtual bootstrap.
  - `request_withdrawal(shares)`: Enforces 1-hour cooldown and checks that available liquidity does not breach the 50% locked margin reserve.
  - `claim_withdrawal(request_id)`: Burns shares and transfers USDC out.
  - `settle_trader_pnl(profit_cents, is_profit, commitment, recipient)`: Settles trader gains/losses directly against LP NAV.
  - `settle_funding(amount_cents, is_long_pays)`: Accrues or disburses funding payments.
  - `settle_liquidation(seized_cents, bounty_cents, keeper)`: Distributes seized collateral across keeper bounty, LP NAV (70%), and Insurance Reserve (20%).

### B. `PELInsuranceReserve.cairo`
- **State Managed**: `insurance_balance`, `target_reserve`, `total_bad_debt_absorbed`.
- **Key Operations**:
  - `deposit_fee_contribution(amount_cents)`: Receives 20% of protocol trading fees.
  - `deposit_liquidation_remnant(amount_cents)`: Receives 20% of liquidated margin remnants.
  - `absorb_bad_debt(requested_cents)`: Absorbs underwater trader deficits before emergency LP drawdown.

### C. `crates/pel-risk-engine/` (Rust Brain)
- **`risk_engine.rs`**: Integer fixed-point PnL, equity, maintenance margin, utilization, and bad debt calculations matching Cairo canonical law.
- **`keeper.rs`**: Autonomous, idempotent liquidation scanner.
- **`simulator.rs`**: 14-scenario market shock simulator (BTC +/-1%, +/-5%, +/-20%, flash crashes, high utilization, winning/losing runs).
- **`golden_vectors.rs`**: Deterministic test vectors shared between Rust, Cairo, and TypeScript.
