# ORRANGE — STRK20 Privacy Wallet (Final MVP)

Orrange = **self-custodial Starknet wallet + STRK20 private balances + Shadow Account private
execution + cross-chain settlement via NEAR Intents**. Keys are generated and encrypted locally,
accounts are Ready/Braavos, and STRK20 privacy runs through the official vendored STRK20 SDK with a
wallet-native viewing key.

- **STRK20** = the privacy primitive (shielded notes, viewing key, proofs).
- **Shadow Account** = the private execution identity (application caller, source depositor).
- **NEAR Intents** = routing/settlement (Starknet STRK → Base USDC).
- **TEE / Confidential Intents** = future capability (researched; not yet consumable for a
  Starknet-only source identity).

## Architecture (one wallet runtime)

```
Orrange UI
  → WalletRuntime            (src/wallet/runtime.ts — the ONE wallet runtime)
  → Wallet Core              (src/wallet/walletCore.ts — custody, keystore, deploy, send)
  → Ready / Braavos          (src/wallet/account/* — self-custodial account adapters)
  → Starknet                 (starknet.js 10.5.0)

  → WalletPrivacySession     (src/wallet/privacy.ts — wallet-native viewing key, in-memory)
  → Strk20Adapter            (src/privacy/strk20/Strk20Adapter.ts — official vendored SDK)
  → STRK20 SDK               (@starkware-libs/starknet-privacy-sdk 0.14.3-rc.5)

  → PrivacyHub               (src/features/privacy-hub — orchestration only)
  → NearIntentProvider       (src/features/privacy-hub/provider.ts → NearIntentAdapter)
  → NEAR Intents 1Click      (routing/settlement → solver → Base)
```

- **No Privy.** No embedded wallet. No external Ready/Wallet-API lane. One wallet identity
  (`WalletRuntime.getState().account`).
- **Viewing key** `ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1` — frozen, deterministic,
  network-scoped, in-memory only, never exposed publicly.
- Dependency direction: `UI → Features → WalletRuntime/Privacy APIs → Wallet Core/STRK20 →
  Starknet`. Wallet Core never depends on a feature.
- **Privacy boundary (explicit):** PRIVATE root→STRK20 balance→Shadow Account; PUBLIC
  Shadow→NEAR deposit and NEAR solver→destination. Orrange does **not** claim anonymous or
  untraceable cross-chain transfers.

## Routes

| Route | Screen |
|---|---|
| `/` | Landing |
| `/wallet` | The hero demo — balances, shield / private send / withdraw, private execute, **private swap**, **private cross-chain**, evidence panel |
| `/send` `/receive` | Public + private send, receive (QR) |
| `/swap` | AVNU public swap (signed by Wallet Core) |
| `/settings` `/activity` | Wallet Core account + session activity |
| `/treasury` | Hamster AI private treasury agent |
| `/explore` | Launchpad token feed |
| `/launch` `/launch/[token]` | Launchpad create/trade — **gated** |
| `/extended` | Extended/perps trading — **gated** |

## Capabilities

- Create / import (Ready, Braavos with on-chain ownership verification) / select / unlock /
  lock / delete wallets.
- Deploy Ready accounts (fail-closed lifecycle).
- Public balances (RPC), public send (local signer), AVNU public swap.
- STRK20 privacy: register, shield, private send, withdraw; private balances via the wallet-native
  viewing key + discovery; honest loading/available/unavailable/error/syncing states; privacy ops
  serialized per session; stale results dropped by generation guards.
- **Private swap** (`/wallet` → Private swap): private STRK → real STRK20 shadow account → real
  swap application (BondingCurve V2) → private result. The shadow account is the swap trader, the
  root wallet is never the caller.
- **Private cross-chain** (`/wallet` → Private cross-chain): private STRK → Shadow Account → NEAR
  1Click deposit → solver → **USDC on Base**. Three-way mainnet gate
  (`configured → available → settlementEnabled`) + pre-flight readiness; refunds are honest
  ("recovery required", never "private balance restored").
- **Mainnet STRK20 prover**: server-side Starkscan relay proxy (`/api/starkscan/prove`) — the
  secret `STARKSCAN_API_KEY` never reaches the browser.

## Structure

```
src/
  app/            App Router pages + API routes (/api/starkscan/prove, /api/ai/analyze, …)
  components/     UI (wallet incl. DemoEvidencePanel, landing, launch, docs)
  config/         networks (one authoritative config)
  context/        WalletRuntimeContext, NetworkContext
  wallet/         Wallet Core: runtime, custody, keystore, account adapters, privacy session
  privacy/        STRK20 privacy: Strk20Adapter (official SDK), allowance, private-curve, identity
  features/       private-swap, near-intents, privacy-hub (orchestration)
  chains/         neutral on-chain data (public balances)
  services/       feature + data services (starkscanProver, treasury gate, swap, prices)
  ai/             Hamster treasury agent
circuits/ contracts/ deployments/ docs/ scripts/   (see docs/PRIVACY_HUB.md, docs/NEAR_INTENTS.md)
```

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm test
npm run build
```

Copy `.env.example` to `.env.local`. Key variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_STARKNET_RPC_URL` | Starknet Sepolia RPC (public fallbacks built in) |
| `NEXT_PUBLIC_STRK20_SEPOLIA_POOL` | STRK20 pool address on Sepolia |
| `NEXT_PUBLIC_STRK20_PROVER_URL` / `NEXT_PUBLIC_STRK20_DISCOVERY_URL` | STRK20 operator services (Sepolia) |
| `NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA` | STRK20 shadow-account anonymizer (public config) |
| `NEXT_PUBLIC_STRK20_PROVER_URL_MAINNET` | Mainnet prover → our server proxy (`/api/starkscan/prove`) |
| `NEXT_PUBLIC_STRK20_DISCOVERY_URL_MAINNET` / `NEXT_PUBLIC_STRK20_ANONYMIZER_MAINNET` | Mainnet operator (explicit, never inherited) |
| `STARKSCAN_API_KEY` | **Server-only** Starkscan mainnet prover key (never in the browser) |
| `NEXT_PUBLIC_READY_CLASSHASH` | Ready account class hash |

Live privacy operations require a **funded wallet** and **reachable operator services**. Sepolia
is fully functional today; mainnet is gated on the operator endpoints + Starkscan key + a funded
account (see `docs/STRK20_LIVE_ACCEPTANCE.md`).

## Tests

- Behavior/security tests under `src/__tests__/` (wallet lifecycle, STRK20 ops, serialization,
  stale isolation, cache/fee safety, allowance, privacy removal, near-intents, privacy-hub,
  starkscan prover proxy).
- Real Starknet integration tests skip honestly when the RPC, operator services, or funding are
  unavailable.

## Documentation index

- `docs/WALLET_CORE.md` — the authoritative architecture document
- `docs/STRK20_COMPATIBILITY_MATRIX.md` — SDK/operator compatibility
- `docs/STRK20_LIVE_ACCEPTANCE.md` — live acceptance procedure
- `docs/PRIVATE_SWAP.md` — the real shadow-account private swap
- `docs/NEAR_INTENTS.md` — cross-chain adapter, refund model, mainnet gate
- `docs/PRIVACY_HUB.md` — orchestration layer + confidential-execution boundary
- `WHAT_WE_HAVE_DONE_SO_FAR.md` — compact current-state summary

## Known limitations

- Discovery operator must be reachable and a funded wallet is required for live privacy ops.
- Mainnet settlement is gated on external infrastructure (Starkscan key + mainnet operator +
  funded account); cross-chain is not claimed until reconciled.
- Historical activity indexer not built — activity is session-scoped.