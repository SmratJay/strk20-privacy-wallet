# Orrange — STRK20 Privacy Terminal

> **Everything private, in one terminal.**

A private financial terminal for **Starknet**, built on the STRK20 privacy pool. **Shield. Send.
Swap. Trade.** Ordinary users can hold, receive, send, swap, and trade **STRK20** (and STRK20-based
assets) privately — without touching any cryptography.

This application **does not implement a new wallet, privacy pool, proof system, or cryptographic
protocol.** It provides the consumer-facing STRK20 privacy experience on top of the existing
Starknet **Wallet API**, the **STRK20 privacy pool**, and compatible privacy wallets (Ready,
Privy embedded).

---

## What is this?

STRK20 is Starknet's native, Umbra-style privacy pool for shielded private payments. **Orrange** is
the consumer surface for it: a wallet-like terminal where you **connect your privacy wallet**,
**enable private receiving once**, **share your private address**, and then **send, receive, swap,
and trade privately** — while the pool hides sender, recipient, amount, and token.

## The problem

Private transfers on Starknet exist, but using them today means understanding encrypted notes,
viewing keys, ECDH, nullifiers, proof generation, and discovery infrastructure. That is a
developer SDK, not a consumer product.

## The solution

A normal, calm consumer terminal on top of the STRK20 protocol. The user sees
**Receive / Send / Balance / Activity / Swap / Trade**. The STRK20 complexity (viewing keys,
encrypted notes, discovery, proofs) is handled underneath by the connected privacy wallet, the
pool, and Orrange's integration layer.

## Why STRK20

- **One-key registration** — a single viewing-key registration enables private receiving.
- **Full note privacy** — notes are encrypted; sender, recipient, amount, and token stay hidden.
- **Shared anonymity set** — every shielded transfer mixes into the same pool.
- **Stronger than Umbra** — Umbra's stealth addresses leak the recipient's address and rely on a
  relayer; STRK20 keeps notes encrypted in the pool and uses wallet-side discovery.

## Umbra comparison

| | Umbra | STRK20 (this app) |
|---|---|---|
| Registration | 2-key setup (view + spend) | single viewing key, transparent |
| Receive identity | derived stealth address on-chain | your Starknet address (registered) |
| Announcement | public event trail | encrypted note in pool |
| Discovery | scan announced events | wallet-side encrypted-note discovery |
| Relayer | required | optional / paymaster-friendly |

---

## Terminal features

### Shield (private wallet)

The core STRK20 wallet: **Enable private receiving** once, share your **private address**, then
**send and receive STRK20 privately**. Accurate balances come only from your connected wallet via
`wallet_strk20Balances` — no mock balances or fake confirmations.

### Swap

Public and **private swap** through the AVNU DEX aggregator. Private swaps route a shielded STRK
note through the STRK20 pool and return the output as a shielded note.

### Launchpad (Orrange Launchpad V2)

A memecoin launchpad with a private execution layer, **deployed and verified on Starknet Sepolia**
(`docs/LAUNCHPAD_V2_DEPLOYMENT.md`). The market is a single canonical public bonding curve; a trade
can run **publicly** or **privately** through the STRK20 privacy pool via the `PrivateCurveExecutor`
— the *same* curve, so graduation and liquidity migration stay truthful and on-chain.

### Treasury (AI private treasury agent)

An in-terminal AI agent ("Orrange Treasury") that reads your private balances, builds a portfolio
summary, applies a configurable treasury policy (presets + custom), simulates actions, and proposes
governed private actions with health/actionability diagnosis. See `src/ai/`.

### Extended (private perpetuals)

Private perpetuals and trading surface backed by the PEL (Private Execution Layer) contracts,
the Rust risk engine, and STRK20 note-based settlement. See `docs/LP_*` and `docs/PERPS_*`.

---

## Wallet API architecture

The dapp never sees secrets. The connected privacy wallet owns viewing keys, encrypted notes,
note discovery, note decryption, proof generation, and signing. The dapp requests authorized
operations through the Wallet API:

