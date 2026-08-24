# PRIVY × STRK20 — REPOSITORY AUDIT (commit 1a517e0)

Scope: Privy Starknet embedded wallet → STRK20 compatibility → Umbra-style private wallet UX.
Perps code is out of scope and was not analyzed.

Legend: **CONFIRMED** = proven by code/live call. **INFERRED** = follows from code + docs but not
live-verified. **UNVERIFIED** = requires real operator/testnet. **BROKEN** = proven incorrect/gap.

---

## 1. PRIVY → STARKNET SIGNING

### 1.1 Wallet type created (Q1)
`/api/privy/wallet` (src/app/api/privy/wallet/route.ts:52) calls
`privy.walletApi.createWallet({ chainType: "starknet" })` with **no owner** → a **SERVER-MANAGED**
Starknet wallet. CONFIRMED. Consequences: signing uses app-secret Basic auth; the wallet is NOT
bound to the Privy user in Privy's model (PEL binds it via `customMetadata.starknetWalletId`,
route.ts:54). This is a custodial-equivalent design (the app secret can sign every wallet).

### 1.2 Starknet public key (Q2)
The wallet record's `public_key` (`toWallet`, route.ts:15-18). Used to derive the account address
and as the signer's `getPubKey()`. CONFIRMED.

### 1.3 Actual account contract / address (Q3)
Derived **Ready (Argent) v0.4.0** account (src/privacy/privy/ready.ts:10-12,18-37):
`address = calculateContractAddressFromHash(salt=publicKey, classHash, constructorCalldata, 0)`,
constructor `{ owner: enum Starknet { pubkey }, guardian: None }`. CONFIRMED (matches
starknet-edu/starknet-privy-demo `ready.ts` exactly; class hash verified declared on-chain via
`starknet_getClass`).

### 1.4 Privy wallet.address vs Ready account address (Q4)
**Different.** Verified live earlier: Privy `address 0x6cedf5…d53c` ≠ derived
`0x18291ad2…47f`. `resolveStarknetWallet` (PrivyWalletContext.tsx:102) correctly uses the derived
address. CONFIRMED.

### 1.5 Is the Ready account deployed/usable? (Q5)
**BROKEN — not deployed anywhere.** There is no deploy path in the Privy flow. grep for `deploy`
across src/privacy, PrivyWalletContext, SendForm, EnablePrivateReceiving finds only comments/error
copy. `Account.execute` (PrivyStrk20Adapter.ts:167) requires a deployed, funded account
(getNonce/estimateFee hit RPC). The starknet-privy-demo had an explicit `deployReadyAccount`;
this repo does not. **This is the #1 blocker for real on-chain STRK20 actions.**

### 1.6 Account class hash / version (Q6)
`READY_SEPOLIA_CLASS_HASH = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f`
(ready.ts:10-12), Ready v0.4.0 (NOT v0.5.0), Cairo 1 (`cairoVersion: "1"`, StarknetAccountAdapter.ts:30).
CONFIRMED.

### 1.7 Signature scheme (Q7)
Standard Starknet ECDSA (`ecdsa_verify`): `w=s⁻¹, u1=h·w, u2=r·w, Q=u1·G+u2·P, Q.x==r`. Confirmed by
live cryptographic verification of a Privy `raw_sign` output (verifies `true` against the wallet
pubkey). The on-chain `__validate__` verifies this for account-sender invokes; the prover verifies
it for the proof invocation (see 1.9).

### 1.8 rawSign output vs starknet.js + account contract (Q8)
`raw_sign` returns `0x` + 128 hex chars = **r‖s, 32 B each, big-endian**. Decoded by
`normalizePrivySignature` (signing.ts:19-28). CONFIRMED live. Compatible with starknet.js
`Signature` and the account's verify equation.

