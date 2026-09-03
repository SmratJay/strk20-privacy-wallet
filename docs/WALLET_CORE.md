# Wallet Core — Stage 1 (Own Wallet Infrastructure)

Status: **STAGE 1 — Wallet Core foundation (implemented)**

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

`src/__tests__/walletCore.test.ts` — 28 tests covering all 12 required areas (key gen,
deterministic derivation, address derivation, encryption/decryption, wrong-password rejection,
reload, valid signatures, adapter-without-Privy, deployment flow, signing/submission, no-plaintext
persistence, no-Privy dependency). Full suite: `npm test` (482 tests), `npm run typecheck`, and
`npm run build` all pass.

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

## 12. Stage 2 boundaries (do NOT touch yet)

- Braavos import / account adapter
- Ready import UX
- NEAR Intents, cross-chain private trading, Solana/Base execution
- TEE infrastructure
- Seed-phrase mnemonic + key derivation
- Expanding the Stage 1 UI into a dashboard
- Any new privacy contracts