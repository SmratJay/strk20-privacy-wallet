# 🔒 STRK20 Privacy Wallet (Umbra Mode)

> **Umbra-grade privacy UX on Starknet — fully powered by the native STRK20 Note-Based Privacy Pool.**

Built by **Jai Bhati** ([@SmratJay](https://github.com/SmratJay)) — Founder of [orrange.xyz](https://orrange.xyz), web3 degen & ZK enthusiast.

[![Tests](https://img.shields.io/badge/tests-10%2F10%20passing-emerald)](https://github.com/SmratJay/strk20-privacy-wallet)
[![Starknet](https://img.shields.io/badge/starknet-v10.4.0-blue)](https://starknetjs.com)
[![AVNU](https://img.shields.io/badge/AVNU%20SDK-v4.2.0-purple)](https://docs.avnu.fi)
[![License](https://img.shields.io/badge/license-MIT-zinc)](./LICENSE)

---

## 🎯 What is this?

**STRK20 Privacy Wallet** delivers the iconic **Umbra stealth UX** (*"publish once, receive privately, spend freely"*) directly on Starknet by leveraging the native, live-on-mainnet **STRK20 Note-Based (UTXO) Privacy Pool**.

Zero new contracts to audit. Zero protocol changes. The production-grade zero-knowledge cryptography and Stwo prover engine already live on Starknet — this wallet provides the universal consumer and DeFi interface for **Braavos, Argent X, Ready Wallet, and Cartridge**.

### ⚔️ STRK20 vs Umbra Comparison

| Dimension | Umbra (Ethereum L1) | STRK20 Privacy Wallet (Starknet) |
|---|---|---|
| **Key Architecture** | 2-key stealth meta-address (spending + viewing) | **1 Registered Viewing Key** (off-chain signature derivation) |
| **Payment Destination** | Per-payment stealth addresses (visible on-chain) | **Encrypted UTXO pool notes** (zero public recipient trail) |
| **Wallet Compatibility** | Limited to standard EVM injected wallets | **Universal Starknet Support** (Braavos, Argent X, Ready Wallet) |
| **Scanning Mechanism** | Public announcement events on-chain | **Directional subchannel scanning** in WriteOnce storage |
| **Withdrawal / Spend** | External relayer network required for gas decoupling | **Pool-mediated withdrawals & sponsored paymaster relays** |
| **Anonymity Set** | Isolated to users of the stealth contract | **Unified pool** across transfers, shielding, and DeFi |
| **Selective Disclosure** | Manual viewing key export | **ECDH threshold auditor key escrow** (`SetViewingKey`) |

---

## ✨ Features & Architecture

```
                                ┌─────────────────────────────────────────┐
                                │       STRK20 PRIVACY WALLET (Next.js)   │
                                └────────────────────┬────────────────────┘
                                                     │
             ┌──────────────────────┬────────────────┼────────────────┬──────────────────────┐
             │                      │                │                │                      │
             ▼                      ▼                ▼                ▼                      ▼
     [ Core UI & Tabs ]     [ Stealth Engine ]  [ UTXO Vault ]   [ DeFi Router ]       [ Crypto & Audit ]
     • Dual Balance Viewer  • Umbra 1-Key Share • Local Notes    • AVNU Live DEX       • Poseidon Note IDs
     • On-Chain Shielding   • Stealth QR Invoices• Spend Tracking• Multi-Call Route    • Nullifier Tree
     • Encrypted UTXO Send  • Deep-Link Payment • Nullifier Sync • Real Slippage Calc  • Homomorphic Masking
     • Unshield Withdrawal  • Address Book      • Block Scanner  • Paymaster Relaying  • Selective Auditor
     • Decrypted History    • Directional Keys                                           Escrow Proof
```

1. **Universal Wallet Support (Umbra Client Mode)** — Native in-browser encrypted UTXO vault engine (`vaultService.ts`) enables full shielding, private spending, and note tracking across **Braavos, Argent X, and Ready Wallet** without requiring proprietary wallet extensions.
2. **Dual Balance Dashboard** — Real-time comparative balance dashboard displaying transparent ERC-20 balances alongside encrypted pool UTXO notes for `STRK`, `ETH`, `USDC`, and `USDT`.
3. **Dynamic Network Toggle (Mainnet ↔ Sepolia)** — Sticky global network context (`NetworkContext.tsx`) with verified token contracts, faucet links, and dedicated privacy pool addresses on both networks.
4. **Stealth Payment Invoices & Deep-Links** — Umbra-style payment request generator with real-time vector QR codes (`qrcode.react`) and self-referential deep-links (`/?tab=SEND&to=...&amount=...&token=...&memo=...`) that automatically load the Send tab with pre-filled invoices.
5. **Real-Time AVNU DEX Swaps** — Live DEX aggregation routing across Ekubo and JediSwap with atomic multi-call trade execution and zero-gas paymaster support.
6. **UTXO Subchannel & Note Inspector** — Live RPC block scanner and sequential WriteOnce subchannel note discovery engine with Poseidon Note ID and Nullifier derivation.
7. **Selective Disclosure & Auditor Modal** — Demonstrates STRK20's threshold auditor viewing key escrow mechanism for tax and regulatory compliance without mass surveillance.
8. **Contact Address Book** — Client-side encrypted address book for managing saved privacy contacts and stealth viewing keys.

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

## 🛠️ Tech Stack & Dependencies

| Package | Version | Purpose |
|---|---|---|
| `next` | `^15.1.7` | React 19 App Router Frontend |
| `starknet` | `^10.4.0` | Starknet.js v10 with WalletAccountV6 & Poseidon cryptography |
| `@avnu/avnu-sdk` | `^4.2.0` | Live DEX Aggregator quotes & multi-call routing |
| `@starknet-io/get-starknet-discovery` | `6.0.3` | Universal Starknet wallet discovery |
| `@starknet-io/types-js` | `0.10.3` | Wallet API type definitions |
| `qrcode.react` | `^4.2.0` | Dynamic SVG vector QR code rendering |
| `lucide-react` | `^1.16.0` | Clean, modern iconography |
| `vitest` | `^4.1.10` | Automated cryptographic unit test runner |
| `tailwindcss` | `^3.4.17` | Responsive dark-theme styling |

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 20.0.0
- npm ≥ 10.0.0
- Starknet browser wallet (Braavos, Argent X, or Ready Wallet)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/SmratJay/strk20-privacy-wallet.git
cd strk20-privacy-wallet

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Add your Alchemy / Cartridge Starknet RPC keys if needed

# 4. Run automated cryptographic test suite
npm test

# 5. Start local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

---

## 🧪 Testing & Verification

The repository includes a comprehensive unit test suite covering domain tags, Poseidon Note ID determinism, nullifier uniqueness, STARK ECDH shared secrets, auditor escrow commitments, modular amount masking boundaries ($0$, normal amounts, and $2^{128}-1$), and u256 serialization formats.

```bash
# Run Vitest test suite (10/10 Passing)
npm test

# Validate TypeScript types
npm run typecheck

# Verify Next.js production bundle
npm run build
```

---

## 📄 Protocol Reference & On-Chain Addresses

- **STRK20 Mainnet Privacy Pool:**  
  [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- **STRK20 Sepolia Testnet Privacy Pool:**  
  [`0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`](https://sepolia.voyager.online/contract/0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91)
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
