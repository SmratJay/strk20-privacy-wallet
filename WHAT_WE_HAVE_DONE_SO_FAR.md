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

## Public STRK send fix (2026-09)

Fixed malformed ERC20 u256 calldata for public STRK sends. Root cause: `WalletCoreSend` built
`transfer` calldata as `[recipient, amount]` (a single bigint felt, length 2), which failed
deserialization of the `u256` amount param on-chain (`argent/multicall-failed`,
`ENTRYPOINT_FAILED`). Fixed encoding is `[recipient, amountLow, amountHigh]` (length 3) using
starknet.js's canonical `uint256.bnToUint256` via a new `buildPublicTransferCall`
(`src/wallet/publicTransfer.ts`), with recipient validation/normalization before any RPC work and
clear UI errors. **Verified live on Sepolia**: 0.1 STRK sent from the funded deployer account
(`0x20cc…bda34d`) to a throwaway Ready wallet; `estimateFee` succeeded, tx
`0x14651534…40c0b2` confirmed (`SUCCEEDED`), recipient balance increased by exactly
100000000000000000 base, sender balance decreased by amount + fee.

---

## Private Execution (Phase 1) — 2026-09-03

#### 🔴 [BIG CHANGE] — Wallet Core private-execution primitive (`PrivateExecutor`)

**What:** a new layer `Wallet Core → STRK20 privacy → PrivateExecutor → Starknet application`.
The smallest private-execution abstraction: a `PrivateExecutionIntent` (action, token, amount,
target contract, identity, optional destination/expiry) becomes a safe `PrivateExecutionReceipt`
(tx hash + status + public identity metadata — never secrets/notes/proofs/viewing keys).

**Domain layer** `src/privacy/execution/` (types + `PrivateExecutor` interface +
`StarknetPrivateExecutor`). **Application adapter** `src/privacy/strk20/privateApplication.ts`
mirrors the proven `privateCurve` pattern: `.build({ autoSetup, autoDiscover: refresh,
autoSelectNotes })` → `.with(token).withdraw({ recipient: target, amount })` →
`.invoke(target, privacy_invoke(identity, amount))` → `.surplusTo`. **Session surface**
`WalletPrivacySession.executePrivateApplication` (serialized through the mutex) +
`getPrivateIdentity`/`listPrivateIdentities` (wallet + network scoped). **Runtime surface**
`WalletRuntime.executePrivate(intent)` with the `(walletId, network, generation)` guard, an
`executionOp` lifecycle (`preparing → proving → submitted → pending → success/reverted/rejected/
failed`), and safe activity metadata. **UI:** a minimal `/wallet` "Private execute" panel
(`WalletCorePrivateExecute`). **Acceptance helper:** a tiny `PrivateExecutionProbe` Cairo
contract (`contracts/src/private_execution_probe.cairo`) implementing `privacy_invoke(identity,
amount)` that records executions and receives the private spend.

**Boundaries preserved:** Wallet Core = custody (unchanged); STRK20 = privacy (viewing key stays
in the session; the SDK's stateless/full-refresh model, 10-block proving margin, mutex, cache
isolation unchanged); PrivateExecutor = application execution; NEAR = future routing layer (not
built). No second wallet/signer, no viewing key in React, no public fallback path, no arbitrary
public builder escape hatch. The shadow account is an execution identity derived from the user's
Wallet Core authority — `Master Wallet → PrivateIdentity (SDK shadow commitment) → Private App
Execution`; the app sees only the public commitment, never the master wallet.

**Verification:** `npm run typecheck` clean; `npm test` 38 files / 510 tests (18 new
behavior-first private-execution tests: intent validation, unlocked/session/stale guards, SDK
path with the shadow commitment, wallet/network-scoped identity, success/revert/failure
lifecycle, serialization, no-secret exposure); `npm run build` succeeds.

**Live acceptance (honest):** the `PrivateExecutionProbe` was **deployed and verified on Sepolia**
(`0x7874ab24a8f46969e124f6fe388ae36f8ce6c05b13a2c46ba1a9adcc6e90e84`, deploy tx
`0x9a07c9d36851335b5ce9e766053cbb27824e222bdd4f9ddfd7ac53d2ad93c7`, SUCCEEDED). A fresh funded
Wallet Core wallet reached 10-block proving maturity and its **real STRK20 register tx
SUCCEEDED on-chain** (`0x40bd11e5658689fcb4688cf5ef2b639876c6776530e7986d6a415beeab8e5a0`,
ACCEPTED_ON_L2). The shield and private-execution tx were blocked before submission by the
**operator discovery indexer** — the official `discovery-service:PRIVACY-0.14.3-RC.2` image's
indexer cannot process current Sepolia new-head WS events (its bundled starknet-rust parser drops
the block-header subscription events, so it never tracks an indexed head → SDK discovery calls
return `503 "No indexed head available yet"`). The repo's operator infra uses a custom patched
discovery image (built on the operator EC2, not in this repo) for exactly this reason, and the
public `discovery.orrange.xyz` is unreachable from this environment. No live execution success
was claimed (the execution tx did not actually succeed).

**Remaining limitations:** Phase 1 supports only `application.invoke` against a
`privacy_invoke(identity, amount)` contract; the RC5 `shadowAccounts()` anonymizer path is
documented but not wired (anonymizer not configured); the live gate requires a working discovery
indexer. NEAR Intents / TEE / cross-chain are NOT started.
---

