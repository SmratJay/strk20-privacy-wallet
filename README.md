# ORRANGE — STRK20 Privacy Wallet

A self-custodial Starknet privacy wallet. Orrange **is** the wallet: keys are generated and
encrypted locally, accounts are Ready/Braavos, and STRK20 privacy runs through the official
vendored STRK20 SDK with a wallet-native viewing key.

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
```

- **No Privy.** No embedded wallet. No external Ready/Wallet-API lane. One wallet identity
  (`WalletRuntime.getState().account`).
- **Viewing key** `ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1` — frozen, deterministic,
  network-scoped, in-memory only, never exposed publicly.
- Dependency direction: `UI → Features → WalletRuntime/Privacy APIs → Wallet Core/STRK20 →
  Starknet`. Wallet Core never depends on a feature.

## Routes

| Route | Screen |
|---|---|
| `/` | Landing |
| `/wallet` | The wallet — balances, deployment, shield / private send / withdraw, activity, lock |
| `/send` `/receive` | Public + private send, receive (QR) |
| `/swap` | AVNU public swap (signed by Wallet Core) |
| `/settings` `/activity` | Wallet Core account + session activity |
| `/treasury` | Hamster AI private treasury agent |
| `/explore` | Launchpad token feed |
| `/launch` `/launch/[token]` | Launchpad create/trade — **gated** (Wallet Core migration pending) |
| `/extended` | Extended/perps trading — **gated** (Wallet Core migration pending) |

## Capabilities

- Create / import (Ready, Braavos with on-chain ownership verification) / select / unlock /
  lock / delete wallets.
- Deploy Ready accounts (fail-closed lifecycle).
- Public balances (RPC), public send (local signer), AVNU public swap.
- STRK20 privacy: register, shield, private send, withdraw; private balances via the wallet-native
  viewing key + discovery; honest loading/available/unavailable/error/syncing states; privacy ops
  serialized per session; stale results dropped by generation guards.
- AI private treasury (Hamster): bounded agent loop, deterministic policy, execution gate that
  re-checks state and requires the active wallet's signature. Client-claimed addresses can never
  authorize execution.

## Structure

```
src/
  app/            App Router pages + API routes (/api/ai/analyze, /api/launch/metadata)
  components/     UI (wallet, landing, launch, docs)
  config/         networks (one authoritative config)
  context/        WalletRuntimeContext, NetworkContext
  wallet/         Wallet Core: runtime, custody, keystore, account adapters, privacy session
  privacy/        STRK20 privacy: Strk20Adapter (official SDK), allowance, private-curve, identity
  chains/         neutral on-chain data (public balances)
  services/       feature + data services (treasury gate, swap, prices, launch browse)
  ai/             Hamster treasury agent
circuits/         circuit sources
contracts/        Starknet contracts
umbra-launch-contracts/   Launchpad contracts
deployments/      deployment records
docs/             architecture, compatibility, live-acceptance, archive
scripts/          deploy/automation scripts
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
| `NEXT_PUBLIC_STRK20_PROVER_URL` / `NEXT_PUBLIC_STRK20_DISCOVERY_URL` | STRK20 operator services |
| `NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA` | STRK20 shadow-account anonymizer (public config) |
| `NEXT_PUBLIC_READY_CLASSHASH` | Ready account class hash |

Live privacy operations require a **funded Sepolia wallet** and **reachable operator services**.
See `docs/STRK20_LIVE_ACCEPTANCE.md`.

## Tests

- Behavior/security tests under `src/__tests__/` (wallet lifecycle, STRK20 ops, serialization,
  stale isolation, cache/fee safety, allowance, privacy removal, one-source-of-truth).
- Real Starknet Sepolia integration tests (`walletCoreRealNetwork.test.ts`) skip honestly when the
  RPC, operator services, or funding are unavailable.

## Documentation index

- `docs/WALLET_CORE.md` — the authoritative architecture document
- `docs/STRK20_COMPATIBILITY_MATRIX.md` — SDK/operator compatibility
- `docs/STRK20_LIVE_ACCEPTANCE.md` — live acceptance procedure
- `docs/archive/` — historical perps / privy / planning records (feature removed or gated)
- `WHAT_WE_HAVE_DONE_SO_FAR.md` — compact current-state summary (git history holds the diary)

## Known limitations

- Discovery operator must be reachable and a funded Sepolia wallet is required for live privacy
  ops. Discovery OHTTP is a config seam, disabled by default (direct HTTPS today).
- Historical activity indexer not built — activity is session-scoped.
- Launchpad create/trade and extended/perps trading are gated pending Wallet Core migration.
- Account deployment requires funding.

## Next milestone

Stage 3B (NEAR Intents, TEE, cross-chain) — not started.