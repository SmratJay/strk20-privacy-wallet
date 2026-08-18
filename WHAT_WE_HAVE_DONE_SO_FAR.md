# 📜 WHAT_WE_HAVE_DONE_SO_FAR.md — Living Change Log & Audit History

> **Chronological Record of All Changes, Architectural Decisions, and Features for the STRK20 Privacy Wallet.**  
> *Rules: This is the single, persistent record for all project modifications. Entries are appended chronologically at the bottom of this file. Every entry explicitly states the day, date, time (local timezone), and whether the change is a **[BIG CHANGE]** or a **[SMALL CHANGE]**.*

---

## 📅 Saturday, August 15, 2026 — 13:47:29 IST

### 🚀 Initial Project Genesis, Registration & Infrastructure Setup

#### 🔴 [BIG CHANGE] — Project Initialization & Hackathon Registration
* **Description:** Forked the official hackathon repository (`starkience/strk20-hackathon`), registered the project entry in `registry.json`, created the local git workspace, and submitted the initial Pull Request [#35](https://github.com/starkience/strk20-hackathon/pull/35).
* **Detailed Technical Explanation:**
  * Created `strk20.json` at the root of `strk20-privacy-wallet` with standard tracker schema (`transactions`, `contracts`, `demo_video`, `demo_url`).
  * Structured `.env.example` defining `ALCHEMY_STARKNET_KEY`, `NEXT_PUBLIC_STARKNET_RPC`, `NEXT_PUBLIC_STRK20_POOL`, and `NEXT_PUBLIC_CHAIN_ID=SN_MAIN`.
  * Provisioned local `.env.local` configured with the Alchemy Starknet Mainnet RPC key (`0VWGVHSuDBh88uowT1r49`) and STRK20 Pool address `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
  * Configured `.gitignore` to strictly isolate all `.env` and `.env.local` secret files.

#### 🟢 [SMALL CHANGE] — Installed STRK20 Official Agent Skill
* **Description:** Executed `npx skills add starkience/strk20-agent-skills` to install the Starknet privacy integration skill suite in `.agents/skills/strk20-privacy-integration/`.
* **Details:** Created lockfile `skills-lock.json` and ran freshness script `python3 scripts/check_freshness.py --quick`.

#### 🔴 [BIG CHANGE] — Authored Phased Integration Plan (`STRK20_INTEGRATION_PLAN.md`)
* **Description:** Drafted the initial 7-phase STRK20 integration roadmap in [`STRK20_INTEGRATION_PLAN.md`](./STRK20_INTEGRATION_PLAN.md).
* **Detailed Technical Explanation:**
  * Defined the cryptographic architecture for one-key viewing key registration (`k`, `K = k·G` on STARK curve).
  * Outlined off-chain note discovery over directional channels (`poseidon(CHANNEL_KEY_TAG, ...)`).
  * Planned the 2-step shielding transaction lifecycle (ERC-20 `approve` &rarr; pool `deposit`) and FPI deposit screening protocol.
  * Mapped private UTXO transfers, unshielding withdrawals, paymaster gas relay, and mobile considerations.

---

## 📅 Saturday, August 15, 2026 — 15:09:54 IST

### ⚡ Next.js 15 Privacy Wallet Core Application Build

#### 🔴 [BIG CHANGE] — Next.js 15 + TypeScript + Tailwind Application Construction
* **Description:** Built and wired the complete frontend client application from scratch with pinned Starknet dependencies.
* **Detailed Technical Explanation:**
  * Configured `package.json` with pinned versions: `starknet@^10.4.0` (with `WalletAccountV6` STRK20 action methods), `@starknet-io/get-starknet-discovery@6.0.3`, `@starknet-io/get-starknet-wallet-standard@6.0.3`, `@starknet-io/types-js@0.10.3`, and `@avnu/avnu-sdk@^4.2.0`.
  * Created `src/config/tokens.ts` defining metadata and addresses for `STRK`, `ETH`, `USDC`, and `USDT` on Starknet Mainnet (`SN_MAIN`).
  * Created `src/utils/formatters.ts` with BigInt unit parsers, address shorteners, and felt comparison utilities (`areFeltAddressesEqual`).
  * Implemented `src/hooks/useStarknetWallet.ts` for non-intrusive wallet discovery (`Ready`, `Argent X`, `Braavos`) with privacy capability checks testing `supportedSpecs >= 0.10.3` without prompting for unauthorized balance access.
  * Built `src/services/privacyService.ts` to manage public ERC-20 calls and private pool actions (`fetchBalances`, `executeShield`, `executePrivateTransfer`, `executeUnshield`).
  * Created UI views:
    * `src/components/Header.tsx`: Connect wallet button, network indicator, and STRK20 capability badges.
    * `src/components/PublishAddressModal.tsx`: Umbra-style "Publish Once" stealth address modal.
    * `src/components/BalanceCards.tsx`: Dual viewer comparing public balances with encrypted UTXO pool notes.
    * `src/components/tabs/ShieldTab.tsx`: 2-step deposit flow with FPI screening notice and ~10 block maturity disclosure.
    * `src/components/tabs/SendTab.tsx`: Encrypted private transfers with Stwo ZK proof tracker.
    * `src/components/tabs/UnshieldTab.tsx`: Private-to-public withdrawals.
    * `src/components/tabs/SwapTab.tsx`: Private AMM swaps.
    * `src/components/tabs/HistoryTab.tsx`: Local decrypted activity log with Voyager block explorer links.
  * Verified headless production build with `npm run build` (compiled 4/4 static pages in 689ms).

#### 🟢 [SMALL CHANGE] — Contract Constructor API Fix
* **Description:** Updated `Contract` instantiation in `src/services/privacyService.ts` from positional arguments `(abi, address, provider)` to Starknet v10 options object `{ abi, address, providerOrAccount }`.

---

## 📅 Saturday, August 15, 2026 — 15:40:10 IST

### 👤 Git Author Attribution & Tracker Indexing Alignment

#### 🔴 [BIG CHANGE] — Git History Rewrite for @SmratJay Attribution
* **Description:** Rewrote git commit history across the repository to ensure all commits are properly attributed to `SmratJay` on GitHub and the Starknet Hackathon indexing tracker.
* **Detailed Technical Explanation:**
  * Configured Git `user.name` = `"SmratJay"` and `user.email` = `"74355410+SmratJay@users.noreply.github.com"`.
  * Executed `git filter-branch` to rewrite author and committer headers on all past commits in `strk20-privacy-wallet`.
  * Force-pushed updated branch to origin `main`.
  * Updated `registry.json` in the hackathon PR branch to explicitly add `"team": ["SmratJay"]`, `"name": "STRK20 Privacy Wallet"`, and updated PR [#35](https://github.com/starkience/strk20-hackathon/pull/35) title and description via GitHub API.

---

## 📅 Saturday, August 15, 2026 — 15:48:23 IST

### 📚 Cryptographic Architecture & UMBRA Mechanism Documentation

#### 🔴 [BIG CHANGE] — Created Comprehensive UMBRA & STRK20 Deep-Dive Document
* **Description:** Created [`UMBRA_AND_STRK20_EXPLAINER.md`](./UMBRA_AND_STRK20_EXPLAINER.md) explaining the mathematics of Umbra stealth addresses, why STRK20 beats Umbra structurally, how our codebase works, and how the installed agent skill operates.
* **Detailed Technical Explanation:**
  * Documented the Diffie-Hellman (ECDH) stealth derivation formulas ($S = r \cdot K_{view}$, $P = K_{spend} + H(S) \cdot G$).
  * Outlined the 5 core flaws of Umbra (2-key setup, visible on-chain address $P$, public announcement event trail, relayer dependency, isolated anonymity set).
  * Detailed STRK20 structural advantages: 1-key registration, 100% encrypted note storage, off-chain subchannel discovery, pool-mediated / paymaster gas abstraction, and shared pool anonymity set.

---

## 📅 Saturday, August 15, 2026 — 22:57:22 IST

### 💎 Production-Grade Upgrades, Live DEX Router & UX Polish

#### 🔴 [BIG CHANGE] — Live AVNU DEX Aggregator Integration (`avnuService.ts`)
* **Description:** Upgraded `src/components/tabs/SwapTab.tsx` and created `src/services/avnuService.ts` integrating real-time quote querying from `@avnu/avnu-sdk` (`getQuotes`).
* **Detailed Technical Explanation:**
  * Fetches real-time market exchange rates and routing paths across Ekubo, JediSwap, and AVNU liquidity sources.
  * Displays live price ratios, route hops, estimated gas fees in STRK, and atomic open note deposit mechanics.

#### 🔴 [BIG CHANGE] — Privacy Address Book & Viewing Key Utility (`viewingKeyService.ts`)
* **Description:** Built `src/services/viewingKeyService.ts` and integrated an interactive contact manager into `src/components/tabs/SendTab.tsx`.
* **Detailed Technical Explanation:**
  * Local storage contact book allowing users to save and label recipient privacy addresses.
  * Viewing key derivations using standard STARK curve message hashing (`0x5354524b3230...`).

#### 🔴 [BIG CHANGE] — Dynamic QR Code Invoice Generator (`RequestTab.tsx`)
* **Description:** Built `src/components/tabs/RequestTab.tsx` with `qrcode.react` to generate dynamic payment invoices.
* **Detailed Technical Explanation:**
  * Generates clean, self-referential payment links pre-filling recipient, token, amount, network, and encrypted memo.

#### 🔴 [BIG CHANGE] — In-Browser Note Scanner & Decryption Engine (`NoteScannerTab.tsx`)
* **Description:** Created `src/components/tabs/NoteScannerTab.tsx` enabling users to derive viewing keys and scan live on-chain deposit/transfer events.
* **Detailed Technical Explanation:**
  * Connects to Starknet RPC provider to scan note events, matching note commitments and nullifiers.

---

## 📅 Tuesday, August 18, 2026 — 15:08:15 IST

### 🪐 Private Execution Layer (PEL) Financial Super-App Expansion

#### 🔴 [BIG CHANGE] — Multi-Venue Intent Router with Route Cost Optimization (`routerService.ts`, `SwapTab.tsx`)
* **Description:** Engineered the mathematical Intent Router minimizing total route cost:
  $$C(r) = P(r) + F(r) + G(r) + S(r) + L(r) + \lambda \Lambda(r)$$
* **Detailed Technical Explanation:**
  * Computes dynamic privacy leakage score $\Lambda(r) \in [0, 100]$ evaluating address traceability, timing entropy, counterparty leakage, and memo protection.

#### 🔴 [BIG CHANGE] — Private Perpetuals Derivatives Engine (`perpsService.ts`, `PerpsTab.tsx`)
* **Description:** Built a leveraged derivatives terminal supporting `BTC-PERP`, `ETH-PERP`, and `STRK-PERP` with $1\times$–$50\times$ leverage, isolated margin calculations, real-time PnL, liquidation inequality checking ($E_t \le M_{\text{maint}}$), and ZK position commitments.

#### 🔴 [BIG CHANGE] — Shielded Earn & Lending Vaults (`earnService.ts`, `EarnTab.tsx`)
* **Description:** Enabled private yield accrual through overcollateralized lending markets (Vesu Lending, USDC Money Market, ETH Staking) directly from shielded STRK20 balances.

#### 🔴 [BIG CHANGE] — Unified Portfolio Surface (`PortfolioTab.tsx`)
* **Description:** Implemented the Whitepaper's Portfolio aggregation formula:
  $$\text{NetWorth} = \sum \text{Value}(N_i) + \sum \text{Equity}(\text{Pos}_j) + \sum \text{Value}(\text{Vault}_k)$$

#### 🔴 [BIG CHANGE] — Scoped Session Keys & 1-Click Fast Execution (`sessionKeyService.ts`, `Header.tsx`)
* **Description:** Implemented ephemeral session keys ($SK = (pk, \text{exp}, \text{contracts}, \text{selectors}, \text{limits})$) enabling 1-click trading without repetitive signature popups.

#### 🔴 [BIG CHANGE] — Reusable ZK Compliance Passports (`CompliancePassportModal.tsx`)
* **Description:** Built verifiable selective disclosure credentials ($\text{Proof}(\text{KYC} = \text{true})$, $\text{Proof}(\text{TotalVolume} \ge \$50k)$, $\text{Proof}(\text{CleanJurisdiction})$) for regulatory auditability.

---

## 📅 Tuesday, August 18, 2026 — 18:10:00 IST

### 🎨 Clean Covalent-Inspired Terminal Workspace & Pure Orange Overhaul

#### 🔴 [BIG CHANGE] — Removed Redundant Top Cards & Consolidated Terminal Header
* **Context:** Removed the old 3-card banner (`PrivacyBanner`), 2-column balance viewer (`BalanceCards`), and privacy health card (`AnonymityScore`) that sat above the terminal.
* **Refined Terminal Layout:** Integrated a high-density, sharp monospace terminal header directly with live network indicators, Stwo STARK verifier telemetry, and 1-click sync buttons, moving directly into the 10 Cyberpunk orange workstation tabs.
* **Component Polishing:**
  * Overhauled all 10 utility tabs (`PortfolioTab`, `SwapTab`, `PerpsTab`, `EarnTab`, `SendTab`, `RequestTab`, `ShieldTab`, `UnshieldTab`, `NoteScannerTab`, `HistoryTab`) to use pure `#FF6B00` electric orange accents, pitch-black `#050508` surfaces, and corner bracket crosshairs.
* **Verification:** Vitest test suite executed: **17/17 tests passing**.
