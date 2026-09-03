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

The app is a single Next.js terminal with these screens:

| Route | Screen |
|---|---|
| `/` | Landing (Orrange hero) |
| `/wallet` | Shield wallet — balances, private receive/send, activity |
| `/receive` / `/send` | Dedicated private receive / private send flows |
| `/swap` | Swap — public and STRK20-private, via AVNU |
| `/explore` | Launchpad token feed (new / trending / near graduation) |
| `/launch` | Launchpad — create a token, public & private trading |
| `/launch/[token]` | Token page — curve state, price, trades, buy/sell |
| `/treasury` | Hamster AI private treasury agent |
| `/extended` | Private perpetuals terminal (PEL) |
| `/settings` / `/activity` | Wallet settings and local activity |

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

## Architecture

```
USER
  ↓
ORRANGE TERMINAL      ← UI, routing, connect, receive/send/swap/trade UX, app state
  ↓
STARKNET WALLET API    ← wallet_strk20InvokeTransaction / wallet_strk20Balances
  ↓
PRIVACY WALLET          ← viewing keys, notes, discovery, decryption, proofs, signing
  (Ready extension or Privy embedded)
  ↓
STRK20 PRIVACY INFRASTRUCTURE  ← proving / discovery services
  ↓
STRK20 PRIVACY POOL
  ↓
STARKNET
```

The dapp never sees secrets. The connected privacy wallet owns viewing keys, encrypted notes,
note discovery, note decryption, proof generation, and signing. The dapp requests authorized
operations through the Wallet API:

