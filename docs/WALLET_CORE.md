# Wallet Core — Stage 1 (Own Wallet Infrastructure)

Status: **STAGE 1 — Wallet Core foundation (implemented) · STAGE 2 — Import + Private Identity (implemented)**

This document is the source of truth for the pivot: **a self-custodial Starknet wallet whose
native privacy layer is STRK20** — no longer "a Privy app that uses STRK20."

---

## 1. Where we were

The previous architecture treated Privy embedded wallets as the wallet and STRK20 as a feature on
top. Every on-chain action (deploy, shield, send, trade) was signed by a server-side Privy
`raw_sign` through `/api/privy/sign`. That diverges from the RFP, which expects a real
self-custodial wallet (role: Ready/Braavos).

## 2. Target architecture

```
UI (own-wallet)
   ↓
Wallet Core  (src/wallet)
   ├── crypto.ts        key generation + deterministic STARK derivation
   ├── keystore.ts      password-encrypted keystore (AES-GCM + PBKDF2)
   ├── account/         AccountAdapter seam → ReadyAccountAdapter (Ready v0.4.0)
   ├── storage.ts       PUBLIC vs PRIVATE state separation
   └── walletCore.ts    create / unlock / deploy / sign / send / export / clear

UI → STRK20 Privacy Core → Wallet Core signer
```

Dependency direction is enforced and tested:

```
UI
  ↓
Wallet Core
  ↓
Account / Signer
```

NOT `Wallet Core → STRK20`, NOT `Wallet Core → Privy`. The `src/wallet` module graph imports no
Privy, no external-wallet code, and no Wallet API code (guarded by test 12).

## 3. What Wallet Core owns

| Concern | Implementation |
|---|---|
| Key generation | `generateSecretKey()` — STARK-curve CSPRNG, canonical range `[1, n/2]` |
| Key storage | `encryptSecret()` — PBKDF2 (SHA-256, 250k) → AES-256-GCM; only the encrypted keystore is persisted |
| Account creation | `createWallet()` — derive pubkey + counterfactual Ready address, persist public state + keystore |
| Account deployment | `deployAccount()` — real `DEPLOY_ACCOUNT`, salt = publicKey, waits ~10 blocks finality |
| Account loading | `unlockWallet()` — decrypt keystore, reconstruct signer + account, verify address/pubkey relation |
| Transaction signing | local `Signer(secret)` — `signTransaction` / `sendTransaction`; no server |
| Recovery / export | `exportSecret()` — re-guards with the password, caller owns display |
| Account state | `storage.ts` PUBLIC record (address, pubkey, network, deployment status, account type) |

## 4. Key management

- Secret is generated locally, held ONLY in memory on an `UnlockedWallet`.
- Persisted ONLY as `ciphertext` in the keystore (AES-256-GCM, PBKDF2-derived key from the user
  password, random 16-byte salt + 12-byte IV).
- Decrypted only during an unlocked session. `lockWallet()` blanks the in-memory secret.
- Never logged, never serialized, never sent to an API route.

## 5. Storage model (never mixed)

- **PUBLIC**: `orrange_wallet_public_<network>` — address, public key, network, deployment
  status, account type.
- **PRIVATE**: `orrange_wallet_keystore_<network>` — the encrypted keystore (only secret-bearing
  artifact).
- **PRIVACY**: STRK20 viewing keys / notes / balances — owned by the STRK20 privacy layer, NOT
  touched by Wallet Core.

## 6. Account contract strategy

Wallet Core talks to accounts only through the `AccountAdapter` seam (`src/wallet/account/types.ts`):

```
Wallet Core → AccountAdapter → ReadyAccountAdapter   (now)
                             → BraavosAccountAdapter  (Stage 2+)
```

The Ready (Argent v0.4.0) implementation was moved from the legacy Privy lane into
`src/wallet/account/ready.ts`. The legacy `src/privacy/privy/ready.ts` is now a backward-compatible
re-export so existing legacy consumers and tests keep resolving.

## 7. Signing — how it works without Privy

- `new Signer(secret)` (starknet.js) is the wallet signer. It computes transaction/typed-data
  hashes locally and signs with the STARK curve — the same primitive the old
  `StarknetPrivySigner` delegated to Privy. Nothing here calls `/api/privy/sign`.
