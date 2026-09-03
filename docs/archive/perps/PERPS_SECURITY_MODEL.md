# PEL Private Perpetuals — Security Model & Threat Analysis

**Protocol Version:** 2.1 (V4 Enforcement Layer Rebuild)  
**Verification Framework:** Fact Registry & Real ERC20 Custody State Machine  

---

## 1. Formal Trust Model

PEL V4 operates on a **Fact Registry & Real ERC20 Custody Model**:
1. **Zero-Knowledge Witness Privacy:** The client generates cryptographic commitments using the STARK-friendly Poseidon hash over the Starknet prime field. All position attributes ($q, P_e, M, \text{side}, \text{secret}$) remain on the client device inside encrypted AES-GCM local storage.
2. **Prover-Authorized Fact Registry:** State transitions require pre-registered facts registered by an authorized prover (`prover_address`) or protocol admin. Client-side fact forgery is mathematically impossible because the on-chain contract only checks `verified_facts[fact_hash] == true`.
3. **Real Collateral Custody:** STRK20Adapter directly holds and custodies underlying ERC20 tokens (e.g., TestUSDC). Tokens are pulled via `transferFrom` on position open and pushed via `transfer` on payout/bounty claims.
4. **On-Chain Solvency Invariants:** Payouts on close are strictly bounded by deposited locked margin (`payout <= locked_margin`).

---

## 2. Threat Model & Attack Vectors Defended

| Vector ID | Attack Scenario | Protocol Defense & Invariant Enforced |
| :--- | :--- | :--- |
| **AV-01** | **Nullifier Replay Attack** | `used_nullifiers` mapping in Cairo storage permanently marks nullifier $N_t$ as true on first consumption. Replay attempts revert with `NULLIFIER_ALREADY_SPENT`. |
| **AV-02** | **Stale / Future Oracle Manipulation** | `OracleAdapter` rejects prices older than $180\text{s}$ (`ORACLE_UPDATE_STALE`) and prices with timestamps in the future (`FUTURE_PRICE_TIMESTAMP`). |
| **AV-03** | **Unbacked Payout Theft / Inflation** | Cairo `close_position` asserts `payout_amount <= pos.locked_margin`. Payout note commitments are registered in storage and can only be claimed once. |
| **AV-04** | **Client-Side Fact Forgery** | `StwoVerifier` requires facts to be pre-registered by authorized prover. Local computation of fact hashes cannot bypass the registry. |
| **AV-05** | **Commitment Side-Flipping (B1 Attack)** | Side (`'LONG'` / `'SHORT'`) is explicitly hashed into the position commitment $C_t$. |
| **AV-06** | **Market ID Cross-Market Spoofing (B5 Attack)** | State machine checks that `stored_record.market_id == input.market_id` on every position transition. |
| **AV-07** | **Direct Token Drain Attack** | `claim_payout` requires `registered_notes[commitment] > 0` and unconsumed status. Cannot drain arbitrary tokens. |
| **AV-08** | **Floating-Point Precision Drift** | 100% of mathematical operations use pure BigInt fixed-point arithmetic with floor rounding. |
| **AV-09** | **Front-Running Liquidation** | Once an autonomous keeper submits a valid liquidation fact, the position's nullifier is spent atomically, preventing conflicting withdrawals. |

---

## 3. Bad Debt Waterfall & Solvency Invariant

In the event of market gap risk:

$$\text{Deficit} = |E_t|$$

### Waterfall Execution:
1. **Position Collateral ($M$):** 100% of the position's locked margin is seized.
2. **Keeper Bounty ($2\%$):** $M \times 2\%$ is allocated to the keeper to incentivize liquidation liveness.
3. **Protocol Insurance Fund ($98\%$):** $M \times 98\%$ is credited to the insurance fund to absorb trading losses.
4. **Protocol Liquidity Reserve Backstop:** If insurance fund is depleted, the backstop liquidity pool covers residual deficit.