- `wallet_strk20InvokeTransaction` — submit a STRK20 action (`deposit` / `withdraw` / `transfer`)
- `wallet_strk20Balances` — read private balances (the wallet's discovery output)

There is **no standalone registration RPC**. Registration is *transparent*: the wallet adds the
`SetViewingKey` + channel setup actions to your first real STRK20 action. See
`docs/PRIVATE_RECEIVING_ARCHITECTURE.md`.

Wallet capability detection is **capability-based, never name-based**: the app calls
`wallet_supportedWalletApi` / `wallet_supportedSpecs` / `wallet_requestChainId` and only treats a
Wallet API ≥ 0.10 as STRK20-capable. See `src/services/strk20WalletApiService.ts`.

### Two STRK20 integration lanes

- **LANE A — Generic STRK20 wallet UX** (Ready / Wallet API): Shield, private send, unshield, and
  private balances run through the user's privacy-enabled wallet. The wallet owns viewing keys,
  notes, and SNIP-36 proof generation.
- **LANE B — PEL private perps** (raw STRK20 SDK → `ComputeAndInvoke` → PEL bridge → PEL core):
  used by the extended perps terminal and requires the operator proving/discovery stack.

---

## Terminal features

### Shield (private wallet)

The core STRK20 wallet. **Enable private receiving** once, share your **private address**, then
**send and receive STRK20 privately**:

- **Shield** — wrap public STRK into a shielded note (`deposit`).
- **Private send** — send shielded STRK20 to any registered address (`transfer`).
- **Unshield** — withdraw back to public balances (`withdraw`).
- **Private balances** — read the wallet's discovery output via `wallet_strk20Balances`.

Accurate balances come only from your connected wallet — **no mock balances or fake
confirmations**. Transaction state is reconciled on-chain (submitted → confirming → confirmed),
with a timeout that resolves to PENDING rather than a false "confirmed". Wallet errors are mapped
to honest UX copy (e.g. NOT_REGISTERED, INSUFFICIENT_PRIVATE_BALANCE, PRIVACY_LEAK,
USER_REFUSED_OP, API_VERSION_NOT_SUPPORTED).

Private balances are **consent-gated**: the app only calls `wallet_strk20Balances` on an explicit
user action (grant, after a mutation, or a manual refresh) — never on a polling timer, which would
re-trigger the wallet's "share private balances" prompt.

### Swap

Public and **STRK20-private swap** through the [AVNU DEX aggregator](https://avnu.fi) using the
current `@avnu/avnu-sdk`:

- **Public swap** — best-route quote for the user's public balance, executed by the wallet
  directly against the aggregator.
- **Private swap** — a shielded STRK note is spent through the STRK20 pool, routed via AVNU's
  private execution (`quoteToCalls({ private: true })`), and the output returns as a shielded
  note. Private legs are gas-sponsored by AVNU's paymaster.

The AVNU paymaster key is **server-only** (`src/app/api/avnu/paymaster/route.ts`) — the browser
never holds it. Default slippage is 1% public / 3% private.

### Launchpad (Orrange Launchpad V2)

A Pump.fun-style memecoin launchpad with a **private execution layer**, **deployed and verified
on Starknet Sepolia** (`docs/LAUNCHPAD_V2_DEPLOYMENT.md`).

> **Privacy is a property of the trade, not the market.**

The market is a single canonical public bonding curve — price, liquidity, curve state, and
graduation are all on-chain and public. A trade can run **publicly** (your wallet calls the curve)
or **privately** through the STRK20 privacy pool: shielded STRK note → `PrivateCurveExecutor` →
the *same* curve → shielded memecoin note (and the reverse for selling).

- **One canonical market, two execution layers** — no public/private pool split, no second price.
- **BondingCurve V2** — virtual-reserve constant product with ceil division on both legs
  (rounding dust always favors the pool — no rounding exploit). 1% fee on both legs accruing to
  graduation liquidity.
- **PrivateCurveExecutor** — the STRK20 invoke anonymizer for the curve. The curve sees the
  executor as the trader, never the end user's wallet.
- **TokenFactory** — declares + deploys the memecoin, curve, and executor per launch.
- **GraduationRouter** — truthful graduation seam: on crossing the target, the curve's final
  reserves move to the router and then to a configured liquidity manager. The UI reports
  "graduated / migrated" only from real on-chain state — never a fake DEX claim.
- **Executor locked to the STRK20 pool** — a non-pool `privacy_invoke` reverts on-chain.

Launchpad contracts live in `umbra-launch-contracts/` (48/48 snforge tests passing). Verified
on-chain: public/private buy-sell round trips, HAMSTR driven to graduation, and migration of
reserves to the manager.

### Treasury (Hamster AI private treasury agent)

An in-terminal AI agent that treats your STRK20 balances as a **private treasury**:

- **Portfolio** — reads private balances via the STRK20 lane, builds an exact-base portfolio
  summary with real-time price resolution (`src/ai/portfolio.ts`, `src/ai/prices.ts`).
- **Deterministic policy engine** — the LLM proposes; the policy decides. Every check is a pure
  function of (proposal, portfolio, policy): exact bigint math (never floats), min liquidity,
  max position, max tx size, allowed assets, and approved destinations. An **empty destination
  allowlist denies all execution** — the model can never invent a destination
  (`src/ai/policy.ts`).
- **Bounded agent loop** — the model emits structured tool calls or a structured `AgentPlan` as
  strict JSON over ≤ 5 steps; tools run deterministically server-side. The agent **never signs,
  never sees viewing keys/notes, and never emits arbitrary calldata**
  (`src/ai/agent.ts`).
- **Health & actionability** — computes treasury health, scenario simulations, and
  diagnosis/actionability so the user sees why an action is or isn't recommended
  (`src/ai/health.ts`).
- **Guardrailed execution** — validated intents execute only through the injected STRK20
  `privateTransfer`, with expiry, state re-check, tamper-proof bigint reconstruction, and a
  deterministic policy re-run against fresh state/prices (`src/ai/execution.ts`).
- **Shadow accounts (optional)** — feature-gated STRK20 `shadow_account_anonymizer` execution
  identity when an anonymizer contract is configured; commitment derivation is always
  client-side.

### Extended (private perpetuals — PEL)

Private perpetuals and trading surface backed by the **Private Execution Layer (PEL)**: Cairo
contracts (`PELPerpsCore`, `PELLiquidityVault`, insurance reserve, oracle, keeper), the Rust risk
engine (`crates/pel-risk-engine`), real **Garaga Groth16 verifiers**, and STRK20 note-based
settlement. The terminal includes a candle chart, order book, and order panel.

Status: **Phase 0 + Phase 1 complete** — the five real Garaga Groth16 verifiers are built and
wired, and the authoritative real OPEN E2E (`tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts`) passes
against an actual deployed verifier with genuine snarkjs proofs (replay and mutated-proof
rejection verified on-chain). See `docs/PERPS_IMPLEMENTATION_STATUS.md` and
`docs/PEL_IMPLEMENTATION_AUDIT.md`.

---

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
  non-extension onboarding lane. Privy never learns the viewing key; the viewing key is derived
  and stored by the privacy layer separately. See `docs/PRIVY_STRK20_ARCHITECTURE.md`.

## Supported network

- **Starknet Sepolia** (primary, validated). Network is auto-synced from the connected wallet.

---

## Project structure

```
src/
  app/            Next.js routes (landing, wallet, receive, send, swap, explore, launch, treasury, extended, settings, activity, api)
  ai/             Hamster treasury agent (provider, schema, policy, portfolio, prices, plan, health, execution, shadow, tools)
  components/     UI (wallet, landing, launch, extended, docs)
  config/         networks, tokens, launchpad config
  context/        Wallet, Privy, Extended, Network context providers
  services/       Wallet API lane, AVNU swaps, launchpad, STRK20 crypto, prices, treasury
circuits/         circuit sources
contracts/        Starknet contracts
crates/           Rust services (e.g. pel-risk-engine)
umbra-launch-contracts/   Launchpad V2 contracts (memecoin, bonding curve, executor, factory, router)
deployments/      deployment records
docs/             architecture, audit, and status documents
tests/            vitest + e2e tests
scripts/          deploy and automation scripts
```

---

## Getting started

```bash
npm install
npm run dev        # open http://localhost:3000
npm run typecheck  # TypeScript
npm test           # vitest
npm run build      # production build
```

### Configuration

Copy `.env.example` to `.env.local` and fill in the values. Key variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_STARKNET_RPC` | Starknet RPC endpoint (public Sepolia fallbacks built in) |
| `NEXT_PUBLIC_STRK20_SEPOLIA_POOL` | STRK20 pool address on Sepolia |
| `NEXT_PUBLIC_STRK20_PROVER_URL` / `NEXT_PUBLIC_STRK20_DISCOVERY_URL` | STRK20 operator proving/discovery services |
| `AVNU_PAYMASTER_API_KEY` | AVNU paymaster for private swap gas sponsorship (**server-only**) |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | OpenAI-compatible endpoint for the treasury agent (**server-only**) |
| `AI_ALLOWED_ASSETS` / `AI_ALLOWED_DESTINATIONS` | Server-authoritative execution allowlists (empty destinations denies all) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Privy embedded-wallet credentials (**server-only**) |
| `SHADOW_ACCOUNT_ANONYMIZER_ADDRESS` | Optional shadow-account execution identity |

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
- AI secrets are server-only (`AVNU_PAYMASTER_API_KEY`, `AI_API_KEY`, `PRIVY_APP_SECRET`); the
  browser never holds them.
- The AI treasury agent proposes and plans but never executes on its own: a deterministic policy
  engine and the user gate every action.
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
- **PEL perps require operator infrastructure**: opening positions needs the STRK20 proving and
  discovery services running (see `.env.example` and `docs/PERPS_IMPLEMENTATION_STATUS.md`).

---

## RFP alignment

See `docs/RFP_ALIGNMENT.md` for a requirement-by-requirement mapping with status.
See `docs/RFP_PRODUCT_SPEC.md` (product contract) and
`docs/PRIVATE_RECEIVING_ARCHITECTURE.md` (receive architecture) for the source of truth.

## Documentation index

- `docs/WALLET_CORE.md` — self-custodial Wallet Core (Stage 1: keys, keystore, account, signing; Stage 2: Ready/Braavos import, ownership verification, private identity, STRK20 bridge)
- `docs/RFP_ALIGNMENT.md`, `docs/RFP_PRODUCT_SPEC.md` — RFP requirements and product contract
- `docs/PRIVATE_RECEIVING_ARCHITECTURE.md` — private receiving / viewing-key architecture
- `docs/PRIVY_STRK20_ARCHITECTURE.md` (+ `_AUDIT`, `_COMPATIBILITY_AUDIT`, `_SECURITY_MODEL`) — Privy lane
- `docs/UMBRA_LAUNCH.md`, `docs/LAUNCHPAD_V2_DEPLOYMENT.md` — private launchpad
- `docs/LP_ARCHITECTURE.md` (+ `_ECONOMIC_MODEL`, `_RISK_MODEL`, `_SECURITY_MODEL`) — liquidity
- `docs/PERPS_IMPLEMENTATION_STATUS.md`, `docs/PERPS_PRE_IMPLEMENTATION_AUDIT.md`, `docs/PEL_IMPLEMENTATION_AUDIT.md`, `PERPS_ARCHITECTURE.md` (repo root) — private perps
- `docs/CIRCUITS.md` — circuit/proving notes