- `Account` is built with `{ provider, address, signer, cairoVersion: "1" }`, reusing the
  `StarknetAccountAdapter` shape but with a local signer.

Architectural test that passes: create, load, sign, deploy, and submit all run without importing
Privy (test 12 scans the `src/wallet` module graph).

## 8. What is legacy (isolated, not deleted)

Kept in place but outside the Wallet Core boundary:

- `src/privacy/privy/*` — Privy embedded signing, signing client, viewing-key store, adapter.
- `src/context/PrivyWalletContext.tsx` — legacy Privy context (app still works for Privy flows).
- `src/hooks/useStarknetWallet.ts` — external Ready Wallet API consumer (LANE A).
- `src/services/strk20WalletApiService.ts`, `privacyService.ts`, `swapService.ts`, `launch*`,
  `treasuryService.ts` — legacy lanes.
- `src/ai/*`, `src/extended/*`, launchpad, perps, compliance — experimental features untouched.
- `src/privacy/adapter/PrivyStrk20Adapter.ts` — REUSABLE: consumes any wallet signer via the
  STRK20 SDK; stays for the privacy layer.

These remain functional for the existing app; they are just not the custody foundation anymore.

## 9. STRK20 is not removed

STRK20 stays a native module beside Wallet Core. The STRK20 privacy layer consumes
`UnlockedWallet.account` / `.signer` as a plain signing interface. Nothing in this refactor
changes STRK20 flows.

## 10. Tests

`src/__tests__/walletCore.test.ts` — 46 tests covering all 12 required areas plus the Stage 1
audit regression fixes (lock invalidation, network-aware account config, tri-state deployment
probe, wrong-class-hash rejection, malformed-keystore rejection, exact amount parsing). Full
suite: `npm test` (500 tests), `npm run typecheck`, and `npm run build` all pass.

## 10a. Stage 1 audit fixes (72b77bb follow-up)

- **P0 lockWallet** — `lockWallet()` now revokes the active signing session: it swaps in a
  `LockedSigner` (overrides `signRaw`/`getPubKey` to throw) for both `wallet.signer` and
  `account.signer`, and blanks the in-memory secret. Regression-tested (sign → lock → sign fails).
- **P0 network-aware account config** — `READY_ACCOUNT_CONFIG` maps each `WalletNetworkId` to a
  verified class hash. Mainnet is `supported: false` (not verified), so `createWallet` /
  `unlockWallet` fail closed on Mainnet and `/own-wallet` disables the Mainnet toggle. A
  network-agnostic class-hash default is never used by the core.
- **P1 deployment probe** — `probeAccountDeployment()` returns `deployed | not_deployed |
  unknown`. RPC failures and wrong-class-hash mismatches map to `unknown`, which the core treats
  as "refuse to deploy" (never authorizes a deployment on a failed read). Class hash is verified,
  not just any non-zero hash.
- **P1 finality state** — `deployAccount()` never writes `deployed` unless finality is reached OR
  a post-timeout chain re-probe verifies the class hash; otherwise it stays `finalizing`/`unknown`.
- **P1 keystore hardening** — `deserializeKeystore()` validates version, KDF/cipher names,
  bounded PBKDF2 iterations, exact salt/IV lengths, ciphertext presence, public key, address,
  network, account type, and timestamp — all before any PBKDF2 work.
- **P1 exact amount parsing** — `parseAmountToBase()` converts decimal strings to base units with
  integer-only math (no `Number * 10**decimals`), rejecting over-precision and negatives.
- **P2 export UX** — `/own-wallet` export is a confirm-gated, warning-based flow with a dedicated
  reveal panel; the raw secret is never dumped into the generic notice banner.

## 11. Remaining Stage 1 security gaps (documented, not faked)

- **Password-derived keystore only** — there is no hardware/enclave storage yet (secure enclave /
  mobile keystore is a future hardening layer; we do not pretend it is solved).
- **PBKDF2 in-browser** — 250k iterations is reasonable for a browser but weaker than a
  dedicated KDF on native; iterations should be increased or moved to a KDF that is slow in
  hardware (e.g. Argon2id via WASM) when available.