Authoritative docs: `docs/WALLET_CORE.md` (architecture), `docs/STRK20_COMPATIBILITY_MATRIX.md`
(SDK/operator compatibility), `docs/STRK20_LIVE_ACCEPTANCE.md` (live procedure),
`docs/PRIVATE_EXECUTION.md` (Phase 1 private execution), `docs/archive/` (historical
perps/privy/planning records).

---

## REAL STRK20 Shadow Accounts (Phase 2) — 2026-09-04

#### 🔴 [BIG CHANGE] — Real RC5 `shadowAccounts()` execution replaces the `privacy_invoke` prototype

**What:** the Phase 1 private-execution prototype (`privacy_invoke(identity, amount)` on the
target) is **replaced** by REAL STRK20 shadow-account execution using the vendored SDK's RC5
`shadowAccounts(appName)` primitive. The full chain is now:

```
MASTER WALLET (Wallet Core authority, signs the proof invocation)
  → STRK20 private balance (mature shielded notes)
  → shadowAccounts(appName).commitment(nonce)   (deterministic shadow identity)
  → shadow address (counterfactual: calculateContractAddressFromHash(commitment, PRIMER, [], anonymizer))
  → private STRK withdrawn to the shadow address
  → shadow.invoke(nonce, { calls })             (the SHADOW ACCOUNT calls the application)
  → AVNU private paymaster relays the proof     (outer tx sender ≠ root wallet)
  → Starknet application sees the SHADOW ACCOUNT as caller (never the root wallet)
```

**Architecture changes:**
- `src/privacy/strk20/shadowAccount.ts` (new): shadow-address derivation, mature-note selection,
  and the shadow-invoke builder (`shadowAccounts(appName)` → `commitment(nonce)` → withdraw to
  shadow → `invoke` → paymaster relay). Removes the dead `privateApplication.ts`.
- `src/privacy/strk20/paymaster.ts` (new): AVNU private-paymaster protocol client
  (`default` mode, credential-free; `sponsored_private` with a server-only key).
- `Strk20Adapter`: passes `shadowAccountAnonymizerAddress` to `createPrivateTransfers`; exposes
  `shadowAccounts` on the builder; adds `buildAndProve` (prove without root submission) + public
  `getSafeProvingBlock`.
- `WalletPrivacySession`: `executeShadowApplication` (serialized) + shadow-identity resolution by
  (appName, nonce).
- `PrivateIdentity`: upgraded to the real shadow model (`appName`, `nonce`, `commitment`,
  `shadowAddress`); records are wallet + network scoped; a new nonce = a fresh shadow identity.
- `WalletRuntime`: `createShadowIdentity(appName, nonce)` + `executePrivate` (shadow path);
  `executionOp` shows the shadow address + identity.
- `WalletCorePrivateExecute` UI: appName + nonce + target application for the shadow call.
- `ShadowExecutionProbe` (new acceptance contract): the shadow account calls `record(amount)`;
  the probe stores the shadow caller + amount.

**Operator fix (the Phase 1 discovery blocker):** the repo was pointed at the dead
`discovery.orrange.xyz`. The working Sepolia operator is
`https://discovery-service.alpha-sepolia.sw-dev.io` (reachable + healthy). This is what unblocked
the live path.

**Live acceptance (VERIFIED, real on-chain):**
- Fresh Wallet Core wallet funded + deployed + proving maturity.
- Shield (first shield auto-registers + auto-setups in ONE proof) → 30 STRK private balance.
  (A separate `register()` before `shield()` was found to hit the pool's `NON_ZERO_VALUE`
  WriteOnce collision because the discovery indexer reports a freshly-opened channel as
  "precomputed", so the SDK re-opens it. The acceptance therefore lets the first shield
  auto-register — verified working.)
- **Shadow execution tx `0x4b05bbd17f2648d9adea2a443c5179520c5eb372199e678462394e8c0e3f1b7`** —
  `SUCCEEDED` / `ACCEPTED_ON_L2`, block `14507476`.
- Verified on-chain: the `ShadowExecutionProbe` recorded the SHADOW ADDRESS
  (`0x2201cdc500333ac6517c6b44f955ce21c749a0faf74aa07ea6f7cc6ee0b668f`) as caller (NOT the root),
  the recorded amount is `0.2 STRK`, the outer tx sender `0x4ab1f891…` differs from the root, and
  the shadow address runs the pinned shadow-account class
  `0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c`.
- **PRIVATE STRK → REAL SHADOW ACCOUNT → REAL STARKNET APPLICATION CALL — verified live.**

**Verification:** `npm run typecheck` clean; `npm test` 39 files / 495 passed + 2 live gates;
`npm run build` succeeds; `scarb build` (contracts) succeeds. 20 behavior-first shadow-execution
tests + upgraded identity tests.

**Remaining limitations:** only `shadow.invoke` against a validated call; the acceptance target
is the tiny `ShadowExecutionProbe`; the paymaster `default` mode charges a relay fee (~17 STRK on
Sepolia) from the private balance; `sponsored_private` mode (server key) is client-ready but not
wired; NEAR / TEE / cross-chain are NOT started.
