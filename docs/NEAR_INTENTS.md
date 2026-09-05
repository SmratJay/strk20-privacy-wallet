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

## Mainnet readiness (explicit, three-way gate, never a fallback)

`config.ts` separates **code support**, **configuration**, and **feature availability** via a
three-way gate. `resolveWalletPrivacyConfig` is now **network-scoped**: mainnet prover/discovery are
read from `NEXT_PUBLIC_STRK20_PROVER_URL_MAINNET` / `..._DISCOVERY_URL_MAINNET` ONLY — mainnet has
**no fallback** to the Sepolia (alpha) operator endpoints.

| Gate | Meaning | Sepolia today | Mainnet today |
| --- | --- | --- | --- |
| `configured` | STRK20 stack (pool + prover + discovery + anonymizer) present for this network | ✅ true | ❌ false |
| `available` | API layer (quote / reserve / status) usable | ✅ true | ❌ false |
| `settlementEnabled` | funding a NEAR deposit may proceed (mainnet STRK20 + mainnet paymaster) | ❌ false | ❌ false |

- `quote` / `createIntent` / `status` are gated on `available` (prove the API layer safely).
- `execute` is gated on `settlementEnabled` — on any network where settlement is off, the adapter
  **refuses to fund** (this prevents a Sepolia STRK20 shadow account from sending Sepolia STRK to a
  MAINNET NEAR deposit address, which would silently strand funds).
- Enabling settlement requires: mainnet prover/discovery/anonymizer + a mainnet private-paymaster
  relay (`NEXT_PUBLIC_STRK20_PAYMASTER_URL_MAINNET`) + a funded wallet — never a public path.

## Refund model (no stranded funds, no false "private restored")

`refundTo` is the Shadow Account address (the private execution identity). On a refund the STRK
returns to the **shadow account as a public Starknet balance** — the 1Click ORIGIN_CHAIN model has
**no path back to a private STRK20 note**. This is modeled honestly:

- `REFUNDED` / `FAILED` / `INCOMPLETE_DEPOSIT` → `nearIntentOp` shows **"refunded / recovery
  required"** (never "private balance restored").
- `refundedAmount` + `refundReason` are carried in the receipt and op state.
- Recovery is a **separate shadow-account sweep** (a later `collectRemainder`/`collectTokens` shadow
  invocation returns the public STRK to a private note) — not automatic, and not claimed here.
- On `settlementEnabled = false` networks `execute` refuses before funding, so a wrong-network
  deposit can never strand funds in the first place.

## Destination reconciliation

`SUCCESS` is the 1Click signal that "tokens delivered to destination". Success is **not** claimed
from a mere status change — the safe receipt also retains the exact corroborating tx ids:

- `nearTxHashes` — NEAR verifier settlement tx(s);
- `destinationChainTxHashes` — Base destination tx(s);
- `sourceChainTxHashes` / `transactionHash` — the Starknet shadow-account source deposit tx;
- `amountOut` — the reconciled destination amount;
- the requested `destinationAddress` + `destinationAsset` (`usdc`) are bound by construction
  (they were sent in the quote request, so NEAR routes to exactly them).

The destination recipient/asset/amount are cross-checked against the intent before source funding;
on-chain Base verification (reading the Base chain) is out of scope for this repo and remains a
documented limitation.

## Fees & auth (current, accurate)

- **Keyless** ORIGIN_CHAIN flow used — no NEAR credentials in the browser, no user custody/private
  data exposed.
- Unauthenticated 1Click: **0.2%** platform fee + 0.0001% protocol fee + bridge/withdraw fees
  surfaced in the quote (`refundFee`, `withdrawFee`).
- A partner **JWT** (`X-API-Key` / `Authorization: Bearer`) waives the 0.2% — intentionally NOT
  implemented; it must stay server-only and can be added later without moving custody/private data.

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
2. **This app's Wallet Core is Sepolia-only** (`setNetwork` rejects mainnet), the STRK20
   prover/discovery are Sepolia (`alpha-sepolia`), the mainnet anonymizer is empty, and the private
   paymaster relay is Sepolia-only — so `settlementEnabled` is `false` and `execute` refuses to fund.
3. **Starknet has no intent-signing standard** in NEAR Intents (NEP-413/ERC-191/raw-ed25519 only),
   so the Starknet wallet cannot sign intents directly — only the ORIGIN_CHAIN deposit flow applies,
   which requires a real on-chain STRK deposit on **mainnet**.
4. **Real funds + a destination identity are required** — real mainnet STRK, mainnet gas, and a
   user-controlled Base address. None are available in this environment, and a server-held master
   wallet is explicitly out of scope.

Therefore Phase 4.5 hardens the adapter (three-way gate, refund/recovery model, destination
reconciliation, quote/intent binding) and ships it + tests + docs, but the **real-execution
acceptance gate remains BLOCKED** and is reported honestly (no mocked success, no fabricated tx
hashes). To complete acceptance: configure mainnet prover/discovery/anonymizer + a mainnet
private-paymaster relay + `setNetwork` mainnet, fund a wallet with mature private STRK, and provide
a Base destination — then run one real swap and record the source/shadow/deposit/NEAR/Base tx ids.

## Security invariants

- No private keys, viewing keys, STRK20 notes, or proofs are ever sent to NEAR.
- No NEAR credentials are placed in the browser (the keyless ORIGIN_CHAIN deposit flow is used).
- No server-held master wallet; the root wallet is never the on-chain depositor.
- Destination address, source/destination assets, exact amount, quote expiry, min output, route,
  chain, and intent status are all validated.
- No public master-wallet fallback: the shadow account executes the deposit.
