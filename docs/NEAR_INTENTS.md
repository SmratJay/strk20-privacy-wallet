# NEAR Intents — Private Cross-Chain Routing (Phase 4)

The `src/features/near-intents/` module is the RFP Phase 4 layer: **Private Execution → NEAR
Intent → Solver → Destination Chain**. It adds cross-chain *routing/settlement* on top of the
existing STRK20 privacy stack **without** changing Wallet Core, STRK20, or the Shadow Account.

## Architecture

```
Wallet Core (custody, signs the proof invocation)
  → STRK20 private balance (mature shielded notes)
  → shadow identity (appName, nonce) — private execution identity
  → shadow account withdraws private STRK + executes `transfer(STRK → NEAR deposit address)`
  → private paymaster relays the outer tx (root wallet is never the on-chain sender)
  → NEAR Intents 1Click API detects the deposit and a solver swaps STRK → USDC
  → destination chain (Base) receives USDC at the user-supplied address
```

NEAR does **not** enter Wallet Core. `WalletRuntime` only bridges:

- `quoteCrossChain`
- `createCrossChainIntent`
- `executeCrossChainIntent`
- `getCrossChainStatus`

All NEAR business logic (intent construction, quote, route validation, publish, status,
reconciliation) lives in the feature module.

## The one supported route

| Field | Value (verified live 2026-09-05) |
| --- | --- |
| Source chain | Starknet |
| Source asset | STRK — `nep141:starknet.omft.near` |
| Destination chain | Base |
| Destination asset | USDC — `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` |
| Deposit address | 251-bit Starknet address (returned by `/v0/quote`, non-dry) |
| Destination address | 42-char EVM address (user-supplied, validated) |

## Intent lifecycle (status machine)

```
quoting → preparing → intent-created → awaiting-source-deposit → source-confirming
  → solver-executing → (destination-pending) → success / failed / refunded / unknown
```

| Phase | Source |
| --- | --- |
| `quoting` / `preparing` | runtime setup |
| `intent-created` | `createCrossChainIntent` reserves a NEAR deposit address |
| `awaiting-source-deposit` | shadow account is about to fund the deposit |
| `source-confirming` | shadow transfer submitted (source tx) / NEAR reports `KNOWN_DEPOSIT_TX` |
| `solver-executing` | NEAR reports `PROCESSING` |
| `success` | NEAR reports `SUCCESS` (destination settlement reconciled) — the only success source |
| `refunded` / `failed` | NEAR reports `REFUNDED` / `FAILED` / `INCOMPLETE_DEPOSIT` |
| `unknown` | settlement not reconcilable (timeout/API failure) — never collapsed into `failed` |
| `destination-pending` | reserved: the 1Click API folds destination confirmation into `PROCESSING → SUCCESS` and exposes no distinct "destination pending" status, so it is not fabricated |

- **Success is NEVER claimed without destination reconciliation** (`status === "SUCCESS"`).
- **UNKNOWN is never collapsed into FAILED.**
- Quote expiry, changed quote (stale/mutated), insufficient balance, rejected intent, solver
  unavailable, timeout, partial/unknown settlement, RPC/API failure, and stale wallet sessions are
  all handled honestly (see `adapter.ts`).

## Mainnet readiness (explicit, not a fallback)

`config.ts` separates **code support** from **configuration** and **feature availability**:

- `CROSS_CHAIN_NETWORK_CONFIG.sepolia.enabled = true` — the STRK20 Sepolia operator
  (prover/discovery/anonymizer) is configured; the API layer is live.
- `CROSS_CHAIN_NETWORK_CONFIG.mainnet.enabled = false` — the STRK20 **mainnet** operator
  (prover/discovery/anonymizer + paymaster) is not yet configured. The adapter **refuses** (throws
  `unavailable on mainnet`) rather than falling back to a public root-wallet execution.

Enabling mainnet is a configuration change (mainnet prover/discovery/anonymizer + paymaster + a
funded wallet + a destination address) — never a silent public path.

## Privacy boundary (documented, explicit)

NEAR Intents is a **routing/settlement** layer. It does **not** make the source↔destination
relationship private. The privacy primitive stays in STRK20/Shadow Account.

| Link | Visibility |
| --- | --- |
| Root wallet → shadow account | **PRIVATE** (STRK20 shielded note + shadow identity) |
| Shadow account → NEAR deposit address | **PUBLIC** (an on-chain STRK transfer from the shadow address) |
| NEAR deposit → solver → destination settlement | **PUBLIC** (on NEAR + the destination chain) |
| Destination address → user | **LINKABLE** only if the user reuses a known address |

Because the deposit is a plain Starknet transfer, **the funds must leave the STRK20 privacy pool
before NEAR can route them**. The shadow account — never the root wallet — is the on-chain
depositor, so the *root wallet* is not directly linked to the deposit. This is the maximum privacy
the current NEAR Intents deposit model permits; there is no cryptographically-private deposit
path, and this module does not claim one.

**Destination address:** always user-supplied and validated (EVM format). It is **never** derived
from the root Starknet wallet (which is not even a valid destination-chain address). Use a fresh
destination identity when the route requires it.

## Real-execution status (acceptance gate blocker)

The adapter is fully implemented against the **live** 1Click API (`https://1click.chaindefuser.com`)
and verified live:

- `GET /v0/tokens` → 188 tokens; STRK (`nep141:starknet.omft.near`) present.
- `POST /v0/quote` (`dry: true`) → real pricing (HTTP 201) with amount out + bridge fees.
- `POST /v0/quote` (`dry: false`) → real reserved Starknet `depositAddress` (HTTP 201).
- `GET /v0/status` → real `PENDING_DEPOSIT` state with full `swapDetails`.

A **real funded cross-chain execution** cannot complete in this repository today because:

1. **NEAR Intents has no testnet.** The verifier is `intents.near` on NEAR **mainnet**; the 1Click
   API is mainnet production. There is no public testnet deployment.
2. **This app's Wallet Core is Sepolia-only** (`setNetwork` rejects mainnet), and the STRK20
   prover/discovery endpoints are Sepolia (`alpha-sepolia`). A mainnet private STRK balance cannot
   be produced here.
3. **Starknet has no intent-signing standard** in NEAR Intents (NEP-413/ERC-191/raw-ed25519 only),
   so the Starknet wallet cannot sign intents directly — only the ORIGIN_CHAIN deposit flow applies,
   which requires a real on-chain STRK deposit on **mainnet**.
4. **Real funds + a destination identity are required** — real mainnet STRK, mainnet gas, and a
   user-controlled Base address. None are available in this environment, and a server-held master
   wallet is explicitly out of scope.

Therefore Phase 4 ships the adapter + tests + this boundary, but the **real-execution acceptance
gate is BLOCKED** and is reported honestly (no mocked success, no fabricated tx hashes). To
complete the acceptance gate, run the app against Starknet mainnet with a funded wallet + a
destination Base address (and re-enable mainnet in `setNetwork` + mainnet STRK20 config).

## Security invariants

- No private keys, viewing keys, STRK20 notes, or proofs are ever sent to NEAR.
- No NEAR credentials are placed in the browser (the keyless ORIGIN_CHAIN deposit flow is used).
- No server-held master wallet; the root wallet is never the on-chain depositor.
- Destination address, source/destination assets, exact amount, quote expiry, min output, route,
  chain, and intent status are all validated.
- No public master-wallet fallback: the shadow account executes the deposit.