- **localStorage** — keystore + public state live in localStorage (no IndexedDB/OPFS, no
  session-scoped isolation). On a compromised device, an attacker with the password could
  decrypt the keystore.
- **No seed phrase / mnemonic recovery yet** — recovery is "export the raw secret"; a BIP-39
  mnemonic + key-derivation path is a Stage 2 hardening item.
- **No key rotation / account migration** — exporting and re-creating is the only path today.
- **No signing policy/allowlist UI** — the Stage 1 send flow signs whatever the user submits;
  a clear transaction-review boundary is needed before real funds are managed.
- **No TEE / enclave execution** — TEE-based execution is a later stage by design.

## 13. Stage 2 — Existing-wallet import + private identity

Status: **implemented.** Goal: let existing Starknet users bring their Ready/Braavos account into
our wallet without changing their address, while gaining STRK20 privacy.

### 13a. Account adapters

- `src/wallet/account/types.ts` — `AccountAdapter` extended with `addressDerivable` and
  `verifyOwnership(account, provider)`.
- `src/wallet/account/ready.ts` — Ready adapter gains `verifyOwnership` (counterfactual
  derivation when undeployed; SRC-5 when deployed). Address is derivable.
- `src/wallet/account/braavos.ts` — **NEW** `BraavosAccountAdapter`. Import-only: address is NOT
  derivable (Braavos init params are not recoverable from a key), so import requires the existing
  address. Class hashes were **verified declared on Starknet Sepolia** (queried live); Mainnet is
  `supported: false`. Ownership is proven via `get_multisig_threshold` (multisig fails closed),
  `get_public_key`, with SRC-5 `is_valid_signature` fallback. `deploy()` rejects — you never
  deploy an imported Braavos account.
- `src/wallet/ownership.ts` — generic SRC-5 ownership verification (`verifyAccountOwnership`
  via starknet.js `verifyMessageInStarknet`).

### 13b. Import flow

`walletCore.importWallet()`:
1. validate + canonicalize the raw secret (never persisted/sent/logged);
2. derive the public key; build the account adapter for the selected type;
3. Ready: derive the expected address; a user-provided address must match (reject otherwise);
   Braavos: the user's existing address is required;
4. probe deployment (Ready: `deployed`/`new-counterfactual`; Braavos must already be deployed);
5. **verify ownership on-chain — MANDATORY.** There is no `verify: false` and no other way to
   disable verification; the public `ImportWalletOptions` has no bypass option. A verification
   failure rejects the import before anything is persisted (compile-time + runtime guards);
6. encrypt into the standard Wallet Core keystore (AES-GCM + PBKDF2) and persist;
7. discard temporary input.

### 13c. Storage / multi-wallet — AUTHORITY MODEL

**The v2 registry + network-scoped keystore is the authoritative Stage 2 wallet store:**

```text
                 V2 AUTHORITATIVE
                       │
        ┌──────────────┴──────────────┐
        │                             │
 registry(network)             keystore(network, walletId)
        │
        └──────── exact wallet ───────┘

LEGACY
  ↓
compatibility / migration only
  ↓
never allowed to silently overwrite V2
```

- `orrange_wallet_v2_registry_<network>` entries + **network-scoped** keystores
  `orrange_wallet_v2_keystore_<network>_<walletId>`. The NETWORK is encoded in the keystore key
  itself, so the same account address on two networks (e.g. Sepolia vs Mainnet) NEVER shares a
  keystore — `scopedWalletIdFor(network, walletId) = "${network}:${walletId}"` is the canonical
  storage identity.
- **Legacy Stage 1 keys are compatibility-only.** `create`/`import` bootstrap them ONCE (when no
  legacy primary exists) so the first wallet keeps the legacy path working; ordinary create/import
  of additional wallets NEVER rotates the legacy primary.
- `unlockWallet({ network, walletId, password })` loads the EXACT requested wallet from v2. The
  `unlockWallet({ network, password })` no-walletId path is a COMPATIBILITY-ONLY path (reads the
  legacy primary); new application code must pass `walletId`.
- `clearWalletById(network, walletId)` deletes from v2 AND clears the legacy mirror when the
  deleted wallet IS the legacy primary — a deleted wallet never leaves a misleading active copy.
  Deleting one wallet never mutates another; deleting a nonexistent wallet is a safe no-op.