### 1.9 SignerInterface vs STRK20 SDK (Q9)
`StarknetPrivySigner extends Signer` (StarknetPrivySigner.ts:13) overrides only `getPubKey` +
`signRaw`; all hash computation is inherited (deterministic, key-free). The SDK's
`ProofInvocationFactory.create` (vendor …/internal/proof-invocation-factory.js:85-95) calls exactly
`user.signer.signTransaction(calls, { walletAddress: poolAddress, cairoVersion: "1", nonce:0, skipValidate:true, … })`.
The standard `Signer.signTransaction` computes the V3 hash with
`calculateInvokeTransactionHash2` (sender = **pool address**), then `signRaw`. My override signs
that exact hash via Privy. **Compatible. CONFIRMED** (matches the SDK's design: prover validates the
signature over the pool-sender hash via `is_valid_signature` against the user pubkey).

### 1.10 Subtle mistakes
- `normalizeStarkPublicKey` (signing.ts:3-10) returns bare `0x` hex (may be unpadded). Used only as
  the signer's `getPubKey` and passed to `computeReadyAccountAddress`; `calculateContractAddressFromHash`
  accepts `BigNumberish`, so unpadded is fine. **OK.**
- Proof invocation is signed with `walletAddress = poolAddress` (pool), while the on-chain `submit`
  invoke is signed with `sender = account`. Both paths flow through the same `signRaw`; both are
  standard ECDSA over a hash. **OK, but the prover MUST be the pool-sender design — do not change
  the SDK's signing details.**
- No endianness/recovery-byte handling is needed (confirmed live). **OK.**
- `getPubKey()` returns the raw wallet pubkey; starknet.js `Account` may call it. Consistent with the
  account's signer key. **OK.**

**Verdict 1: CONFIRMED compatible (signing).** The blocker is deployment (1.5), not signing.

---

## 2. STRK20 SDK INTEGRATION

- **Package:** `@starkware-libs/starknet-privacy-sdk@0.14.3-rc.5`, **vendored** at
  `vendor/starknet-privacy-sdk` (`file:` optional dependency in package.json), lazily imported via
  `import(/* webpackIgnore */ …)` (PrivyStrk20Adapter.ts:63-74). CONFIRMED.
- **Entry:** `createPrivateTransfers({ account: { address, signer }, viewingKeyProvider, provingProvider:{url,chainId}, discoveryProvider:{url}, poolContractAddress })` (PrivyStrk20Adapter.ts:90-96).
- **ProvingProvider:** factory-built `ProvingServiceProofProvider` from `{ url, chainId }`
  (config path). CONFIRMED (wired). UNVERIFIED end-to-end (no live prover).
- **DiscoveryProvider:** factory-built `IndexerDiscoveryProvider` from `{ url }`. CONFIRMED (wired). UNVERIFIED end-to-end.
- **Viewing key:** `viewingKeyProvider.getViewingKey()` returns `user.viewingKey` (the signature-derived scalar).
- **Signer:** `user.account.signer` = `StarknetPrivySigner`.

Flow traced:
1. Action (`shield`/`unshield`/`transfer`/`register`) → `build({autoDiscover:'refresh', autoSelectNotes:'naive'})` → SDK `execute` → `ProofInvocationFactory.create` → `signer.signTransaction` → Privy raw_sign → INVOKE_TXN_V3 (nonce 0, sender=pool) → prover `prove` → `{ proof, proofFacts }` → `CallAndProof` → `submit` → `account.execute(call, { tip, proofFacts, proof })` → RPC → waitForTx. CONFIRMED structurally (each function exists; submit is typed: starknet.js v10 `UniversalDetails` has `proofFacts?`/`proof?`).
2. **Failure modes:** any step can throw; surfaced as user-facing errors. `submit` returns status PENDING always; confirmation is reconciled by callers (`waitForStrk20Confirmation`).

