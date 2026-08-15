# 🔒 STRK20 Privacy Wallet

> **Umbra-grade UX on a stronger foundation — fully powered by the STRK20 privacy pool on Starknet.**

Built by **Jai** ([@SmratJay](https://github.com/SmratJay)) — founder of [orrange.xyz](https://orrange.xyz), web3 degen & ZK enthusiast.

---

## What is this?

A Starknet wallet that delivers the **Umbra UX** — publish once, receive privately, spend freely — entirely built on top of the existing [STRK20 privacy pool](https://strk20-by-example.org/what-is-strk20). No new contracts. No protocol changes. The cryptography is already in production; what's missing is the consumer surface.

### STRK20 vs Umbra

| Umbra concept | STRK20 equivalent | Advantage |
|---|---|---|
| Stealth meta-address (2 public keys) | Registered viewing key | One key, on-chain, simpler |
| Per-payment stealth address | Per-channel encrypted notes | No visible on-chain address at all |
| Announcement events for scanning | Discovery service | Off-chain scan — no public event trail |
| View-tag filtering | Full ECDH decryption | Discovery handles compute; no shortcuts |
| Relayer for gas-free withdrawals | Pool-mediated withdrawals | Pool is the caller — no separate relayer |
| Anonymity set = stealth users | Anonymity set = all pool participants | Shared pool with transfers and apps |

---

## What this wallet does

- **One-key registration** — Generate and register a viewing key on first use. Smaller surface, simpler onboarding than Umbra's 2-key stealth meta-address.
- **Publish a privacy receive address** — Anyone can pay you without you revealing your on-chain identity.
- **Automatic note discovery** — Runs the STRK20 discovery service against your viewing key to surface incoming notes.
- **Private sends** — Withdraw / CreateEncNote through the pool with paymaster-sponsored gas. No separate relayer needed.
- **Clean wallet UI** — Discovery, encryption, and proof-construction are all under the hood. Looks like a wallet, behaves like privacy.

---

## Architecture

```
Browser / Mobile
      │
      ▼
  Wallet UI (Next.js)
      │
      ├── Viewing Key Registration (SetViewingKey → STRK20 pool)
      ├── Note Discovery (Privacy SDK discovery service)
      ├── Shield / Unshield / Private Transfer
      └── Paymaster (pool-mediated, no separate relayer)
      │
      ▼
  STRK20 Privacy Pool
  0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

---

## Tech stack

- **Frontend**: Next.js + starknet.js + Wallet API
- **Privacy**: [STRK20 Privacy SDK](https://github.com/starkware-libs/starknet-privacy)
- **Starter kit**: [strk20-starter-kit](https://github.com/Akashneelesh/strk20-starter-kit)
- **Chain**: Starknet Mainnet (`SN_MAIN`)
- **RPC**: Alchemy (via `ALCHEMY_STARKNET_KEY` env var)

---

## Getting started

```bash
# Clone
git clone https://github.com/SmratJay/strk20-privacy-wallet
cd strk20-privacy-wallet

# Install
npm install

# Configure
cp .env.example .env.local
# Fill in ALCHEMY_STARKNET_KEY

# Run
npm run dev
```

---

## STRK20 Integration

See [`STRK20_INTEGRATION_PLAN.md`](./STRK20_INTEGRATION_PLAN.md) for the phased integration plan.

Pool address: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

---

## Builder

**Jai Bhati** — founder of [orrange.xyz](https://orrange.xyz)  
GitHub: [@SmratJay](https://github.com/SmratJay)  
Telegram: [@popexenon](https://t.me/popexenon)

---

## License

MIT