- Legacy Stage 1 keys are migrated into the registry on first use (`migrateLegacyWallet`); the
  migrated legacy primary is not silently replaced by later creates/imports.

### 13d. Private identity

`src/privacy/identity/PrivateIdentity.ts` — a wallet-level `PrivateIdentity` primitive:
`{ id, owner, purpose, chain, partialCommitment, commitmentNonce0, status }`. Commitments are the
REAL vendored STRK20 SDK shadow-account commitments (`ShadowAccountsBuilder.partialCommitment` /
`commitment(nonce)`), computed locally. The viewing key is accepted transiently and **never
persisted or logged**; only public commitments are stored. Identities dedupe by (owner, purpose)
and can be retired.

**Explicit, persistent storage:** `createPrivateIdentity(input, storage)` requires an explicit
storage argument — wallet identity state is never silently defaulted to ephemeral memory. The
normal application path is `createBrowserPrivateIdentityStorage()` (localStorage-backed), so an
identity created with it survives reloads/re-opens; `createMemoryPrivateIdentityStorage()` is the
explicit ephemeral option for tests. Records are validated on read: malformed or tampered records
(e.g. a stray `viewingKey`/secret field, or an `id` inconsistent with `owner`+`purpose`) are
dropped, never surfaced.

**Naming — `id` vs STRK20 shadow commitment:** `id` is the public application-level identity
identifier (`poseidon(owner, purpose)`) and is NOT a cryptographic anonymity primitive.
`partialCommitment`/`commitmentNonce0` are the actual STRK20 privacy primitives derived by the
SDK from owner + viewing key + anonymizer + dapp name. `purpose` is metadata/namespacing for this
app; it is not automatically a cryptographic shadow-account domain unless the SDK inputs
(`dappName`) make it so. This stage does NOT claim identities are anonymous or unlinkable.

**Dedupe semantics (explicit):** there is at most one record per `(owner, purpose)` — re-creating
with the same `(owner, purpose)` REPLACES the record (including a retired one), and the
commitment fields always correspond to the most recently created record. Records are validated on
read: malformed/tampered records are dropped, and a record is only surfaced under its OWN
namespace — `record.owner` must equal the queried owner and `record.chain` must equal the queried
chain (the storage key alone is never trusted).

Key hierarchy (never conflated):
`MASTER WALLET KEY → controls Starknet account` · `STRK20 VIEWING KEY → discovers private notes` ·
`PRIVATE EXECUTION ID → isolates one privacy context`.

### 13e. STRK20 integration

`src/privacy/identity/strk20User.ts` — `buildStrk20User(wallet, viewingKey)` produces the
STRK20 adapter's user from an imported wallet's account/signer:
`Imported Wallet → Wallet Core signer → STRK20 adapter`, never through Privy.

### 13f. Stage 2 verification

`npm run typecheck` clean; `npm test` → 57 files / 563 tests; `npm run build` succeeds.
Includes real Starknet Sepolia integration tests (skip when the public RPC is unreachable):
Braavos classes declared, Ready counterfactual probing, and SRC-5 ownership rejection against a
real deployed account with a throwaway key.

### 13g. Remaining Stage 2 security gaps (documented, not faked)

- Braavos ownership verification requires RPC availability at import time (it is on-chain).
- Braavos accounts self-upgrade (`replace_class_syscall`); `probeDeployment` reports any nonzero
  class hash as deployed — the real assurance is `get_public_key` / SRC-5 ownership.
- Braavos multisig (threshold > 1) imports fail closed (a single imported key cannot sign alone).
- The STRK20 viewing key for Wallet Core accounts still comes from the legacy Privy lane's
  derivation; a Wallet Core-native viewing-key derivation is deferred to a later stage.
- PrivateIdentity commitments are derivable without an anonymizer wired, but shadow execution is
  NOT available until the anonymizer + operator infra is configured (Stage 3+).

## 14. Stage 2.5 — Wire Wallet Core into the primary Orrange runtime

Status: **implemented.** The actual Orrange product now runs on Wallet Core; legacy Privy /
external-wallet runtimes are compatibility-only.

### 14a. New runtime