**Issues:**
- **Registry is never persisted.** `buildAdapter()` is called fresh on every operation
  (PrivyWalletContext.tsx:200,208,216,223,231), so a new `PrivateTransfers` + empty `PrivateRegistry`
  is created per call and the SDK's returned `registry` (channels/notes/cursor) is discarded.
  `autoDiscover:'refresh'` re-indexes everything each time. Functionally OK (discovery is
  authoritative) but: (a) slow, (b) heavy on the indexer, (c) no local note cache → no offline /
  low-latency balance, (d) note-spend tracking depends entirely on the indexer's nullifier view.
  CONFIRMED.
- **`deposit` (shield) has no explicit ERC-20 approve.** `shield()` calls
  `t.deposit({ amount })` only (PrivyStrk20Adapter.ts:112-114). Whether the pool pulls tokens and
  expects prior `approve` is a pool-contract detail. The Ready-lane `strk20SdkService` also omits
  approve. **UNVERIFIED** — must be validated against the deployed Sepolia pool ABI (deposit may
  transfer_from the account; if so an `approve` call is required before deposit).

**Verdict 2: wired correctly, but UNVERIFIED end-to-end; registry/approve are gaps.**

---

## 3. PROVER / DISCOVERY / PATHFINDER (infra/strk20-operator)

| Component | Image/tag | Port (host) | Env (compose) |
|---|---|---|---|
| discovery-service | `ghcr.io/starkware-libs/starknet-privacy/discovery-service:PRIVACY-0.14.3-RC.2` | 8080 | RPC_URL, WS_URL, API_HOST |
| transaction-prover | `ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2` | 3001→3000 | RPC_URL=http://pathfinder:9545/rpc/v0_10, CHAIN_ID=SN_SEPOLIA |
| pathfinder | `eqlabs/pathfinder:v0.22.7` | 9545 (HTTP), 9546 | PATHFINDER_STORAGE_STATE_TRIES=10000, WS enabled |

App wiring: `NEXT_PUBLIC_STRK20_PROVER_URL` + `NEXT_PUBLIC_STRK20_DISCOVERY_URL` (client-bundled).

**Version incompatibility risks (all UNVERIFIED, must be validated at deploy):**
1. **SDK rc.5 vs services rc.2.** README calls this an intentional mix; wire protocols are claimed
   unchanged. Must be proven with a real shield/send on Sepolia. If the SDK (rc.5) sends a
   `starknet_proveTransaction` payload the rc.2 prover rejects, everything fails.
2. **Pathfinder v0.22.7 + `/rpc/v0_10`.** The prover points at `http://pathfinder:9545/rpc/v0_10`.
   Pathfinder v0.22.7 predates the v0.10 JSON-RPC spec; it may not expose a `v0_10` path →
   prover cannot talk to the node. **HIGH RISK.**
3. **Pathfinder WS port.** Compose maps 9545+9546 but `WS_URL` defaults to `ws://pathfinder:9545`;
   Pathfinder's WS endpoint is commonly a separate port. If WS isn't on 9545, discovery indexing
   fails. **HIGH RISK.**
4. **Pool/chain:** Sepolia pool `0x0254…e0d91`, `SN_SEPOLIA`. CONFIRMED addresses; pool
   `CONTRACT_VERSION '2.0'` is an assumption (README), UNVERIFIED.
5. **Prover image tag existence** (`transaction-prover:PRIVACY-0.14.3-RC.2`): not verified to exist
   in ghcr. If missing, `docker compose up prover` fails.
6. **Persistence:** no volumes are declared in compose for pathfinder state or indexer state →
   restarting wipes sync state; long re-sync. Recommend named volumes.
7. **Health endpoints:** discovery `/health` exists (compose healthcheck). Prover health
   (`getSpecVersion`/`isHealthy` per SDK) not wired into any compose healthcheck/readiness.
8. **Resource:** prover needs a node with `PATHFINDER_STORAGE_STATE_TRIES=10000` and significant
   RAM; 8 vCPU/32 GiB is plausible but UNVERIFIED. No retry/backoff beyond the SDK's built-in
   prover retry (default 3 attempts, 1s base) — server has no extra retries.

