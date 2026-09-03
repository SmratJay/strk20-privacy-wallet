# Private Execution — REAL STRK20 Shadow Accounts

## Why `PrivateExecutor` exists

The Wallet Core proves the privacy foundation end to end: self-custodial custody, wallet-native
STRK20 registration, shield, private balance discovery, private transfer, and unshield. The
missing layer is **private application execution through a REAL STRK20 shadow account** — a
deterministic, anonymizer-derived execution identity that calls a Starknet application while the
user's root wallet is neither the application caller nor the outer transaction sender.

```
Wallet Core → STRK20 privacy → PrivateExecutor (shadow account) → Starknet application
```

## The four boundaries (never conflated)

| Layer | Role | Owns |
|---|---|---|
| **Wallet Core** | **Custody** | keys, keystore, Ready/Braavos account, local signer, WalletRuntime |
| **STRK20** | **Privacy** | viewing key, notes, proofs, pool ops — `WalletPrivacySession` → `Strk20Adapter` → vendored SDK |
| **PrivateExecutor** | **Application execution** | real shadow-account execution (this module) |
| **NEAR** | Future routing layer | NOT built here |

`Wallet Core = custody` · `STRK20 = privacy` · `PrivateExecutor = application execution` ·
`NEAR = future routing layer`.

## The shadow-account flow (real RC5 `shadowAccounts()`)

```
MASTER WALLET (Wallet Core authority, signs the proof invocation)
  → STRK20 private balance (mature shielded notes)
  → shadowAccounts(appName).commitment(nonce)   (deterministic shadow identity)
  → shadow address (counterfactual, anonymizer-derived)
  → private STRK withdrawn to the shadow address
  → shadow.invoke(nonce, { calls })             (the SHADOW ACCOUNT calls the application)
  → private paymaster relays the proof          (outer tx sender ≠ root wallet)
  → Starknet application sees the SHADOW ACCOUNT as caller
```

- The user's Wallet Core account signs the PROOF INVOCATION (the SDK builds it with the wallet's
  signer — this authorizes the private-note spending). The OUTER transaction is relayed through
  the AVNU private paymaster, so the root wallet is never the on-chain tx sender.
- `appName` scopes the shadow identity; `nonce` selects it. Same `appName + nonce` → same
  shadow address (linkable). A new `nonce` → a fresh, unlinkable shadow address.
- This **replaces** the earlier `privacy_invoke(identity, amount)` prototype, which was NOT a
  real shadow account (the application saw the pool + a passed commitment, not a shadow account).

## Pinned Sepolia shadow-account stack (verified live)

| Component | Address / value |
|---|---|
| Privacy pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Shadow-account anonymizer | `0x05f23b2497e99dde2c9aed326cc36c2c41fd11ce946435157521caa4895d129f` |
| Shadow-account class | `0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c` |
| Primer class (address formula) | `0x00123e6bc1c14ae9934e933d3f64916a6116dd6b036a922b2b1f0815e0d1d300` |
| Operator discovery | `https://discovery-service.alpha-sepolia.sw-dev.io` |
| Operator prover | `https://transaction-prover.alpha-sepolia.sw-dev.io/` |
| Private paymaster | `https://sepolia.paymaster.avnu.fi` (`default` mode, credential-free) |
| SDK / starknet.js | `@starkware-libs/starknet-privacy-sdk` `0.14.3-rc.5` / `starknet` `10.5.0` |

The shadow address is `calculateContractAddressFromHash(commitment, PRIMER, [], anonymizer)`.
The reference starter (`starkience/strk20-shadow-account-starter`) independently verified the same
pinned stack. Orrange keeps the master key in Wallet Core (browser) — the starter's trusted-server
key pattern is NOT adopted.

## Wallet Core boundary

Wallet Core does not know about applications or swaps. The only new Wallet Core surface is
`runtime.executePrivate(intent)` (shadow execution) + `createShadowIdentity(appName, nonce)`.
The runtime:

- requires an unlocked Wallet Core wallet and a live `WalletPrivacySession`;
- captures and validates the existing `(walletId, network, generation)` guard — stale/locked
  executions are refused;