- `src/wallet/runtime.ts` — `WalletRuntime`, the framework-agnostic application runtime (headless
  testable). Owns network, wallet registry, selected walletId, unlocked session (in-memory only),
  create/import/unlock/lock/delete, deployment status, public balances (RPC), and `send()`
  (Wallet Core local signer). No Privy, no legacy Wallet API connect path; unlocks always use
  `unlockWallet({ network, walletId, password })`.
- `src/context/WalletRuntimeContext.tsx` — React provider + `useWalletRuntime()`. Lazy-init via a
  client effect so server/prerender output is deterministic (no hydration mismatch). A page
  reload returns to "wallet exists → locked" (no persisted session).

### 14b. Primary entry

- `/wallet` uses the runtime: no wallet → **Create wallet / Import existing wallet** (Ready /
  Braavos, ownership verified); stored wallets → select + unlock by exact walletId; unlocked →
  account/network/deployment/public balances + public receive + local-signed send.
- `/send` uses the runtime for public STRK sends (`WalletCoreSend`, exact `parseAmountToBase`,
  local signing). STRK20 private transfers remain the LEGACY lane, rendered only when a
  legacy-compatible wallet is connected; otherwise an explicit compatibility note.
- `AppShell` header shows the Wallet Core session (or links to `/wallet`); the legacy
  ConnectWalletModal is kept only for legacy pages (settings / legacy SendForm).

### 14c. Legacy quarantine

`useStarknetWallet`, `PrivyWalletContext`, `ConnectWalletModal`, `ConnectGate`, and the Wallet API
connect flow are marked LEGACY / compatibility-only. They remain for legacy pages and legacy
STRK20 flows, but the new `/wallet` runtime does not depend on them. A logged-in Privy session
never becomes the Orrange wallet. Architectural guard tests assert the runtime source imports no
Privy / legacy Wallet API connection code.

### 14d. STRK20 without Privy

`buildStrk20User(wallet, viewingKey)` (`src/privacy/identity/strk20User.ts`) already bridges a
Wallet Core account/signer to the STRK20 adapter. Public balances flow via RPC (`privacyService`,
Privy-free). Private STRK20 (viewing keys, proofs) still requires the legacy Ready/Wallet API lane
until a Wallet Core-native viewing-key derivation lands (later stage).

### 14e. Runtime hardening (final polish)

- **Safe UI-facing state.** `WalletRuntime.getState()` returns a SAFE view
  (`network, wallets, selectedWalletId, account { walletId, address, accountType, publicKey },
  isUnlocked, deploymentStatus, publicBalances, recentTransactions, error`). The raw
  `UnlockedWallet` (secret, signer, account) is held in a private field and never enters React
  state. A test asserts the view JSON never contains the raw private key.
- **Stale-async protection.** Every async flow (`refreshDeployment`, `refreshPublicBalances`,
  `create`, `import`, `unlock`, `send`) captures a `(walletId, network, generation)` guard and
  drops its result if the guard is stale (network/wallet switched, or locked, while awaiting).
  Regression-tested: stale deployment/balance results after wallet switch, network switch, and
  lock are ignored.
- **Consistency.** Network switch clears the session and reloads that network's registry; wallet
  switch locks the old session and requires unlock; lock clears the session and cannot be undone
  by pending async work; reload keeps wallets but never restores an unlocked session; balances and
  deployment always correspond to the active `walletId + network`.
- **`/wallet` is clean.** It imports no `WalletContext`, `PrivyWalletContext`, `useStarknetWallet`,
  `ConnectWalletModal`, `ConnectGate`, or Wallet API connect code (architectural guard test).
  Recent activity is now the runtime's in-memory, session-scoped list (no legacy WalletContext
  dependency). `/send` public sends are always Wallet Runtime → Wallet Core; legacy/Privy state
  only toggles the explicitly-labeled STRK20 private compatibility lane.

## 15. Stage 3A — STRK20 privacy native to Wallet Core

Status: **implemented.** The PRIMARY STRK20 privacy path no longer requires Privy, the Ready
extension, or the Wallet API. Legacy lanes remain only as compatibility.

### 15a. Wallet-native viewing key

- **Derivation (documented):**
  `viewingKey = canonicalize( poseidon( masterSecretScalar, starknetKeccak(domain) ) )` with
  `domain = "ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1:<network>"`.