**Verdict 3: config is plausible but several concrete version/port assumptions are UNVERIFIED and
could be BROKEN at deploy. Validate items 1-5 before relying on it.**

---

## 4. VIEWING KEY / PRIVATE BALANCE MODEL (viewingKeyStore.ts)

- **Generation:** `loadOrCreateViewingKey` (viewingKeyStore.ts:89-104): cache hit → return; else
  `raw_sign` over `viewingKeyChallenge()` and `viewingKey = poseidon(poseidon(r,s), domain)`.
  CONFIRMED.
- **Requires Privy signing?** Yes, but server-side (`/api/privy/sign`, app-secret auth) → **no
  user-facing prompt**. Happens **once per new device** (then cached). CONFIRMED.
- **Determinism (recovery):** verified live — `raw_sign` is deterministic (RFC6979) → same hash,
  same signature → same viewing key on any device. **CONFIRMED.**
- **Where it lives:** localStorage, AES-GCM "encrypted" (viewingKeyStore.ts:69-82).
- **Encryption key:** `SHA-256("PEL_STRK20_VIEWING_KEY_V1:" + userId)`. **The userId (Privy DID) is
  public** (in the JWT, in Privy metadata). → the cache key is derivable by anyone; the "encryption"
  provides **no meaningful protection against localStorage/XSS readers**. The only real security is
  that the canonical scalar is derived from a signature only the wallet/backend can produce. This is
  effectively `security-by-obfuscation` for the cache. **WEAK — flag.**
- **Browser restart / cache clear:** re-derives via raw_sign (deterministic) → same key. Works. CONFIRMED (logic).
- **Another device:** same Privy login → same walletId (custom metadata) → same raw_sign → same
  viewing key → discovery reconstructs balances. **Should work; UNVERIFIED end-to-end.**
- **Backend never receives the viewing key:** `/api/privy/sign` only signs a hash; viewing key never
  leaves the client. CONFIRMED.
- **Private notes never leave the client:** discovery returns encrypted notes to the client; the
  client decrypts. The backend (`/api/privy/*`) never sees notes. CONFIRMED (server only proxies
  raw_sign of a hash).
- **Balances computed locally from notes:** yes — `getPrivateBalance` sums `discoverNotes`.
  CONFIRMED.

**UX goal ("one signature, then no prompts"):** Achieved — viewing-key signing is server-side and
once-per-device; balance reads (`discoverNotes`) never sign. CONFIRMED for the Privy lane.

**Verdict 4: model is sound and deterministic; the local cache encryption is nominal (fix below).**

---

## 5. DISCOVERY / AUTOMATIC BALANCE SYNCHRONIZATION

Flow: login → resolve wallet → derive viewing key → `BalanceCard` calls `getPrivateBalance`
(→ `discoverNotes` → indexer → decrypt → sum) on mount + **every 20s** (BalanceCard.tsx polling).
`SendForm` also fetches on mount/token-change.

- Shield/send → on-chain confirm → `refreshAfterMutation()` is Ready-lane only (**no-op for Privy**);
  the Privy balance updates via the 20s poll (or next mount). Not event-driven. **Stale window ≤20s
  + indexer indexing latency (could be blocks).** CONFIRMED.
- **Missing:** event-driven refresh, block cursor persistence, invalidation on confirm (except
  poll), and any "refresh after Privy mutation" hook. The SDK's returned `registry` (incl. cursor)
  is discarded (Section 2), so every poll is a full re-discovery from scratch.
- **Race:** BalanceCard's load closure reads `privy`/`currentNetwork` at effect-run time; a re-login
  mid-poll can write stale rows (cancelled flag mitigates). Minor.
- **`discoverNotes` before registration:** discovery of notes encrypted to you requires the viewing
  key registered (SetViewingKey) so senders can encrypt to you. Your own shield/send notes decrypt
  fine. Receiving before registration won't show. This is why the "Enable private payments" step
  exists. CONFIRMED (protocol behavior).

