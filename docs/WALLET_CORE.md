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
5. verify ownership on-chain; mismatches REJECT — never silently repaired;
6. encrypt into the standard Wallet Core keystore (AES-GCM + PBKDF2) and persist;
7. discard temporary input.

### 13c. Storage / multi-wallet

`src/wallet/storage.ts` gained a registry scoped by **walletId (= canonical address) + network**:
`orrange_wallet_v2_registry_<network>` entries + `orrange_wallet_v2_keystore_<walletId>`.
Imported wallets can never overwrite another wallet. Legacy Stage 1 keys are preserved and
migrated into the registry on first use (`migrateLegacyWallet`).

### 13d. Private identity

`src/privacy/identity/PrivateIdentity.ts` — a wallet-level `PrivateIdentity` primitive:
`{ id, owner, purpose, chain, partialCommitment, commitmentNonce0, status }`. Commitments are the
REAL vendored STRK20 SDK shadow-account commitments (`ShadowAccountsBuilder.partialCommitment` /
`commitment(nonce)`), computed locally. The viewing key is accepted transiently and **never
persisted or logged**; only public commitments are stored. Identities dedupe by (owner, purpose)
and can be retired.

Key hierarchy (never conflated):
`MASTER WALLET KEY → controls Starknet account` · `STRK20 VIEWING KEY → discovers private notes` ·
`PRIVATE EXECUTION ID → isolates one privacy context`.

### 13e. STRK20 integration

`src/privacy/identity/strk20User.ts` — `buildStrk20User(wallet, viewingKey)` produces the
STRK20 adapter's user from an imported wallet's account/signer:
`Imported Wallet → Wallet Core signer → STRK20 adapter`, never through Privy.

### 13f. Stage 2 verification

`npm run typecheck` clean; `npm test` → 57 files / 538 tests; `npm run build` succeeds.
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

## 14. Stage 3 boundaries (do NOT touch yet)

- NEAR Intents, cross-chain private trading, Solana/Base execution
- TEE infrastructure · solver infrastructure · cross-chain shadow execution
- Seed-phrase mnemonic + key derivation
- Wallet Core-native viewing-key derivation
- Expanding the Stage 2 UI into a dashboard
- New privacy contracts