- Input = the wallet master signing secret (the same scalar owning the account); deterministic per
  wallet so unlocking reproduces the same viewing key (privacy state recovers). Different wallets
  / wrong secrets produce different keys. Network-scoped so the same wallet never shares a privacy
  identity across networks.
- Output = a canonical scalar in `[1, floor(n/2)]` (`MAX_VIEWING_KEY`), exactly what the STRK20
  SDK/pool accept; upper-half reflection preserves the derived public identity.
- Security: derived in memory from the in-memory session secret; never persisted, never sent to
  Privy/backend, never logged, never in React state, never in `PrivateIdentity` records. Locking
  discards the privacy session (and the viewing key).

### 15b. Privacy session + adapter

- `src/wallet/privacy.ts` — `WalletPrivacySession` (bound to one unlocked wallet + network),
  holds the viewing key in memory and exposes `getPrivateBalance / shield / privateTransfer /
  withdraw / createPrivateIdentity`.
- `src/privacy/strk20/` — the NEUTRAL STRK20 adapter (`Strk20Adapter`) + allowance helpers. It
  consumes a generic `{ account, address, viewingKey }` — a Wallet Core `UnlockedWallet.account`
  + wallet-native viewing key. No Privy, no Wallet API.
- `PrivyStrk20Adapter` is now a LEGACY alias of `Strk20Adapter` (backward compatible; existing
  legacy pages/tests keep resolving). `@/privacy/privy/allowance` re-exports the neutral helpers.

### 15c. Runtime integration

`WalletRuntime` exposes a SAFE privacy capability (`privacy.available/status/reason` +
`privateBalances`) — never the viewing key. Methods `refreshPrivateBalances / shield /
privateTransfer / withdraw / createPrivateIdentity` are bound to the active
`walletId + network + generation` guard (same stale-session protections as the rest of the
runtime). If the operator proving/discovery services are not configured, privacy reports
**unavailable** — never a fake zero.

### 15d. UI

- `/wallet` shows Public + Private balances of the SAME Wallet Core account, with Shield /
  Withdraw actions. No "Connect privacy wallet" / "Continue with Google" in the primary flow.
- `/send` private STRK20 uses the Wallet Core privacy session by default; the legacy STRK20 lane
  renders only as a clearly marked compatibility fallback when privacy is unavailable AND a legacy
  wallet is connected.

### 15e. Verification

`npm run typecheck` clean; `npm test` → 60 files / 602 tests; `npm run build` succeeds. Real
Sepolia integration verifies the STRK20 pool is deployed, wallet-native viewing keys are
canonical, and privacy reports unavailable without operator services.

## 16. Stage 3A.5 polish — full wallet dashboard + STRK20 hardening

### 16a. `/wallet` dashboard (Wallet Runtime driven)

The dashboard is fully derived from `WalletRuntime` state (single source of truth — no duplicate
wallet state):

```
/wallet
  ↓
WalletRuntime (useWalletRuntime → useSyncExternalStore)
  ↓
Wallet Core (create/import/unlock/select/lock/delete/deploy/send)
  ↓
WalletPrivacySession (wallet-native viewing key, in-memory)
  ↓
Strk20Adapter → STRK20 SDK → Wallet Core local signer
```

- Unlock/UI propagation regression fixed: the context hook now subscribes via
  `useSyncExternalStore`, so every consumer re-renders when the runtime emits. The old
  "provider forceUpdate" froze `{children}` (stable element reference), so the page stayed on the
  gate even after a successful unlock.
- Dashboard shows: account address + type + network, deployment lifecycle badge
  (`Ready` / `Deployment pending` / `Deploying…` / `Confirming…` / `Deployment failed` / `Unknown`),
  Public + Private balances, STRK20 privacy status (available/registered/unavailable+reason),
  public send, shield / private send / withdraw (Wallet Core signer), activity, wallet selector,
  Lock, Delete.
- First-use flow: `Create wallet → Deploy account → Ready`; `Deploy` runs the Wallet Core
  deployment state machine (fail-closed — RPC error/class-hash mismatch → `unknown`, finality
  timeout → reconcile before ever claiming `deployed`).