**Verdict 5: works for display, but relies entirely on polling + a remote indexer; no local cache,
no event-driven updates, no persisted cursor.**

---

## 6. UMBRA-STYLE UX AUDIT

| Stage | Rating | Notes |
|---|---|---|
| Connect/login (Google) | 🟢 | One click, no extension |
| Wallet init | 🟢 | Server-side create/derive; shows address |
| First privacy setup | 🟡→🔴 | "Enable private payments" calls `register()` which **fails until the account is funded + deployed + operator up**; honest error copy exists but the flow is a dead end without deploy |
| Balance display | 🟡 | Shows after discovery; lags ≤20s + indexer latency; "—" if operator absent |
| Shield | 🟡→🔴 | Needs deployed account + prover; no approve step (UNVERIFIED); balances update via poll |
| Private send | 🟡→🔴 | Same prerequisites; recipient must be registered (channel setup via autoSetup) |
| Receive | 🟡 | Shows derived address; "enable first" until registered |
| Confirmation | 🟡 | `submit` returns PENDING; callers reconcile; explorer links |
| Reload / reconnect | 🟢 | Cache + deterministic re-derive |
| New device | 🟡 | Should recover (deterministic) — UNVERIFIED end-to-end |
| Privacy-service-down | 🟡 | Error strings exist; no proactive operator-health UI |
| Prover latency | 🟡 | SDK default 30s timeout + retries; user sees "privacy service unavailable" |

**Verdict 6: close to the target UX once (a) account deploy, (b) operator, and (c) post-mutation
refresh are added. Not there yet.**

---

## 7. SECURITY

**CRITICAL — `/api/privy/sign` is an arbitrary-signing oracle with no wallet-ownership binding.**
(src/app/api/privy/sign/route.ts:17-56)
- It verifies only that the caller holds *a* valid Privy session (`verifyAuthToken`, route.ts:27),
  then signs **any `hash` for any `walletId`** the caller supplies, using app-secret Basic auth.
- The walletId is NOT checked against the authenticated user. Any logged-in user can request a
  signature for another user's walletId over an arbitrary hash.
- No Privy Wallet API policy restricts `raw_sign`; no rate limit; no allowlist.
- Impact: a signature oracle over a victim wallet's key. For Starknet this lets an attacker obtain
  valid `(r,s)` over attacker-chosen hashes (message-signing / potential forged signed payloads;
  a full forged tx needs the exact tx hash+nonce, but an oracle is unacceptable).
- **Fix required:** bind `walletId` to `userId` via the `customMetadata.starknetWalletId` mapping
  (reject on mismatch), add Privy raw_sign policies, add rate limiting. This is the top security fix.

Other:
- **Server-managed wallets = custodial-equivalent.** The app secret signs every wallet. Leaking
  `PRIVY_APP_SECRET` (env) compromises all wallets. Mitigate: never log it; restrict server access.
- **Viewing-key cache encryption is nominal** (Section 4) — the AES key is a hash of a public userId.
- **CSRF:** routes use `Authorization: Bearer` (no cookies) → CSRF-safe. CONFIRMED.
- **User-ID spoofing:** `setCustomMetadata(userId, …)` is called with the *verified* token's
  `userId` (route.ts:36-37,54) → safe. CONFIRMED.
- **Wallet-ID spoofing:** the sign route does not verify ownership → the CRITICAL issue above.
- **XSS:** viewing key + walletId cached in localStorage; a stored XSS can read/decrypt the viewing
  key and call the sign oracle. Hardening: CSP, no `dangerouslySetInnerHTML` (none seen), key the
  cache with a secret not a public userId, and fix the oracle.
- **Prover/discovery trust:** the client trusts prover proofs and indexer output by design
  (STRK20 model). Proofs are validated on-chain by the pool; discovery returning wrong notes would
  mislead balances but not let the client forge spends (proofs bind to real pool state). Acceptable,
  note it.