- runs through `StarknetPrivateExecutor` → `WalletPrivacySession.executeShadowApplication` →
  `Strk20Adapter` → the SDK `shadowAccounts()` builder → the private paymaster;
- appends safe activity metadata and returns a `PrivateExecutionReceipt`.

No Wallet Core internals (secret, signer, account) reach React.

## STRK20 boundary

- The viewing key stays inside `WalletPrivacySession`; it never leaves the session.
- The SDK's stateless model is used; discovery is refreshed before execution.
- The 10-block proving margin (`PROVING_SAFETY_MARGIN`) and note maturity (10 blocks) are
  respected: `selectMatureNotes` only spends notes that predate the proving block by 10 blocks.
- Mutating ops (including shadow execution) are serialized through the session mutex.
- Cache isolation (per address + full STRK20 context) is unchanged.
- Known operator quirk (worked around): a freshly-opened self-channel is returned by the
  discovery indexer as "precomputed" until confirmed, so a separate `register()` followed
  immediately by a `shield()` makes the SDK re-open the channel and the pool reverts with
  `NON_ZERO_VALUE`. The acceptance therefore lets the FIRST SHIELD auto-register + auto-setup in
  one proof (no separate register). `register()` stays minimal (viewing key only).

## `PrivateIdentity` / shadow-account role

`PrivateIdentity` now models a real shadow identity: `owner`, `chain`, `appName`, `nonce`,
`anonymizerAddress`, `partialCommitment`, `commitment`, `shadowAddress`, `status`. Records are
wallet + network scoped (a Sepolia identity can never be reused on mainnet, nor wallet A's by
wallet B). The viewing key is consumed transiently and never persisted.

## What is and is not private

**Private:** the master-wallet → application linkage. The application sees the shadow account,
never the wallet. The spend is a private-note proof (STRK20), signed locally, with notes/proofs
never exposed. The outer transaction is relayed by the paymaster (root is not the sender).

**Not private (honest limits):**
- The shadow address, its calls, target, amounts, application state, and timing are public.
- The initial shield exposes the root account, token, amount, and timing.
- The configured prover and discovery services process the private requests.
- This is not an anonymity guarantee.

## Current limitation

- The only supported action is `shadow.invoke` against a validated application call. The
  acceptance target is a tiny `ShadowExecutionProbe` contract that records the shadow caller.
- The paymaster `default` mode is credential-free but charges a relay fee (~17 STRK on Sepolia),
  paid from the private balance. `sponsored_private` mode (server-side API key) is supported by
  the paymaster client but not wired.
- `register()` is intentionally minimal; a fresh wallet's first shield auto-registers.

## Acceptance result (live Sepolia, verified on-chain)

On 2026-09-03 a REAL shadow-account execution passed end to end:

- Fresh Wallet Core wallet `0x6af30f7806e01761bf045d347948cef6ab608cb84d1d97c50cb739b7a36439d`
  funded + deployed + reaching proving maturity.
- Shield (auto-register) tx `0x43908c66a57e47d1aba58ffad27c6ccc87c5ea6d1dcbe76f80369dcb92d4871` →
  private STRK balance 30 STRK.
- Shadow identity `(appName="orrange", nonce=0)`:
  commitment `0x4d37bee335403078cb96f4fc03b37a7be0f07063c2486651b7b911a6b1678ce`,
  shadow address `0x2201cdc500333ac6517c6b44f955ce21c749a0faf74aa07ea6f7cc6ee0b668f`.
- **Shadow execution tx `0x4b05bbd17f2648d9adea2a443c5179520c5eb372199e678462394e8c0e3f1b7`** —
  `SUCCEEDED` / `ACCEPTED_ON_L2`, block `14507476`.
- Verified on-chain: the probe's execution count for the shadow address is `1`, the recorded
  caller is the shadow address (NOT the root wallet), the recorded amount is `0.2 STRK`, the
  outer tx sender `0x4ab1f891…` differs from the root wallet, and the shadow address runs the
  pinned shadow-account class `0x038489bd44c93ee2eb8604d3a15db60781145951ebdebe356fc824b4a0385a5c`.

**PRIVATE STRK → REAL SHADOW ACCOUNT → REAL STARKNET APPLICATION CALL** — verified live.