### 16b. STRK20 privacy lifecycle (honest)

- Operator not configured → privacy **unavailable** with a reason (never a fake zero balance).
- Operator configured → registration probed via the discovery service; shows `ready`,
  `not registered yet (first shield auto-registers)`, or an **error + reason** when discovery is
  unreachable. All discovery calls are time-bounded so a hung service surfaces an honest error
  instead of spinning forever.
- Private balances come from `WalletPrivacySession → wallet-native viewing key → STRK20
  discovery`. The discovery snapshot block is exposed (`asOfBlock`) and balances whose snapshot
  lags the chain head are reported **syncing** (with the balance still visible) instead of a
  silent stale 0. Stale results are dropped by the `(walletId, network, generation)` guard on
  lock / wallet switch / network reload.
- Proving-chain maturity is honest: after a deployment, the deployment state machine already waits
  for 10-block finality; `privacy.maturity` is `ready` after a successful deploy, `waiting` if the
  head ever reads below the ready block (never a generic "privacy failed"), and `unknown` when the
  deploy block is not known this session (imported/existing accounts).
- Privacy operations expose an honest lifecycle in `state.privacyOp`:
  `preparing → approving → proving → submitted → pending → success/reverted/rejected/failed`.
  Success is never reported before on-chain reconciliation confirms it. `register()` is exposed as
  a first-class, serialized operation.

### 16c. STRK20 hardening applied

- **Viewing key is internal**: `WalletPrivacySession` has NO public `getViewingKey()` API; the
  adapter receives it via an internal provider closure. Runtime/UI state never contains it.
- **Operations serialized**: mutating privacy ops (`register / shield / privateTransfer /
  withdraw`) run behind a single async mutex per session — two ops can never race on a cached
  private-transfers context or the pool nonce, and a failing op never wedges the queue.
- **Production logging sanitized**: the STRK20 adapter + allowance helpers use a
  dev-only logger (no-op under `NODE_ENV === "production"`); wallet addresses, prover/discovery
  URLs, amounts, calldata, proofs, notes, viewing keys and private balances are never logged.
  Stale "Privy account" nomenclature removed from neutral helpers (they are wallet-generic).
- **Cache-context safety**: the private-transfers cache key includes `chainId | pool |
  prover | discovery | feeToken | address`, so a cached context can never be reused across
  incompatible networks/pools/configurations.
- **Fee/resource fallback bounded**: real fee estimation is preferred; the gas-price fallback
  (2x headroom, capped amounts) is only used when the node rejects the STRK20 PROOF0 proof
  version, and insufficient-resource failures are never silently swallowed. The capped amounts are
  documented as **deployment-specific** (current Sepolia deployment), not universal Starknet
  defaults.
- **Private-trade separation**: the launchpad BondingCurve/PrivateCurveExecutor logic is extracted
  out of the generic `Strk20Adapter` into `src/privacy/strk20/privateCurve.ts`
  (`privateCurveTrade(adapter, user, params)`), which composes on the adapter's generic
  `executeBuilder`. The generic adapter no longer owns application-specific actions.

### 16d. Vendored SDK revision & discovery privacy

- **Vendored STRK20 SDK**: `@starkware-libs/starknet-privacy-sdk` **`0.14.3-rc.5`**, vendored at
  `vendor/starknet-privacy-sdk` (build of `github.com/starkware-libs/starknet-privacy`, `sdk/` @
  tag `PRIVACY-0.14.3-RC.5`, Apache-2.0). This is the ONLY SDK surface the adapter targets; code
  must not assume APIs from a newer SDK revision unless that revision is actually vendored.
  Tests pin this revision and assert the app only imports SDK APIs that exist in it.
- **Discovery transport**: by default the indexer discovery provider goes **direct HTTPS** to
  `NEXT_PUBLIC_STRK20_DISCOVERY_URL`. The vendored SDK DOES support OHTTP for discovery at the
  provider-class level (`IndexerDiscoveryProvider` constructor accepts `{ ohttp }`), but the
  factory's `DiscoveryProviderConfig` shorthand does not expose it. The adapter exposes a
  `discoveryOhttp` config seam that constructs the SDK's `IndexerDiscoveryProvider` instance
  directly with OHTTP — **disabled by default** until the operator's discovery/relay
  infrastructure supports it. No custom OHTTP protocol is invented.