**Verdict 7: the signing oracle is a release-blocking security issue; server-managed custody and
the nominal cache encryption are secondary.**

---

## 8. RECOVERY / MULTI-DEVICE

- Device A: login → same walletId (custom metadata) → derive viewing key (deterministic raw_sign) →
  discovery → balances.
- Device B: same login → **same walletId** (route.ts:41-46, CONFIRMED) → **same viewing key**
  (determinism CONFIRMED live) → discovery → balances.
- So the exact flow is **supported by the current design**. UNVERIFIED end-to-end only because it
  needs a live operator + funded/deployed account to have balances to recover. The walletId is
  bound per-user via Privy custom metadata (not a plaintext DB of keys). Viewing keys never hit a
  backend DB. CONFIRMED (design), UNVERIFIED (E2E).

**Verdict 8: recovery works by construction; needs a live test.**

---

## 9. ENVIRONMENT / DEPLOYMENT

| Variable | Local | Vercel | AWS operator | Class |
|---|---|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | yes | yes (build-time) | no | PUBLIC |
| `PRIVY_APP_ID` | yes | yes | no | SERVER |
| `PRIVY_APP_SECRET` | yes | yes | no | **SECRET** |
| `NEXT_PUBLIC_READY_CLASSHASH` | yes | yes | no | PUBLIC (default ok) |
| `NEXT_PUBLIC_STRK20_SEPOLIA_POOL` | default | default | no | PUBLIC |
| `NEXT_PUBLIC_STRK20_PROVER_URL` | yes | yes | must be public URL of prover | PUBLIC |
| `NEXT_PUBLIC_STRK20_DISCOVERY_URL` | yes | yes | must be public URL of discovery | PUBLIC |
| `NEXT_PUBLIC_STARKNET_RPC_URL` | optional | optional | no | PUBLIC |
| `RPC_URL` / `WS_URL` / `ETHEREUM_API_URL` | — | — | operator only | OPERATOR |

- **Missing/incorrect:** `.env.example` has `NEXT_PUBLIC_CHAIN_ID=SN_MAIN` (line 36) while the
  Privy/STRK20 path is **hardcoded to Sepolia** (`getNetworkConfig("sepolia")` in
  PrivyWalletContext.tsx:143; pool/compose all Sepolia). Misleading — set to `SN_SEPOLIA` or remove.
- **localhost:** `.env.example` and operator docs use `http://localhost:8080` /
  `http://localhost:3001` for prover/discovery. For **Vercel**, the browser needs the **public AWS
  URLs** (they are `NEXT_PUBLIC_*`, baked into client JS). `localhost` values will NOT work when
  deployed. CONFIRMED pitfall.
- **Browser-exposed:** `NEXT_PUBLIC_*` prover/discovery URLs are public by design (the SDK calls
  them from the client). Do not put any secret under `NEXT_PUBLIC_*`.

---

## 10. FINAL VERDICT

### A. Status
- Privy Starknet compatibility: **7/10** (signing/derivation CONFIRMED; no deploy; custodial)
- STRK20 SDK integration: **6/10** (wired correctly; registry discarded, approve UNVERIFIED)
- Prover integration: **4/10** (wired; UNVERIFIED; version-mix + pathfinder v0_10 risk)
- Discovery integration: **4/10** (wired; UNVERIFIED; WS-port risk)
- Viewing-key architecture: **6/10** (deterministic+recoverable; cache encryption nominal)
- Automatic balance synchronization: **5/10** (poll-only, no event-driven, no persisted registry)
- Umbra-style UX: **5/10** (tabs open, no repeated prompts; blocked by deploy/operator gaps)
- Security: **3/10** (arbitrary-signing oracle; custodial; weak cache encryption)
- Recovery: **6/10** (design works; UNVERIFIED E2E)
- Production readiness: **3/10**