- `wallet_strk20InvokeTransaction` — submit a STRK20 action (`deposit` / `withdraw` / `transfer`)
- `wallet_strk20Balances` — read private balances (the wallet's discovery output)

There is **no standalone registration RPC**. Registration is *transparent*: the wallet adds the
`SetViewingKey` + channel setup actions to your first real STRK20 action. See
`docs/PRIVATE_RECEIVING_ARCHITECTURE.md`.

## Private receiving flow

1. Connect a privacy wallet.
2. **Enable private receiving** — performs a real STRK20 action through your wallet; the wallet
   registers your viewing key and shields your first note in the same transaction.
3. When ready, your **private address** (your Starknet address) is available.
4. Share it once (QR / copy / share). Anyone can send you a private STRK20 payment.
5. The sender's private transfer executes on the pool.
6. **Your wallet performs discovery** and your private balance updates.
7. The dapp displays the authoritative balance from your wallet.

## Private sending flow

1. Choose **Send privately**, enter the recipient's Starknet address and amount.
2. Review the private payment.
3. Confirm in your wallet — it builds the note, generates the proof, and submits.
4. The dapp reconciles the real transaction state (submitted → confirming → confirmed).

## Supported wallets

- **Ready** (privacy-enabled Starknet wallet, Wallet API ≥ 0.10). STRK20 private features require
  a wallet that supports the STRK20 Wallet API methods.
- **Privy embedded wallet** via the `PrivyStrk20Adapter` (server-side rawSign), for a
  non-extension onboarding lane. See `docs/PRIVY_STRK20_ARCHITECTURE.md`.

## Supported network

- **Starknet Sepolia** (primary, validated). Network is auto-synced from the connected wallet.

---

## Getting started

```bash
npm install
npm run dev        # open http://localhost:3000
npm run typecheck  # TypeScript
npm test           # vitest
```

Install the Ready browser extension (or connect Privy), connect, enable private receiving, and fund
a small amount.

## Demo

Two-wallet private receive:

1. **Wallet A** — connect, enable private receiving, copy its private address.
2. **Wallet B** — connect, send a private STRK20 payment to A's address.
3. The transaction reaches the STRK20 pool.
4. **Wallet A** — its wallet performs discovery; its private balance updates.
5. **Wallet A** — send privately back to B; B's wallet discovers the payment.

> End-to-end execution requires a live privacy wallet, a funded Sepolia account, and the STRK20
> operator proving/discovery stack. See `docs/RFP_ALIGNMENT.md` for status and blockers.

---

## Privacy model

STRK20 hides the sender, recipient, amount, and token type inside the privacy pool. It does not
hide broader network activity such as transaction timing. This app never claims "100% anonymous"
or "untraceable" — it accurately communicates STRK20's pool-level privacy properties.

## Security boundaries

- The dapp **never** receives or stores viewing keys, encrypted notes, decrypted notes, proofs,
  nullifiers, or any cryptographic secret.
- Viewing keys, notes, discovery, decryption, and proofs are owned by the connected privacy wallet.
- Private balances come only from the wallet via `wallet_strk20Balances`.
- No mock balances, fake transactions, or fake confirmations exist in the real flow.
- The private launchpad is honest about its boundaries: graduation and liquidity migration are
  real, on-chain router states — never a fake "DEX" claim.

## Known limitations

- **Zero-balance registration**: there is no register-only Wallet API RPC, so an unfunded account
  cannot be registered by the dapp alone — it must fund a small amount or complete setup in the
  wallet's own UI.
- **Consent-gated readiness**: `wallet_strk20Balances` is behind the wallet's "share private
  balances" consent; a refused consent makes readiness unknown.
- **No per-payment inbound history**: the Wallet API exposes balances, not inbound payment
  history, so activity is a local UI cache of your own actions.
- **Fee sponsorship not assumed**: the network fee is paid by your wallet; we do not assert
  sponsorship unless the wallet/chain confirms it.
- **Live end-to-end not verified in this repo**: wallet-side registration/discovery/proving are
  inferred from the official spec and SDK, not demonstrated against a real wallet + chain here.

---

## RFP alignment

See `docs/RFP_ALIGNMENT.md` for a requirement-by-requirement mapping with status.
See `docs/RFP_PRODUCT_SPEC.md` (product contract) and
`docs/PRIVATE_RECEIVING_ARCHITECTURE.md` (receive architecture) for the source of truth.

## Documentation index

- `docs/RFP_ALIGNMENT.md`, `docs/RFP_PRODUCT_SPEC.md` — RFP requirements and product contract
- `docs/PRIVATE_RECEIVING_ARCHITECTURE.md` — private receiving / viewing-key architecture
- `docs/PRIVY_STRK20_ARCHITECTURE.md` (+ `_AUDIT`, `_COMPATIBILITY_AUDIT`, `_SECURITY_MODEL`) — Privy lane
- `docs/UMBRA_LAUNCH.md`, `docs/LAUNCHPAD_V2_DEPLOYMENT.md` — private launchpad
- `docs/LP_ARCHITECTURE.md` (+ `_ECONOMIC_MODEL`, `_RISK_MODEL`, `_SECURITY_MODEL`) — liquidity
- `docs/PERPS_IMPLEMENTATION_STATUS.md` (+ `PERPS_ARCHITECTURE.md` at repo root) — private perps
- `docs/CIRCUITS.md` — circuit/proving notes
