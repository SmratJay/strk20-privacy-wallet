# ORRANGE — STRK20 Privacy Wallet · Current State

Compact current-state document. Git history preserves the full implementation diary; this file
describes what the repository IS today.

## Current architecture (single source of truth)

```
Orrange UI
  → WalletRuntime            (src/wallet/runtime.ts — the ONE wallet runtime; useSyncExternalStore)
  → Wallet Core              (src/wallet/walletCore.ts — custody, keys, keystore, deploy, send)
  → Ready / Braavos          (src/wallet/account/* — self-custodial account adapters)
  → Starknet                 (starknet.js 10.5.0)

  → WalletPrivacySession     (src/wallet/privacy.ts — wallet-native viewing key, in-memory)
  → Strk20Adapter            (src/privacy/strk20/Strk20Adapter.ts — official vendored SDK)
  → STRK20 SDK               (@starkware-libs/starknet-privacy-sdk 0.14.3-rc.5, vendored)
```

- **No Privy.** No embedded wallet. No external Ready/Wallet-API lane. One wallet identity.
- **Viewing key** `ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1` — frozen, deterministic,
  network-scoped, in-memory only, never exposed publicly.
- **Privy removed**; launchpad create/trade and extended/perps trading are gated ("being migrated
  to Wallet Core") rather than exposing a second wallet identity.

## Completed milestones

1. **Wallet Core (Stage 1)** — keygen, encrypted keystore (AES-GCM + PBKDF2), Ready counterfactual
   derivation, DEPLOY_ACCOUNT, local signing, public/private storage split.
2. **Import + PrivateIdentity (Stage 2)** — Ready/Braavos import with on-chain ownership
   verification (SRC-5), multi-wallet registry, network-scoped keystores.
3. **WalletRuntime + Wallet Core (Stage 2.5)** — primary `/wallet` runtime, generation/stale
   guards, no-walletId-unlock elimination.
4. **STRK20 privacy native to Wallet Core (Stage 3A)** — wallet-native viewing key,
   WalletPrivacySession, neutral Strk20Adapter, honest privacy capability, serialization,
   cache isolation, bounded fee fallback.
5. **Dashboard + hardening (Stage 3A.5)** — full `/wallet` dashboard, deployment lifecycle,
   maturity/sync semantics, private-curve separation, sanitized logging, allowance decimals,
   network-scoped anonymizer.
6. **Consolidation** — Privy removed, one WalletRuntime everywhere (settings/activity/receive/
   swap/treasury), AI trust model (client-claimed addresses can never authorize execution).
7. **First-use shield** — `autoRegister` on shield so a fresh wallet's first 40-STRK Sepolia
   shield succeeds (viewing key + self-channel registered in the same proof).

## Current capabilities

- Create / import (Ready, Braavos) / select / unlock / lock / delete wallets.
- Deploy Ready accounts (fail-closed lifecycle: pending → finalizing → deployed).
- Public balances (RPC), public send (Wallet Core local signer), AVNU public swap.
- STRK20 privacy: register, shield, private send, withdraw; private balances via wallet-native
  viewing key + discovery; honest loading/available/unavailable/error/syncing states.
- Settings and activity derived exclusively from WalletRuntime (walletId + network scoped).
- AI private treasury (Hamster): bounded agent loop, deterministic policy, execution gate that
  re-checks state + requires the active wallet's signature.

## Known limitations

- Discovery operator must be reachable and a funded Sepolia wallet is required for live privacy
  ops (see `docs/STRK20_LIVE_ACCEPTANCE.md`). Discovery OHTTP is a config seam, disabled by
  default (direct HTTPS today).
- Historical activity indexer not built — activity is session-scoped.
- Launchpad create/trade and extended/perps trading are gated pending Wallet Core migration.
- Account deployment requires funding.

## Next milestone

Stage 3B (NEAR Intents, TEE, cross-chain) — NOT started. Begin only after this repository state
is independently audited.

---

## Repository cleanup (2026-09)

De-bloat pass: removed dead architecture without touching the working wallet. Deleted
`/own-wallet` (superseded by `/wallet`), the duplicate viewing-key service and hand-written STRK20
crypto (`strk20Crypto`/`viewingKeyService`/`avnuService`/`privacyService`), the dormant
`src/extended/` perps subsystem (+ API routes, components, tests, scripts), `crates/`
(pel-risk-engine), `perps-experiment/`, the generic `.agents/agents/` library, and the duplicate
`vitest.config.mjs`. Moved `privacyService` (generic chain data) to `src/chains/publicBalances.ts`.
Archived historical perps/privy/planning docs under `docs/archive/`. Replaced the 154 KB diary
with this compact current-state document. Test count 570 → 463 (removed only tests of deleted
dormant systems; all wallet/STRK20/AI behavior coverage preserved).

---

Authoritative docs: `docs/WALLET_CORE.md` (architecture), `docs/STRK20_COMPATIBILITY_MATRIX.md`
(SDK/operator compatibility), `docs/STRK20_LIVE_ACCEPTANCE.md` (live procedure), `docs/archive/`
(historical perps/privy/planning records).