### B. CONFIRMED WORKING (proven by code + live calls)
- Privy `raw_sign` → `[r,s]` decode → cryptographically valid Starknet signature (live-verified).
- Signature determinism (RFC6979) → cross-device viewing-key recovery works by construction.
- `StarknetPrivySigner` implements the exact `signTransaction` surface the vendored SDK consumes.
- Ready v0.4.0 class hash declared on Sepolia; address derivation matches the official demo.
- starknet.js v10 `UniversalDetails` supports `proofFacts`/`proof` (proof-bearing submission typed).
- Wallet stability per Google account via `customMetadata.starknetWalletId`.
- No repeated user-facing signing for balance refresh (server-side once-per-device signing; reads don't sign).

### C. CONFIRMED BROKEN
- **No account deployment path** → any real STRK20 on-chain action fails on an undeployed counterfactual account.
- **`/api/privy/sign` signs arbitrary hashes for arbitrary walletIds** for any authenticated user (no ownership binding, no policy, no rate limit).
- Viewing-key cache "encryption" key is a hash of a public userId (effectively plaintext to XSS).

### D. HIGH-RISK UNVERIFIED
- SDK rc.5 ↔ prover/discovery rc.2 wire compatibility.
- Pathfinder v0.22.7 `/rpc/v0_10` endpoint + WS port for discovery indexing.
- Prover image tag existence on ghcr; pool `CONTRACT_VERSION '2.0'`.
- `deposit` approve requirement against the deployed pool.
- Full shield/send/unshield lifecycle on Sepolia with real operator.

### E. BLOCKERS (must be solved before calling it STRK20-compatible)
1. **Account deploy + fund flow** (deploy the derived Ready account; then ~10-block finalization).
2. **Secure `/api/privy/sign`** (bind walletId↔userId; policies; rate limit).
3. **Working operator** (prover+discovery reachable from the browser; validate the version/port risks in D).
4. **Post-mutation balance refresh** (event-driven or immediate re-discovery after confirm; not just 20s poll).

### F. REQUIRED CODE CHANGES (exact files)
1. **src/privacy/privy/ready.ts** — add `deployReadyAccount(publicKey, classHash, provider, signer)` (deploy_account via `Account.deploySelf`, salt=pubkey, same constructor calldata). And a `isDeployed(address)` helper.
2. **src/context/PrivyWalletContext.tsx** — add `deploy()`; call it (if `!isDeployed`) before `register()`/first shield; expose `deployed` state; wait ~10 blocks after deploy.
3. **src/app/api/privy/sign/route.ts** — load the caller's `customMetadata.starknetWalletId` and reject if `walletId !== mapped`; add rate limiting; optionally configure Privy raw_sign policy (server-side).
4. **src/app/api/privy/wallet/route.ts** — already stable; optionally return `deployed` boolean.
5. **src/privacy/privy/viewingKeyStore.ts** — derive the cache-encryption key from a **secret** (e.g., a second Privy-signed secret or `crypto.subtle`-derived from the viewing-key signature itself), not the public userId; or move to IndexedDB + WebCrypto non-extractable key.
6. **src/context/PrivyWalletContext.tsx / src/components/wallet/BalanceCard.tsx** — add an explicit `refreshBalances()` that re-runs `discoverNotes`; call it after every confirmed Privy mutation (SendForm `refreshAfterMutation` should also refresh Privy balances); persist the SDK `registry` (notes/channels/cursor) in `transfersCache` keyed by address and pass `registryConst:false` reuse.
7. **src/privacy/adapter/PrivyStrk20Adapter.ts** — memoize the `PrivateTransfers` instance per address (keep `transfersCache`; it's currently dead because `buildAdapter()` is recreated per call), and optionally add an `approve` step before `deposit` once the pool ABI is confirmed.
8. **.env.example** — fix `NEXT_PUBLIC_CHAIN_ID=SN_MAIN` → `SN_SEPOLIA` (or remove); document that prover/discovery URLs must be the public AWS URLs for Vercel.
9. **infra/strk20-operator/docker-compose.yml** — add named volumes (pathfinder + indexer state), correct WS URL/port, and prover healthcheck; validate the prover's `/rpc/v0_10` path against the chosen node (or point the prover at a v0.10-capable node).

### G. AWS OPERATOR REQUIREMENTS
- Docker services: `discovery-service` (RC.2), `transaction-prover` (RC.2), `pathfinder v0.22.7` (or a v0.10-capable node).
- Env: `RPC_URL`, `WS_URL`, `ETHEREUM_API_URL` (pathfinder), `CHAIN_ID=SN_SEPOLIA`.
- Ports (public): discovery `8080`, prover `3000` (map host 3001→3000 locally; expose via reverse proxy / ALB + TLS).
- Persistence: named volumes for pathfinder state and indexer data; ~90 GiB gp3 is plausible; reserve for node re-sync.
- RAM/CPU: 8 vCPU / 32 GiB is plausible for discovery+pathfinder; the prover is the heavy component — monitor, and consider a separate instance for the prover if OOM.
- Health: discovery `/health`; prover `getSpecVersion`/`isHealthy`; wire compose healthchecks + startup ordering (prover depends_on pathfinder ready).

### H. END-TO-END TEST PLAN (Sepolia, real operator)
1. Privy wallet creation — EXPECT: same walletId per user, `public_key` present. ACTUAL: ? (needs live Vercel).
2. Ready address derivation — EXPECT: `computeReadyAccountAddress(pubkey)` matches known-good. PASS (code).
3. Account deployment — EXPECT: deploy_account tx confirmed; address code non-zero. ACTUAL: **BROKEN — no deploy path.**
4. STRK20 registration — EXPECT: SetViewingKey confirmed via `register()`. ACTUAL: fails until (3) + operator.
5. Viewing key init — EXPECT: once, server-side, deterministic. PASS (logic; determinism live-confirmed).
6. Discovery — EXPECT: `discoverNotes` returns notes for the viewing key. ACTUAL: needs operator.
7. Shield — EXPECT: approve+deposit → new note. ACTUAL: needs deployed account + prover + approve confirm.
8. Automatic balance update — EXPECT: ≤20s poll shows new note. ACTUAL: poll-only; indexer latency.
9. Private transfer — EXPECT: sender note consumed, remainder + recipient note created. ACTUAL: needs operator.
10. Recipient discovery — EXPECT: recipient sees note after registering their viewing key. ACTUAL: needs operator + recipient registration.
11. Sender remainder discovery — EXPECT: sender sees remainder note. ACTUAL: needs operator.
12. Reload — EXPECT: cached walletId + cached/derived viewing key; balances restore. PASS (logic).
13. Re-login — EXPECT: same walletId (metadata), same viewing key (deterministic). PASS (logic).
14. New-device recovery — EXPECT: same account + key + balances. UNVERIFIED (should work).
15. Unshield — EXPECT: spend note → public transfer. ACTUAL: needs deployed account + prover.

### I. MOST IMPORTANT — can the current code achieve the target experience?
**Not yet, but with small, well-scoped changes — NOT a different wallet architecture.**

The signing, account derivation, viewing-key model, and recovery are all CONFIRMED correct. What
stands between now and the target experience is four additive pieces, all implementable on the
current architecture:
1. **Deploy/fund the Ready account** (a `deploy_account` call — the signer already supports it).
2. **Fix the `/api/privy/sign` ownership check** (security; do not ship without it).
3. **Run + validate the operator** (the version/port risks in D are the real unknowns).
4. **Refresh balances after mutations** (immediate re-discovery instead of waiting for the 20s poll).

Until (1) and (3) are done, no real STRK20 transaction can succeed; until (2), the signing endpoint
is unsafe. The UX model (no repeated prompts, automatic discovery, one-time viewing-key signing,
deterministic recovery) is already correct in the code.