# PEL Private Perpetuals — Security Model & Threat Analysis

**Protocol Version:** 2.0 (V3 Engine Remediation)  
**Verification Framework:** Poseidon SNIP-36 Fact Commitment State Machine  

---

## 1. Formal Trust Model

PEL V1 operates on a **Poseidon SNIP-36 Fact Commitment Model**:
1. **Zero-Knowledge Witness Privacy:** The client generates cryptographic commitments using the STARK-friendly Poseidon hash over the BN254 / Starknet prime field $\mathbb{F}_p$. All position attributes ($q, P_e, M, \text{side}, \text{secret}$) remain on the client device inside encrypted AES-GCM local storage.
2. **Deterministic Algebraic Transition Facts:** Every state transition generates a sealed fact $\Phi = \text{Poseidon}(\text{FACT\_TAG}, \text{proof\_type}, \text{commitment}, \text{nullifier}, \text{amount}, P_{\text{oracle}})$.
3. **On-Chain State Transition Verification:** Cairo contracts `PELPerpsCore` and `StwoVerifier` enforce that every position modification must supply a valid, unspent nullifier and a matching cryptographic fact hash bound to current on-chain oracle and market state.

---

## 2. Threat Model & Attack Vectors Defended

| Vector ID | Attack Scenario | Protocol Defense & Invariant Enforced |
| :--- | :--- | :--- |
| **AV-01** | **Nullifier Replay Attack** | `used_nullifiers` mapping in Cairo storage permanently marks nullifier $N_t$ as true on first consumption. Replay attempts revert with `NULLIFIER_ALREADY_SPENT`. |
| **AV-02** | **Stale / Future Oracle Manipulation** | `OracleAdapter` rejects prices older than $180\text{s}$ (`ORACLE_UPDATE_STALE`) and prices with timestamps in the future (`FUTURE_PRICE_TIMESTAMP`). |
| **AV-03** | **Unbacked Payout Theft** | Prover rejects generating close facts where requested payout exceeds proven equity ($E_t = M + \text{PnL} - F - \text{Fee}$). Cairo `release_shielded_payout` registers exact verifiable payout note commitment. |
| **AV-04** | **Premature Liquidation of Solvent Position** | Prover circuit rejects generating liquidation facts if $E_t > M_{\text{maint}}$. Keeper cannot liquidate healthy positions. |
| **AV-05** | **Commitment Side-Flipping (B1 Attack)** | Side (`'LONG'` / `'SHORT'`) is explicitly hashed into the position commitment $C_t$. A user cannot claim to be short when price falls if they opened long. |
| **AV-06** | **Market ID Cross-Market Spoofing (B5 Attack)** | State machine checks that `stored_record.market_id == input.market_id` on every position transition. |
| **AV-07** | **Floating-Point Precision Drift** | 100% of mathematical operations use pure BigInt fixed-point arithmetic with floor rounding. |
| **AV-08** | **Front-Running Liquidation** | Once an autonomous keeper submits a valid liquidation fact, the position's nullifier is spent atomically in the block execution, preventing conflicting user withdrawals. |

---

## 3. Bad Debt Waterfall & Solvency Invariant

In the event of extreme market gap risk where position equity drops below zero ($E_t < 0$):

$$\text{Deficit} = |E_t|$$

### Waterfall Execution:
1. **Position Collateral ($M$):** 100% of the position's locked margin is seized.
2. **Keeper Bounty ($2\%$):** $M \times 2\%$ is credited to the keeper to incentivize liquidation liveness even in turbulent conditions.
3. **Protocol Insurance Fund ($98\%$):** $M \times 98\%$ is credited to the insurance fund to absorb trading losses and backstop winning counterparty payouts.
4. **Protocol Liquidity Reserve Backstop:** If insurance fund is depleted, the protocol's backstop liquidity pool covers residual deficit.
