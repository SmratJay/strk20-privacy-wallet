# 🛡️ STRK20 Privacy Wallet: Deep Dive, UMBRA Mechanism & Architecture

> **A comprehensive technical manual explaining the Umbra Stealth protocol, why STRK20 is structurally superior, how our codebase works, and how the installed Agent Skill operates.**

---

## 1. The Mechanism of UMBRA (Ethereum Stealth Addresses)

### How Umbra Works on Ethereum

[Umbra](https://app.umbra.cash) is a stealth address protocol designed to solve a fundamental public blockchain problem: **If Alice wants to pay Bob, Bob normally has to give Alice his public Ethereum address, linking Bob’s identity to that transaction forever.**

Umbra enables **"Publish once, receive privately"** using non-interactive Diffie-Hellman key exchange (ECDH) on secp256k1:

```
BOB (Recipient)                                      ALICE (Sender)
   │                                                       │
   ├── Publishes Stealth Meta-Address:                     │
   │   (SpendingPubKey K_spend, ViewingPubKey K_view)      │
   │   (2 public keys published on ENS or Umbra Registry)  │
   │                                                       │
   │                                          Generates ephemeral keypair:
   │                                          r (private), R = r * G (public)
   │                                                       │
   │                                          Computes shared secret:
   │                                          S = r * K_view
   │                                                       │
   │                                          Computes Stealth Address P:
   │                                          P = K_spend + H(S) * G
   │                                                       │
   │                                          Sends ERC-20 / ETH to P
   │                                          Emits on-chain Announcement event:
   │                                          Announcement(receiver=P, amount, R, ciphertext)
   │                                                       │
   ▼                                                       ▼
Scanning: Bob scans all Announcement events          On-Chain: Address P is created
Uses his viewing private key k_view to test S       Funds sit at P.
When match found, Bob derives spending key:         Bob must withdraw from P via a Relayer
p = k_spend + H(S)                                  to keep gas funding anonymous.
```

### The Inherent Flaws & Limitations of Umbra on EVM:
1. **Requires 2 Public Keys**: Recipient needs a spending key AND a viewing key (stealth meta-address).
2. **Stealth Address is Public**: On-chain, a new public Ethereum address `P` is created for every payment. Observers can see money moved to `P`.
3. **Public Announcement Event Trail**: Alice must emit an on-chain event containing the ephemeral public key `R`, creating a traceable scan footprint.
4. **Relayer Dependency**: Because the newly generated stealth address `P` has 0 ETH for gas, Bob cannot move funds out of `P` without either funding `P` with gas (ruining privacy) or relying on a 3rd-party relayer network to pay gas.
5. **Small Anonymity Set**: Your privacy set is only other people using Umbra stealth addresses.

---

## 2. Why STRK20 Beats Umbra Structurally

STRK20 is a **note-based (UTXO) privacy pool** native to Starknet, verified by zero-knowledge STARK proofs (Stwo prover) directly in-protocol:

| Feature | Umbra (Ethereum) | STRK20 Privacy Wallet (Starknet) | Advantage |
|---|---|---|---|
| **Identity Registration** | 2 Keys (`K_spend` + `K_view`) published to registry | **1 Key** (`SetViewingKey` on Starknet STARK curve) | Simpler onboarding, smaller attack surface |
| **On-Chain Footprint** | New public stealth address `P` visible on explorer | **Zero visible addresses** — encrypted UTXO note stored in pool | Observer sees no address, no recipient, no amount |
| **Transaction Visibility** | Recipient hidden, but token & amount are public | **Sender, Recipient, Token, & Amount are ALL encrypted** | 100% confidential transaction payload |
| **Scanning & Discovery** | Scans every on-chain `Announcement` event on Ethereum | **Off-Chain Channel Scanning** against your viewing key | Scales with your own transactions, not global pool volume |
| **Withdrawal Gas** | Needs centralized relayer to sponsor gas from address `P` | **Pool is the caller / Paymaster relayed** | Native gas abstraction; no separate relayer network |
| **Anonymity Set** | Isolated stealth transfers only | **Shared with ALL pool volume** (transfers, DeFi, swaps) | Massive, unified anonymity set |

---

## 3. What We Have Built in This Codebase

We built a complete **Next.js 15 + TypeScript + Tailwind CSS** consumer privacy wallet (`strk20-privacy-wallet`):

```
┌────────────────────────────────────────────────────────────────────────┐
│                      STRK20 PRIVACY WALLET UI                          │
│                                                                        │
│  [Publish Address]       [Wallet: Ready / Argent]      [Network: Main] │
├──────────────────────────────────┬─────────────────────────────────────┤
│      SHIELDED POOL BALANCE       │        PUBLIC ON-CHAIN BALANCE      │
│  🔒 STRK: 120.00 (Encrypted UTXO)│  🌐 STRK: 45.50 (ERC-20)            │
│  🔒 ETH:    1.25 (Encrypted UTXO)│  🌐 ETH:   0.10 (ERC-20)            │
│  🔒 USDC: 500.00 (Encrypted UTXO)│  🌐 USDC: 50.00 (ERC-20)            │
├──────────────────────────────────┴─────────────────────────────────────┤
│  [🛡️ Shield]    [🔒 Send Privately]    [⬇️ Unshield]    [✨ Swap]      │
└────────────────────────────────────────────────────────────────────────┘
```

### Module Audit & Responsibilities:

1. **[`src/hooks/useStarknetWallet.ts`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/hooks/useStarknetWallet.ts)**:
   - Discovers installed Starknet standard wallets (`Ready`, `Argent X`, `Braavos`).
   - Non-intrusively detects STRK20 Privacy capability (`supportedSpecs >= 0.10.3`) without triggering unsolicited balance access prompts.

2. **[`src/components/PublishAddressModal.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/PublishAddressModal.tsx)**:
   - Umbra-style "Publish Once" card providing your `strk20:<address>` privacy address.
   - Senders use this to encrypt incoming notes directly to your viewing key.

3. **[`src/components/BalanceCards.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/BalanceCards.tsx)**:
   - Dual balance display: compares public ERC-20 tokens vs. shielded encrypted pool notes for `STRK`, `ETH`, `USDC`, and `USDT`.

4. **[`src/components/tabs/ShieldTab.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/tabs/ShieldTab.tsx)**:
   - Transparent 2-step deposit flow: Step 1 (ERC-20 `approve`) &rarr; Step 2 (Deposit into Pool).
   - Shows **FPI on-chain deposit screening** status and note maturity (~10 blocks).

5. **[`src/components/tabs/SendTab.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/tabs/SendTab.tsx)**:
   - Private UTXO note transfer: Spends input notes, generates output notes for recipient and change note for sender.
   - Real-time **Stwo Zero-Knowledge Proof** progress indicator (~25-30s).
   - Paymaster sponsored gas badge.

6. **[`src/components/tabs/UnshieldTab.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/tabs/UnshieldTab.tsx)**:
   - Withdraws private notes back to any public Starknet address with transparent disclosure of what becomes public.

7. **[`src/components/tabs/SwapTab.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/tabs/SwapTab.tsx)**:
   - Private token swaps powered by `@avnu/avnu-sdk`. Output tokens land directly in fresh encrypted notes.

8. **[`src/components/tabs/HistoryTab.tsx`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/src/components/tabs/HistoryTab.tsx)**:
   - Local decrypted activity log with links to Voyager block explorer.

---

## 4. How the Installed Agent Skill is Used

When we ran `npx skills add starkience/strk20-agent-skills`, it installed the skill files into `.agents/skills/strk20-privacy-integration/`.

### How Agent Skills Work During Development:
1. **Rule Enforcement & Guardrails**:
   - The skill provides non-negotiable rules: never write Cairo contracts without audit, never hardcode viewing keys or secrets, and keep secrets in `.env.local`.
2. **Freshness & Version Drift Audits**:
   - Includes `scripts/check_freshness.py` to verify npm dependencies (`starknet@10.4.0`, `@starknet-io/get-starknet-discovery@6.0.3`, `@starknet-io/types-js@0.10.3`) against live Starknet mainnet specifications.
3. **Integration Plan Living Document**:
   - Maintains and updates [`STRK20_INTEGRATION_PLAN.md`](file:///Users/jaybhati/Desktop/Mercury/strk20-privacy-wallet/STRK20_INTEGRATION_PLAN.md) at the repository root as the single source of truth across development phases.

---

## 5. Audit Results: Current System State

| Component | Status | Verification Note |
|---|---|---|
| **Compilation / Build** | 🟢 PASS | `next build` static export succeeded (4/4 pages) in 689ms |
| **TypeScript Types** | 🟢 PASS | `tsc --noEmit` exited `0` with 0 type errors |
| **Git Attribution** | 🟢 PASS | Author set to `SmratJay <74355410+SmratJay@users.noreply.github.com>` |
| **Hackathon PR** | 🟢 LIVE | PR [#35](https://github.com/starkience/strk20-hackathon/pull/35) updated with `"team": ["SmratJay"]` |
| **Security / Secrets** | 🟢 SAFE | `.env.local` is strictly gitignored; zero private keys in repository |
