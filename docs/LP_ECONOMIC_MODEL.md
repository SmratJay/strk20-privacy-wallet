# PEL LP Economic Model, Solvency & STRK20 Settlement

**Document Version:** 2.0.0  
**Specification:** PEL Liquidity & Counterparty System Master Specification (22 Aug 2026)

---

## 1. Core Economic Architecture

PEL implements a single-asset (USDC) synthetic perpetual exchange where the `PELLiquidityVault` acts as the direct economic counterparty to BTC-PERP positions.

### Separation of Responsibilities:
- **Cairo (Law)**: Custody, share minting/burning, proportional NAV pricing, fee routing, tail-risk insurance reserve, and settlement execution.
- **Rust (Brain)**: High-throughput risk calculations, market data aggregation, autonomous liquidation scanning, stress simulation, and transaction orchestration.
- **STRK20 (Private Money Rail)**: Shielded ERC-20 notes, private note commitments, nullifiers, and confidential payouts.
- **Groth16 / Garaga (ZK Validity)**: Zero-knowledge validity proofs for position opening, state rotation, funding accrual, and liquidation without leaking secrets.
- **TypeScript (Client / UX)**: Honest, fail-closed terminal interface with **No Fake Yield** disclosures.

---

## 2. STRK20 Pool Collateral Model (Option B)

The STRK20 privacy pool is the **permanent custody boundary for shielded positions**. It is not treated as a conventional ERC-20 account.

- **Private Custody**: Real USDC collateral deposited by shielded traders remains custodied inside the `STRK20PrivacyPool` contract.
- **Economic Claim (`pool_margin_cents`)**: Active shielded trader collateral committed to open positions.
- **Realizable Collateral (`pool_assets_cents`)**: Real USDC backing inside the STRK20 pool dedicated to PEL perps.
- **LP Solvency**: Fully backed by the sum of `vault_tokens + pool_assets_cents` against total liabilities.

When a shielded trader opens a position via `PELPerpsSTRK20Bridge`:
1. The trader's shielded note is spent inside the privacy pool.
2. `PELPerpsCore.open_position_shielded` verifies the Groth16 OPEN proof.
3. `PELLiquidityVault.lock_pool_custodied_margin` records `pool_margin_cents += margin` and `pool_assets_cents += margin`.
4. On close with profit: `pool_margin_cents -= margin`, LP NAV funds the profit, and a payout note is registered.
5. On close with loss: `pool_margin_cents -= margin`, LP NAV increases by the realized loss, and the unspent margin in `pool_assets_cents` becomes LP surplus.

---

## 3. Global Conservation Invariant

Across every state transition (deposit, open, fund, close, liquidate, claim, withdraw), the balance sheet is strictly conserved:

86520\text{Vault Tokens (cents)} + \text{Pool Assets (cents)} \equiv \text{Locked Margin} + \text{Pool Margin} + \text{LP NAV} + \text{Unclaimed Payouts} + \text{Unclaimed Bounties} + \text{Pending Withdrawals} + \text{Treasury} + \text{Bad Debt}86520

### Economic NAV Formula:
86520\text{Economic NAV} = (\text{Vault Tokens} + \text{Pool Assets}) - (\text{Locked Margin} + \text{Pool Margin} + \text{Payouts} + \text{Bounties} + \text{Withdrawals} + \text{Treasury})86520

---

## 4. Counterparty PnL vs Protocol Revenue Split

### A. Trader PnL (Counterparty Risk)
- **Trader Profit**: Debited 100% from LP NAV. If profit exceeds LP NAV, `PELInsuranceReserve` absorbs the deficit with real USDC. If combined capacity is exceeded, the transaction REVERTS (fail-closed).
- **Trader Loss**: Credited 100% to LP NAV.

### B. Protocol Revenue (Liquidation Remnants)
When a position is liquidated:
- **Keeper Bounty**: 2% of seized margin (capped at .00 / 50,000 cents).
- **Remnant Allocation**:
  - **70%** -> LP Pool NAV
  - **20%** -> PEL Insurance Reserve (real USDC transfer)
  - **10%** (+ integer remainder) -> Protocol Treasury

---

## 5. Insurance-Backed Profit Settlement (P0 #3)

When a trader realizes profit $ on a position with margin $ (total payout  + P$):

1. If  \le \text{LP NAV}$:
   86520\text{LP NAV}_{\text{after}} = \text{LP NAV}_{\text{before}} - P86520
2. If  > \text{LP NAV}$:
   86520\text{LP Contribution} = \text{LP NAV}_{\text{before}}86520
   86520\text{Deficit} = P - \text{LP NAV}_{\text{before}}86520
   86520\text{Absorbed} = \text{InsuranceReserve.absorb_bad_debt}(\text{Deficit})86520
   86520\text{Assert}(\text{LP Contribution} + \text{Absorbed} \ge P) \implies \text{REVERT if insolvent}86520
   86520\text{LP NAV}_{\text{after}} = 086520

---

## 6. Proportional Share Pricing & Model A Withdrawal Queue

### Deposit Math (Anti-Inflation Bootstrap):
- Initial bootstrap: .00 USD (100 cents) = 1,000,000 shares (.000000 / share).
- Proportional entry: $\text{SharesMinted} = \lfloor \frac{\text{Amount} \times \text{TotalShares}}{\text{NAV}} \rfloor$.
- Share price: $\text{SharePriceE6} = \frac{\text{NAV} \times 10^6 \times 10,000}{\text{TotalShares}}$.

### Model A Withdrawal Queue:
- **Request**: Shares are burned and NAV is debited immediately at $\text{GrossPayout} = \lfloor \frac{\text{SharesBurned} \times \text{NAV}}{\text{TotalShares}} \rfloor$. Queued LPs do not participate in subsequent trading gains or losses.
- **Cooldown**: 1 funding epoch (1 hour / 3,600 seconds).
- **Claim**: Transfers frozen real USDC to the LP.
