# Private Execution — Phase 1

## Why `PrivateExecutor` exists

The Wallet Core already proves the privacy foundation end to end: self-custodial custody,
wallet-native STRK20 registration, shield, private balance discovery, private transfer, and
unshield. What it cannot yet do is cause an **external Starknet application action** from a
private balance — every existing operation either moves tokens inside the privacy pool or
withdraws to public.

`PrivateExecutor` is the new layer that connects a private STRK20 balance to an external
Starknet application while keeping the application on the privacy side of the wallet:

```
Wallet Core → STRK20 privacy → PrivateExecutor → Starknet application
```

It is deliberately minimal and application-agnostic. It is **not** NEAR Intents, not a TEE, not a
cross-chain system, not a solver, not a swap protocol.

## The four boundaries (never conflated)

| Layer | Role | Owns |
|---|---|---|
| **Wallet Core** | **Custody** | keys, keystore, Ready/Braavos account, local signer, WalletRuntime |
| **STRK20** | **Privacy** | viewing key, notes, proofs, pool ops — `WalletPrivacySession` → `Strk20Adapter` → vendored SDK |
| **PrivateExecutor** | **Application execution** | turning a `PrivateExecutionIntent` into a safe `PrivateExecutionReceipt` |
| **NEAR** | Future routing layer | NOT built here |

`Wallet Core = custody` · `STRK20 = privacy` · `PrivateExecutor = application execution` ·
`NEAR = future routing layer`.

## Wallet Core boundary

Wallet Core **does not know about applications, solvers, swaps, or anything application-level.**
The only new Wallet Core surface is `runtime.executePrivate(intent)` (plus safe identity listing
and the existing `createPrivateIdentity`). The runtime:

- requires an unlocked Wallet Core wallet and a live `WalletPrivacySession`;
- captures and validates the existing `(walletId, network, generation)` guard — stale/locked
  executions are refused;
- runs through `StarknetPrivateExecutor` → `WalletPrivacySession` → `Strk20Adapter` → SDK;
- appends safe activity metadata and returns a `PrivateExecutionReceipt`.

No Wallet Core internals (secret, signer, account) reach React. The raw `UnlockedWallet` is
consumed by the executor only to assert identity ownership against the active session.

## STRK20 boundary

Everything private stays inside `WalletPrivacySession` / `Strk20Adapter`:

- the **viewing key** is derived in-memory and never leaves the session;
- the executor never receives or forwards the viewing key, notes, or proofs;
- the SDK's **stateless / full-refresh model** is preserved — `autoDiscover: { notes: "refresh",
  channels: "refresh" }` refreshes discovery before execution, and the private registry remains
  session state, never durable protocol state;
- the **10-block proving safety margin** (`PROVING_SAFETY_MARGIN`) is respected (the adapter
  proves against a block safely behind the chain head);
- mutating ops (including private execution) are serialized through the session mutex;
- cache isolation (per address + full STRK20 context) is unchanged.

## `PrivateIdentity` / shadow-account role

The execution identity is the existing `PrivateIdentity` primitive, resolved **scoped to the
active wallet + network** (never a caller-injected commitment). The `PrivateIdentity` carries the
real SDK shadow-account commitments (`partialCommitment`, `commitmentNonce0`).

Shadow-account model preserved:

```
Master Wallet → PrivateIdentity → Shadow Account → Private App Execution
```

- **Master Wallet** = Wallet Core authority (signs the STRK20 proof via the local signer).
- **PrivateIdentity** = the SDK-computed shadow commitment (the execution identity).
- **Shadow Account** = the identity the application executes under. The application only ever
  sees the public shadow commitment passed as `privacy_invoke` calldata and the privacy pool as
  the caller — never the master wallet address. It is an **execution identity**, NOT another
  master wallet and NOT another custody system.
- **Private App Execution** = the external contract's `privacy_invoke(identity, amount)`.

Wallet Core remains the ultimate user authority: every execution is a Wallet Core-signed STRK20
proof transaction.

## Exact SDK primitives used

All from the vendored `@starkware-libs/starknet-privacy-sdk` `0.14.3-rc.5`:

- `createPrivateTransfers(...)` — the SDK context (account/signer, viewing-key provider, prover,
  discovery, pool).
- `build({ autoSetup, autoDiscover: { notes: "refresh", channels: "refresh" },
  autoSelectNotes: "naive" })` — stateless builder with note/channel discovery refresh.
- `.with(token).withdraw({ recipient, amount })` — spend a private note to the application
  on-chain (the pool pays the application).
- `.invoke(callBuilder)` — queue a `privacy_invoke` call on the target application that runs
  after the private ops in the same `apply_actions` proof transaction.
- `.surplusTo(recipient)` — return any note surplus to the user's own private balance.
- `simulate({ node })` / `execute({ provingBlockId })` — the adapter's fee-estimate → execute →
  submit pipeline with the safe proving block.
- The `privateApplication` application adapter mirrors the `privateCurve` pattern (an application
  adapter on the generic `Strk20Adapter`) so application logic never leaks into the generic
  adapter.

The RC5 `shadowAccounts(...)` / `ShadowAccountsBuilder` primitives are the SDK's full
shadow-account anonymizer path and remain the documented next step — they require a deployed
`shadow_account_anonymizer` + shadow-account class hash, which are not configured in this build.

## What is and is not private

**Private:** the master-wallet → application linkage. The application sees the shadow commitment,
not the wallet. The spend is a private-note proof (STRK20), signed locally, with notes/proofs
never exposed.

**Not private (honest limits):**
- The application action itself (`privacy_invoke` calldata) is public on-chain; the application
  records the shadow commitment and amount.
- The privacy pool's caller identity and the `apply_actions` transaction are public on-chain.
- Discovery traffic to the indexer is direct HTTPS by default (OHTTP is a config seam).
- The Phase 1 identity is a commitment derived from owner + viewing key + anonymizer namespace +
  dapp name. When the real anonymizer is deployed, the same commitment maps to a real shadow
  account; until then it is an execution identity, not a deployed shadow account.

## Current limitation

- The only supported action is `application.invoke` against a contract implementing
  `privacy_invoke(identity, amount)`.
- The acceptance target is a tiny test-only helper contract (`PrivateExecutionProbe`) — a real
  app integration would follow the same path.
- The RC5 `shadowAccounts()` anonymizer path is not wired (anonymizer not configured).
- The live gate needs the operator prover + discovery services reachable and a funded Sepolia
  wallet with an existing private balance.

## Acceptance result

**Live Sepolia run (2026-09-03) — honest status:**

- `PrivateExecutionProbe` **deployed and verified on Sepolia**:
  - address `0x7874ab24a8f46969e124f6fe388ae36f8ce6c05b13a2c46ba1a9adcc6e90e84`
  - deploy tx `0x9a07c9d36851335b5ce9e766053cbb27824e222bdd4f9ddfd7ac53d2ad93c7` — `SUCCEEDED`
  - on-chain `get_privacy_pool` returns the Sepolia pool; `get_execution_count` = 0.
- A fresh Wallet Core wallet (funded by the repo's deployer) was created, funded, deployed, and
  reached 10-block proving maturity. Its **real STRK20 register transaction SUCCEEDED on-chain**:
  - tx `0x40bd11e5658689fcb4688cf5ef2b639876c6776530e7986d6a415beeab8e5a0` — `SUCCEEDED` /
    `ACCEPTED_ON_L2` — the wallet's wallet-native viewing key is registered in the STRK20 pool.
- The shield and the private execution transaction were **blocked before submission by the
  operator discovery indexer**: the official `discovery-service:PRIVACY-0.14.3-RC.2` image's
  indexer cannot process current Starknet Sepolia new-head WebSocket events (its bundled
  starknet-rust parser drops the block-header subscription events), so it never tracks an indexed
  head and the SDK's `outgoing_state`/`incoming_state` calls return `503 "No indexed head
  available yet"`. The repo's operator infrastructure uses a custom **patched** discovery image
  (built on the operator's EC2, not in this repo) for exactly this reason; the public
  `discovery.orrange.xyz` endpoint is unreachable from this environment.
- **No success was claimed for the private execution tx** — per the phase rule, the execution tx
  did not actually succeed, so it is NOT reported as live.

A reviewer with a working (patched) discovery service can run the full gate:

```bash
export NEXT_PUBLIC_STRK20_PROVER_URL=...   # reachable prover
export NEXT_PUBLIC_STRK20_DISCOVERY_URL=... # working discovery indexer
export NEXT_PUBLIC_STRK20_EXECUTION_PROBE_SEPOLIA=0x7874ab24a8f46969e124f6fe388ae36f8ce6c05b13a2c46ba1a9adcc6e90e84
export NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA=0x7874ab24a8f46969e124f6fe388ae36f8ce6c05b13a2c46ba1a9adcc6e90e84
export RUN_LIVE_ACCEPTANCE=1
npx vitest run src/__tests__/privateExecutionLiveAcceptance.test.ts
```