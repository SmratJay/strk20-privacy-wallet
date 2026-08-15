# 🔒 STRK20 Privacy Wallet (Umbra Mode)

> **Umbra-grade UX on a stronger foundation — fully powered by the native STRK20 Privacy Pool on Starknet.**

Built by **Jai Bhati** ([@SmratJay](https://github.com/SmratJay)) — founder of [orrange.xyz](https://orrange.xyz), web3 degen & ZK enthusiast.

[![Tests](https://img.shields.io/badge/tests-10%2F10%20passing-emerald)](https://github.com/SmratJay/strk20-privacy-wallet)
[![Starknet](https://img.shields.io/badge/starknet-v10.4.0-blue)](https://starknetjs.com)
[![AVNU](https://img.shields.io/badge/AVNU%20SDK-v4.2.0-purple)](https://docs.avnu.fi)
[![License](https://img.shields.io/badge/license-MIT-zinc)](./LICENSE)

---

## 🎯 What is this?

**STRK20 Privacy Wallet** delivers the iconic **Umbra stealth UX** (*publish once, receive privately, spend freely*) directly on Starknet by leveraging the native, live-on-mainnet **STRK20 Note-Based (UTXO) Privacy Pool**.

Zero new contracts to audit. Zero protocol changes. The production-grade zero-knowledge cryptography and Stwo prover engine already live on Starknet mainnet — this wallet provides the seamless consumer and DeFi interface.

### ⚔️ STRK20 vs Umbra Comparison

| Dimension | Umbra (Ethereum L1) | STRK20 Privacy Wallet (Starknet) |
|---|---|---|
| **Key Architecture** | 2-key stealth meta-address (spending + viewing) | **1 Registered Viewing Key** (on-chain registration) |
| **Payment Destination** | Per-payment stealth addresses (visible on-chain) | **Encrypted UTXO pool notes** (no public address) |
| **Scanning Mechanism** | Public announcement events on-chain | **Directional subchannel scanning** in WriteOnce storage |
| **Withdrawal / Spend** | External relayer network required for gas decoupling | **Pool-mediated withdrawals & sponsored paymasters** |
| **Anonymity Set** | Isolated to users of the stealth contract | **Unified pool** across transfers, shielding, and DeFi |
| **Selective Disclosure** | Manual viewing key export | **ECDH threshold auditor key escrow** (`SetViewingKey`) |

---

## ✨ Features & Core Flow

```
                               ┌─────────────────────────────────────────┐
                               │       STRK20 PRIVACY WALLET (Next.js)   │
                               └────────────────────┬────────────────────┘
                                                    │
             ┌──────────────────────┬───────────────┴───────────────┬──────────────────────┐
             │                      │                               │                      │
             ▼                      ▼                               ▼                      ▼
     [ Core UI & Tabs ]     [ Stealth Engine ]             [ DeFi Router ]       [ Crypto & Audit ]
     • Dual Balance Viewer  • Umbra 1-Key Sharing          • AVNU Live DEX       • Poseidon Note IDs
     • 2-Step Shielding     • Stealth Invoicing (QR)       • Multi-Call Route    • Nullifier Tree
     • Encrypted UTXO Send  • Address Book Contacts          Execution           • Homomorphic Masking
     • Unshield Withdrawal  • Directional Scanner          • Real Slippage Calc  • Selective Auditor
     • Decrypted History    • Sequential WriteOnce                                 Escrow Proof
```

1. **Dual Balance Viewer** — Real-time comparative dashboard displaying public ERC-20 balances alongside encrypted pool UTXO notes for `STRK`, `ETH`, `USDC`, and `USDT`.
2. **2-Step Shielding (Public → Private)** — Standardized ERC-20 approval followed by pool deposit invocation with protocol-level FPI deposit screening.
3. **Encrypted UTXO Private Transfer** — Off-chain sender, recipient, and amount encryption inside the STRK20 pool with zero on-chain breadcrumbs.
4. **Stealth Payment Invoices & Dynamic QR Vectors** — Umbra-style payment request generator with real-time vector QR codes (`qrcode.react`) and shareable stealth links (`https://orrange.xyz/pay/strk20:...`).
5. **Real-Time AVNU DEX Swaps** — Live DEX aggregation routing across Ekubo and JediSwap with atomic multi-call trade execution.
6. **UTXO Subchannel & Note Inspector** — Live RPC block scanner and sequential WriteOnce subchannel note discovery engine.
7. **Selective Disclosure & Compliance Modal** — Demonstrates STRK20's threshold auditor viewing key escrow mechanism without mass surveillance.
8. **Contact Address Book** — Local client-side address book for managing saved privacy contacts and stealth viewing keys.

---

## 🔐 Cryptography & Invariants

All cryptographic primitives are implemented in [`src/services/strk20Crypto.ts`](./src/services/strk20Crypto.ts) and strictly match the STRK20 protocol specification:

- **Domain Separation Tags:**
  - Note ID: `0x4e4f54455f49445f5441473a5631` (`NOTE_ID_TAG:V1`)
  - Nullifier: `0x4e554c4c49464945525f5441473a5631` (`NULLIFIER_TAG:V1`)
  - Channel Key: `0x4348414e4e454c5f4b45595f5441473a5631` (`CHANNEL_KEY_TAG:V1`)
  - Amount Mask: `0x454e435f414d4f554e545f5441473a5631` (`ENC_AMOUNT_TAG:V1`)
  - Auditor Escrow: `0x41554449544f525f455343524f575f5441473a5631` (`AUDITOR_ESCROW_TAG:V1`)
- **Note ID Formula:**
  $$\text{NoteID} = \text{poseidon}(\text{NOTE\_ID\_TAG}, \text{channel\_key}, \text{token}, \text{index}, 0)$$
- **Nullifier Formula:**
  $$\text{Nullifier} = \text{poseidon}(\text{NULLIFIER\_TAG}, \text{channel\_key}, \text{token}, \text{index}, 0, \text{owner\_private\_key})$$
- **STARK Curve ECDH Channel Key:**
  $$\text{ChannelKey} = \text{poseidon}(\text{CHANNEL\_KEY\_TAG}, \text{ECDH}(d_{\text{sender}}, Q_{\text{recipient}})_x, \text{sender}, \text{recipient})$$
- **Homomorphic Symmetric Amount Masking:**
  $$\text{MaskedAmount} = (\text{poseidon}(\text{ENC\_AMOUNT\_TAG}, \text{channel\_key}, \text{token}, \text{index}, 0, \text{salt}) + \text{amount}) \pmod{2^{128}}$$

---

## 🛠️ Tech Stack & Pinned Dependencies

| Package | Version | Purpose |
|---|---|---|
| `next` | `^15.1.7` | React 19 App Router Frontend |
| `starknet` | `^10.4.0` | Starknet.js v10 with WalletAccountV6 & Poseidon cryptography |
| `@avnu/avnu-sdk` | `^4.2.0` | Live DEX Aggregator quotes & multi-call routing |
| `@starknet-io/get-starknet-discovery` | `6.0.3` | Standard Starknet wallet discovery |
| `@starknet-io/types-js` | `0.10.3` | Wallet API type definitions |
| `qrcode.react` | `^4.2.0` | Dynamic SVG vector QR code rendering |
| `vitest` | `^4.1.10` | Automated cryptographic unit test runner |
| `tailwindcss` | `^3.4.17` | Responsive dark-theme styling |

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 20.0.0
- npm ≥ 10.0.0
- Starknet browser wallet (Ready Wallet, Argent X, or Braavos)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/SmratJay/strk20-privacy-wallet.git
cd strk20-privacy-wallet

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Add your Alchemy Starknet Mainnet API key to .env.local

# 4. Run automated test suite
npm test

# 5. Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

---

## 🧪 Testing

The repository includes a comprehensive unit test suite covering domain tags, Poseidon Note ID determinism, nullifier uniqueness, STARK ECDH shared secrets, auditor escrow commitments, modular amount masking boundaries ($0$, normal amounts, and $2^{128}-1$), and u256 serialization formats.

```bash
# Run Vitest test suite
npm test

# Type-check TypeScript code
npm run typecheck

# Verify Next.js production build
npm run build
```

---

## 📄 Protocol Reference & On-Chain Addresses

- **STRK20 Mainnet Privacy Pool:**  
  [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- **Official Documentation:** [strk20-by-example.org](https://strk20-by-example.org/)
- **Protocol Whitepaper:** [Cryptology ePrint 2026/474](https://eprint.iacr.org/2026/474)
- **Privacy SDK Monorepo:** [starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy)

---

## 👨‍💻 Builder

**Jai Bhati** — Founder of [orrange.xyz](https://orrange.xyz)  
- **GitHub:** [@SmratJay](https://github.com/SmratJay)  
- **Telegram:** [@popexenon](https://t.me/popexenon)

---

## 📜 License

MIT License — see [LICENSE](./LICENSE) for details.
