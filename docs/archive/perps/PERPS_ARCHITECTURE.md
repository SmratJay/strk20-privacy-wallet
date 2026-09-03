# PEL Private Perpetuals — Architecture & State Machine Specification

**Protocol:** Private Execution Layer (PEL) BTC-PERP  
**Version:** 2.1 (V4 Enforcement Layer Rebuild)  
**Standard:** Fact Registry & Real ERC20 Custody State Machine  

---

## 1. System Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Client Side (Private Witness Domain)"]
        UserWallet["User Wallet (Braavos / Argent)"]
        EncStore["Encrypted Witness Store (AES-GCM)"]
        Prover["Fact Computation Service (Poseidon)"]
        RiskEng["Canonical Risk Engine (FixedPoint BigInt)"]
    end

    subgraph ProverNetwork ["Prover & Off-Chain Infrastructure"]
        ProverNode["Authorized Prover Node"]
        Indexer["Position Indexer Service (RPC Event Polling)"]
        Keeper["Autonomous Keeper Bot (Solvency Watchdog)"]
        OraclePublisher["Authenticated Oracle Publisher"]
    end

    subgraph StarknetL2 ["Starknet L2 Contracts"]
        Core["PELPerpsCore.cairo (State Machine)"]
        Adapter["STRK20Adapter.cairo (Real ERC20 Custody)"]
        USDC["TestUSDC.cairo (Collateral Token)"]
        Oracle["OracleAdapter.cairo (Authenticated Feeds)"]
        Verifier["StwoVerifier.cairo (Fact Registry)"]
    end

    UserWallet -->|1. Generate Private Position| Prover
    Prover -->|2. Encrypt & Save Witness| EncStore
    ProverNode -->|3. Register Verified Fact| Verifier
    UserWallet -->|4. Approve USDC| USDC
    UserWallet -->|5. Submit open_position Tx| Core
    Core -->|6. Check Fact in Registry| Verifier
    Core -->|7. Lock Shielded Margin via transfer_from| Adapter
    Adapter -->|Pull ERC20| USDC
    Core -->|8. Check Mark Price Freshness| Oracle
    OraclePublisher -->|Publish BTC/USD Feed| Oracle

    Core -->|Emit PositionOpened| Indexer
    Core -->|Emit PositionFunded| Indexer
    Core -->|Emit PositionClosed| Indexer

    Indexer -->|Query Active Commitments| Keeper
    Keeper -->|Execute liquidate_position| Core
    Core -->|Credit 2% Bounty & Insurance| Adapter
    Adapter -->|Payout Claim / Bounty Claim transfer| USDC
```

---

## 2. Privacy Boundary Matrix

| Data Field | Storage Location | Visibility | Cryptographic Binding |
| :--- | :--- | :--- | :--- |
| **Position Side** (`LONG` / `SHORT`) | Client Witness | **PRIVATE** | Poseidon Hash bound in $C_t$ |
| **Quantity** ($q$ satoshis) | Client Witness | **PRIVATE** | Bound in $C_t$ and fact hash $\Phi$ |
| **Entry Price** ($P_{\text{entry}}$ cents) | Client Witness | **PRIVATE** | Bound in $C_t$ and fact hash $\Phi$ |
| **Owner Secret Key** ($sk$) | Client Encrypted Storage | **PRIVATE** | Proves ownership without leakage |
| **Commitment** ($C_t$) | Starknet Contract (`positions`) | **PUBLIC** | $C_t = \text{Poseidon}(\text{DOMAIN}, \text{side}, q, P_e, M, \text{nonce}, sk)$ |
| **Nullifier** ($N_t$) | Starknet Contract (`used_nullifiers`) | **PUBLIC** | $N_t = \text{Poseidon}(\text{NULLIFIER\_TAG}, sk, C_t)$ |
| **Locked Margin** ($M$) | Starknet Contract (`positions`) | **PUBLIC (Isolated)** | Required for solvency checks & liquidation |
| **Market ID** (`BTC-PERP`) | Starknet Contract (`positions`) | **PUBLIC** | Enforces market isolation |

---

## 3. Formal State Transitions

### State 1: `OPEN`
$$\sigma_0 \xrightarrow{\text{open\_position}(C_0, N_{\text{margin}}, M, \Phi_{\text{open}})} \sigma_1$$
- **Preconditions:**
  1. $N_{\text{margin}} \notin \text{used\_nullifiers}$
  2. $C_0 \notin \text{positions}$
  3. $\text{FactRegistry}[\Phi_{\text{open}}] == \text{true}$
  4. $\text{OraclePrice}.\text{is\_valid} == \text{true}$
- **Effects:**
  1. $\text{used\_nullifiers}[N_{\text{margin}}] \leftarrow \text{true}$
  2. $\text{positions}[C_0] \leftarrow \text{PositionRecord}(C_0, N_{\text{margin}}, M, \text{active})$
  3. Real ERC20 pulled via $\text{IERC20.transfer\_from}(\text{caller}, \text{adapter}, M)$

### State 2: `CLOSE`
$$\sigma_t \xrightarrow{\text{close\_position}(C_t, N_t, C_{\text{payout}}, \text{Payout}, \Phi_{\text{close}})} \sigma_{t+1}$$
- **Preconditions:**
  1. $\text{positions}[C_t].\text{is\_active} == \text{true}$
  2. $N_t \notin \text{used\_nullifiers}$
  3. $\text{FactRegistry}[\Phi_{\text{close}}] == \text{true}$
  4. $\text{Payout} \le \text{positions}[C_t].\text{locked\_margin}$
- **Effects:**
  1. $\text{positions}[C_t].\text{is\_active} \leftarrow \text{false}$
  2. $\text{used\_nullifiers}[N_t] \leftarrow \text{true}$
  3. $\text{registered\_notes}[C_{\text{payout}}] \leftarrow \text{Payout}$
  4. Remaining margin $(M - \text{Payout}) \to \text{insurance\_fund}$
  5. User can call $\text{claim\_payout}(C_{\text{payout}}, \text{recipient})$ to receive real ERC20 tokens
