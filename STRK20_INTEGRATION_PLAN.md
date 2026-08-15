# STRK20 Privacy Wallet — Integration Plan

> Umbra-grade UX on Starknet, fully powered by the existing STRK20 privacy pool.
> No new contracts. No protocol changes. The work is product, UX, and SDK integration.

---

## Background

Umbra on Ethereum hides the recipient behind a one-time stealth address. STRK20 hides
the recipient, the sender, the amount, and the token type — all inside encrypted pool
storage. This wallet delivers the Umbra UX on a fundamentally stronger cryptographic
foundation.

**Pool address (Starknet Mainnet):**
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

---

## Privacy Analysis

### What should be private?

| Action | What to hide | How STRK20 does it |
|---|---|---|
| Receiving funds | Recipient identity, amount, token | Encrypted channel note; no on-chain address |
| Sending funds | Sender identity, amount, token | UseNote → CreateEncNote inside pool |
| Viewing your balance | Balance existence | Note discovery only with your viewing key |
| Gas payment | Transaction initiator | Paymaster / pool-mediated submission |

### What stays visible (by design)

- Shield deposits: depositor address, token, amount
- Unshield withdrawals: recipient address, token, amount
- Timing of pool interactions
- That *someone* is using the pool (not who)

---

## Integration Route

**Primary:** Build Privacy Wallets SDK route (`@starkware-libs/starknet-privacy`)

This is the wallet-builder route — we manage viewing keys, channels, note discovery,
transaction construction, and proving ourselves. The Starknet Wallet API route is for
dapps that sit on top of a wallet; we ARE the wallet.

**Supporting:** Starknet Wallet API (for compatibility with other dapps connecting to us)

---

## Phased Implementation Status

### Phase 0 — Environment & Tooling ✅ done 2026-08-15
- [x] Repository created: `https://github.com/SmratJay/strk20-privacy-wallet`
- [x] `strk20.json` added at repo root
- [x] `.env.example` with `ALCHEMY_STARKNET_KEY` pattern documented
- [x] Alchemy Starknet Mainnet key configured in `.env.local` (gitignored, never committed)
- [x] `npm install starknet@^10.4.0` — pinned version with `WalletAccountV6` STRK20 actions
- [x] `@starknet-io/get-starknet-discovery@6.0.3` & `@starknet-io/get-starknet-wallet-standard@6.0.3`
- [x] `@avnu/avnu-sdk@^4.2.0` for private swap aggregation
- [x] Next.js 15 + TypeScript + Tailwind CSS production build verified

**Key env vars:**
```
ALCHEMY_STARKNET_KEY=<your_key>
NEXT_PUBLIC_STARKNET_RPC=https://starknet-mainnet.g.alchemy.com/v2/<key>
NEXT_PUBLIC_STRK20_POOL=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
NEXT_PUBLIC_CHAIN_ID=SN_MAIN
```

---

### Phase 1 — Viewing Key Registration & Umbra Address Sharing ✅ done 2026-08-15
- [x] One-key registration model: generate/derive viewing key (`k`, `K = k·G` on STARK curve)
- [x] "Publish Privacy Address" modal: Umbra-style `strk20:<address>` sharing format
- [x] Capability check without probing user data: `supportedSpecs` verification for STRK20 API `>= 0.10.3`
- [x] Graceful degradation between Ready extension and standard Starknet wallets

---

### Phase 2 — Note Discovery & Dual Balance Viewer ✅ done 2026-08-15
- [x] BalanceCards component with side-by-side Public Balances vs. Shielded Private Balances
- [x] Multi-token support: STRK, ETH, USDC, USDT
- [x] Background discovery & local state persistence
- [x] Decrypted transaction log with Voyager explorer links

---

### Phase 3 — Shielding (Public → Private Deposits) ✅ done 2026-08-15
- [x] 2-Step transaction flow: ERC-20 `approve` → pool `deposit`
- [x] FPI on-chain screening verification indicators
- [x] Note maturity feedback (~10 blocks notice)
- [x] Transparent disclosure of public deposit amount vs. encrypted pool note

---

### Phase 4 — Private Transfers (Encrypted UTXO Note Relay) ✅ done 2026-08-15
- [x] Recipient input with Umbra `strk20:...` prefix parsing
- [x] ECDH channel derivation and UseNote → CreateEncNote routing
- [x] Stwo ZK proof generation status tracker (~25-30s)
- [x] Paymaster sponsored gas badge (relayed transaction decoupling)

---

### Phase 5 — Unshielding (Private → Public Withdrawals) ✅ done 2026-08-15
- [x] Withdraw shielded balance to any public Starknet address
- [x] One-click "Use Connected Address" helper
- [x] Transparent disclosure of visible ERC-20 withdrawal leg

---

### Phase 6 — Private Swap & AVNU Integration ✅ done 2026-08-15
- [x] Private token swap router powered by AVNU privacy SDK
- [x] Atomic swap credit to fresh encrypted note

---

### Phase 7 — Mobile & Production Hardening
- [ ] React Native wrapper (Expo) for mobile devices
- [ ] Hardware key storage (Secure Enclave on iOS / Android Keystore)
- [ ] Automated push notifications for discovered incoming notes

---

## What Stays Public (Honest UX Copy)

- ✅ **Private:** who you pay, who pays you, amounts, token types, note balances
- ⚠️ **Public:** registration event, deposit amounts (ERC-20 transfer into pool), withdrawal amounts and destination (ERC-20 transfer out of pool), timing

---

## References

- STRK20 docs: https://strk20-by-example.org/llms-full.txt
- Privacy SDK: https://github.com/starkware-libs/starknet-privacy
- Starter kit: https://github.com/Akashneelesh/strk20-starter-kit
- Awesome STRK20: https://github.com/Akashneelesh/awesome-strk20
- Pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
