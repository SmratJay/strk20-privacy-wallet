# 🍊 ORRANGE: Confidential DeFi & Privacy-Native Perpetuals on Starknet

> **The complete privacy execution stack on Starknet — combining Umbra-grade Stealth Payments (STRK20) with Zero-Knowledge Shielded Perpetual Futures (PEL BTC-PERP).**

Built by **Jai Bhati** ([@SmratJay](https://github.com/SmratJay)) — Founder of [orrange.xyz](https://orrange.xyz).

[![Cairo Scarb](https://img.shields.io/badge/Cairo%20Scarb-v2.16.0%20PASS-emerald)](https://github.com/SmratJay/strk20-privacy-wallet)
[![Tests](https://img.shields.io/badge/tests-175%2F175%20passing-emerald)](https://github.com/SmratJay/strk20-privacy-wallet)
[![Starknet](https://img.shields.io/badge/starknet-v10.4.0-blue)](https://starknetjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-v15.5.23-black)](https://nextjs.org)
[![AVNU](https://img.shields.io/badge/AVNU%20SDK-v4.2.0-purple)](https://docs.avnu.fi)
[![License](https://img.shields.io/badge/license-MIT-zinc)](./LICENSE)

---

## 🎯 What is ORRANGE?

**ORRANGE** is a privacy-first decentralized financial platform built on Starknet. It bridges consumer-grade stealth payment UX with institutional-grade zero-knowledge derivatives trading.

### 🌟 Core Capabilities:
1. **🔒 STRK20 Privacy Wallet (Umbra Mode):** Shield, send, unshield, and transfer tokens privately using Starknet's native note-based privacy pool with single-key stealth invoices.
2. **⚡ PEL Private Perpetuals (`BTC-PERP`):** Shielded perpetual futures with $1\times$ to $50\times$ leverage. Position size, entry price, leverage, and liquidation points are hidden off-chain in encrypted Poseidon witnesses; only SNIP-36 STARK transition facts are verified on-chain.
3. **💧 Pooled LP Counterparty Vault (`STRK20Adapter`):** GMX-style pooled liquidity with proportional NAV share pricing, fee attribution, and automated withdrawable reserve floor protection.
4. **🤖 Autonomous Keeper & Indexer Subsystem:** Proof-based solvency evaluations ($\text{equity} \le \text{maintenanceMargin}$), fail-closed oracle freshness guards, and real-time Starknet RPC event polling with reorg recovery.
5. **🔄 AVNU DEX Aggregator:** Live best-execution swaps across Ekubo and JediSwap with paymaster gasless routing.

---

## 🏛️ Platform Architecture

```
                                    ┌──────────────────────────────────────────────────┐
                                    │               ORRANGE PLATFORM                   │
                                    └─────────────────────────┬────────────────────────┘
                                                              │
                    ┌─────────────────────────────────────────┴─────────────────────────────────────────┐
                    │                                                                                   │
                    ▼                                                                                   ▼
    ┌───────────────────────────────┐                                                   ┌───────────────────────────────┐
    │     STRK20 PRIVACY WALLET     │                                                   │      PEL SHIELDED PERPS       │
    ├───────────────────────────────┤                                                   ├───────────────────────────────┤
    │ • Umbra Stealth Invoices      │                                                   │ • BTC-PERP (1x - 50x)         │
    │ • Encrypted UTXO Notes        │                                                   │ • Shielded Poseidon Witnesses │
    │ • Subchannel Scanner          │                                                   │ • STARK SNIP-36 Fact Registry │
    │ • Selective Auditor Escrow    │                                                   │ • Pooled LP Counterparty NAV  │
    │ • AVNU Live DEX Swaps         │                                                   │ • Zero-Fallback Keeper Bot    │
    └───────────────┬───────────────┘                                                   └───────────────┬───────────────┘
                    │                                                                                   │
                    └─────────────────────────────────┬─────────────────────────────────────────────────┘
                                                      │
                                                      ▼
                       ┌─────────────────────────────────────────────────────────────┐
                       │                 STARKNET CAIRO SMART CONTRACTS              │
                       │  - PELPerpsCore (State Machine & Nullifier Lineage)         │
                       │  - StwoVerifier (Prover-Only Domain-Separated Fact Verifier)│
                       │  - STRK20Adapter (ERC20 Custody, Payout Notes, LP Pool)     │
                       │  - OracleAdapter (Canonical Mark Price & Circuit Breaker)   │
                       │  - TestUSDC (6-decimal Collateral Token)                    │
                       └─────────────────────────────────────────────────────────────┘
```

---

## ⚡ PEL Private Perpetuals (`BTC-PERP`)

Unlike standard public perpetual DEXs (dYdX, GMX) where trading positions, stop losses, and liquidation prices are visible to all observers, **PEL encrypts all trade parameters off-chain**:

```
[Trader Shielded Note] ──► [Encrypted Witness Store] ──► [Poseidon Commitment C] ──► [StwoVerifier]
                                  (q, P_entry, Margin, Secret)                              │
                                                                                            ▼
[STRK20 Payout Note] ◄── [Claim Note] ◄── [Core.close_position] ◄── [SNIP-36 CLOSE Fact] ◄──┘
```

### Trading Specs:
- **Active Market:** `BTC-PERP` (TestUSDC collateral, 6 decimals, $1\text{ cent} = 10,000\text{ token units}$)
- **Max Leverage:** $50\times$
- **Maintenance Margin:** $2.00\%$ ($200\text{ bps}$)
- **Taker Fee:** $0.05\%$ ($5\text{ bps}$)
- **Oracle Freshness:** Max price age $180\text{s}$ with $20\%$ price deviation circuit breaker

---

## 🧪 Comprehensive Verification & Release Evidence

ORRANGE enforces a strict quality gate where all Cairo contracts, unit tests, integration tests, adversarial attack vectors, and Next.js builds must pass before release.

```bash
./scripts/local_quality_gate.sh
```

### Verification Matrix:
- **Cairo Scarb Build:** Passes with **0 errors and 0 warnings**.
- **Automated Vitest Suite:** **175 / 175 tests passing** across 16 test files (100% pass rate).
  - `tests/integration/realCairoContractIntegration.test.ts` (10 tests: compiled Sierra ABIs, Flow 1 golden path, Flow 2 liquidation, and 6 runtime adversarial attacks).
  - `tests/adversarial/attackVectors.test.ts` (52 tests: nullifier forgery, fact mutation, payout inflation, stale oracle rejection, double bounty rejection).
  - `tests/invariants/assetConservation.test.ts` (23 tests: zero-sum balance conservation, fee tracking, 150-iteration fuzzing simulation).
  - `tests/indexerAndKeeper.test.ts` (7 tests: reorg rollbacks, process restart persistence, indexer lag).
- **Next.js Production Build:** Compiles **6/6 static & dynamic routes with 0 errors**.
- **Codebase Hygiene:** 0 hardcoded test keys or fallback addresses.

---

## 📄 On-Chain Smart Contract Deployments (Sepolia Testnet)

| Contract | Address | Purpose |
| :--- | :--- | :--- |
| **`PELPerpsCore`** | [`0x07dc4ec...e62b09a`](https://sepolia.voyager.online/contract/0x07dc4ecd80209424c5387ad6e2d1487f5979ad2cf584a275463695cebe62b09a) | Core perp state machine & commitment graph |
| **`StwoVerifier`** | [`0x0757f5c...ae350d7`](https://sepolia.voyager.online/contract/0x0757f5c9e2b17a02241cfb1c1d0cfae60f7e1b78fcad85e33dff603a1ae350d7) | Typed SNIP-36 transition fact registry |
| **`STRK20Adapter`** | [`0x00fba68...8adceca`](https://sepolia.voyager.online/contract/0x00fba68c5b9f71c42247b9736c478a531e21b72e519c72a818c3924f38adceca) | Collateral custody, LP pool NAV, and payout notes |
| **`OracleAdapter`** | [`0x0283c7c...cf2bc08`](https://sepolia.voyager.online/contract/0x0283c7cbcc9e8dc9da04c86fe34807481baef80bf485e94bbfb1d83cecf2bc08) | Canonical on-chain mark price feed |
| **`TestUSDC`** | [`0x053c912...ecf368a8`](https://sepolia.voyager.online/contract/0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8) | 6-decimal standard ERC20 collateral token |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** $\ge 20.0.0$
- **Scarb** $\ge 2.16.0$ (for Cairo contract compilation)
- **Starknet Browser Wallet** (Argent X, Braavos, or Cartridge Controller)

### Quick Start:

```bash
# 1. Clone the repository
git clone https://github.com/SmratJay/strk20-privacy-wallet.git
cd strk20-privacy-wallet

# 2. Install dependencies
npm install

# 3. Compile Cairo smart contracts
cd contracts && scarb build && cd ..

# 4. Run local quality gate (Scarb + Vitest + Next.js build)
./scripts/local_quality_gate.sh

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 👨‍💻 Builder

**Jai Bhati** — Founder of [orrange.xyz](https://orrange.xyz)  
- **GitHub:** [@SmratJay](https://github.com/SmratJay)  
- **Telegram:** [@popexenon](https://t.me/popexenon)

---

## 📜 License

MIT License — see [LICENSE](./LICENSE) for details.