- **What the discovery service can observe today (direct HTTPS)**: the operator that runs the
  discovery endpoint can see the requesting wallet's IP, its address, and the viewing-key-scoped
  queries it makes (note/channel sync, registration preflight). The viewing key itself is only
  ever held client-side and sent inside the request payloads the operator serves, so an honest
  (but non-OHTTP) operator can associate a wallet address with its private-note queries. Enabling
  `discoveryOhttp` (and the future relay requirement) is gated on operator support.
- **PrivateIdentity semantics (honest)**: `PrivateIdentity.id` is an application-level namespace
  (`poseidon(owner, purpose)`); it is NOT an anonymity primitive. The actual STRK20 privacy
  primitives are the shadow-account commitments (`partialCommitment` / `commitmentNonce0`).
  PrivateIdentity alone provides no anonymity/unlinkability guarantee.

### 16e. Live acceptance

See `docs/STRK20_LIVE_ACCEPTANCE.md` for the funded, real-environment acceptance procedure
(register → shield → private balance discovery → private transfer → withdraw). The automated
live test skips honestly when the RPC, operator services, or a funded wallet are unavailable and
never fakes success.

## 16f. Consolidation: ONE wallet runtime (Privy removed)

Orrange is now a **single-wallet-runtime product**. The one and only wallet source of truth is:

```
Orrange UI
  ↓
WalletRuntime (useWalletRuntime → useSyncExternalStore)
  ↓
Wallet Core (create/import/unlock/select/lock/delete/deploy/send)
  ↓
Ready / Braavos (Wallet Core account adapters)
  ↓
Starknet
  ↓
WalletPrivacySession → Strk20Adapter → STRK20 SDK (privacy)
```

- Privy (embedded wallets, `@privy-io/*`, `PrivyAuthProvider`, `PrivyWalletContext`,
  `PrivyStrk20Adapter`, `/api/privy/*`, Wallet API services) is **fully removed** — not
  commented, not legacy-gated. No email/Google login is required to create/use the wallet.
- The legacy external-wallet stack (`WalletContext`, `useStarknetWallet`, `ConnectWalletModal`,
  `ConnectGate`, legacy Ready Wallet-API lane) is removed. Settings, activity, receive, swap,
  send and the treasury derive exclusively from `WalletRuntime.getState().account`.
- Launchpad and extended/perps trading are explicitly gated ("being migrated to Wallet Core")
  rather than exposing a second wallet identity.
- Activity is bound to `walletId + network + transactionHash` and cleared on lock/wallet switch/
  network reload; no legacy wallet activity is substituted.
- There is no server-side wallet session; the AI analyze route accepts client-claimed Wallet
  Core addresses and the execution gate re-checks current state + requires the user's signature.

## 16g. AI / server trust model (analysis ≠ authorization ≠ execution)

- `/api/ai/analyze` accepts client-claimed `userAddress` / `privateTreasuryAddress` for **advisory
  analysis only** (`verification: 'client-claimed'`). It is never treated as authenticated
  identity.
- Execution is gated by the **ExecutionRouter** (`src/ai/execution.ts`), which re-checks fresh
  state (balances unchanged), fresh prices, guardrail-snapshot integrity, re-runs the
  deterministic policy, AND enforces a hard **destination-authorization** gate: the recipient must
  be the authoritative Wallet Core session account (`WalletRuntime.getState().account`) or an
  explicit server-configured destination (`AI_ALLOWED_DESTINATIONS`, returned by the API as
  `serverAllowedDestinations`). A client-claimed address can never authorize a transfer to it —
  rejected with `UNAUTHORIZED_DESTINATION` before any signature is produced.
- Every value-movement operation is signed ONLY by the Wallet Core local signer
  (`WalletRuntime.send` / `WalletRuntime.privateTransfer`).

## 17. Stage 3B+ boundaries (do NOT touch yet)

- NEAR Intents, cross-chain private trading, Solana/Base execution
- TEE infrastructure · solver infrastructure · cross-chain shadow execution
- Seed-phrase mnemonic + key derivation
- Expanding the Stage 3A UI into a dashboard
- New privacy contracts