# PrivacyHub — Cross-Chain Orchestration (Phase 5)

`src/features/privacy-hub/` is the cross-chain **orchestration** layer. It sits between the app
runtime and the existing `near-intents` adapter:

```
UI → WalletRuntime → PrivacyHub → typed intent → route registry → provider (NearIntentProvider)
   → NearIntentAdapter → STRK20 Shadow Account source execution → NEAR 1Click → solver → Base
```

## What the PrivacyHub is (and is not)

- **IS** an orchestration layer: it validates a typed intent, resolves it to a route + provider,
  and forwards quote/prepare/execute/status.
- **IS NOT** a privacy protocol, a provider, a solver, or a signer. It owns no keys, implements no
  STRK20 / Shadow Account / proving / NEAR HTTP, and adds no privacy.

## Privacy boundary (explicit)

| Segment | Visibility |
| --- | --- |
| Root wallet → STRK20 private balance → Shadow Account | **PRIVATE** (STRK20 is the privacy primitive; the Shadow Account is the private execution identity) |
| Shadow Account → NEAR deposit | **PUBLIC** (on-chain STRK transfer) |
| NEAR solver → destination chain | **PUBLIC** |

The PrivacyHub does **not** make cross-chain transfers anonymous or untraceable. STRK20 remains the
privacy primitive; the Shadow Account remains the private execution identity; NEAR remains the
routing/settlement provider.

## Modules

| Module | Role |
| --- | --- |
| `types.ts` | provider-agnostic `PrivacyHubIntent`, quote/prepared/status/receipt/readiness, `PrivacyHubPhase`, validation |
| `routes.ts` | typed route registry (`PRIVACY_HUB_ROUTES`) + provider capabilities + address kind |
| `provider.ts` | `CrossChainProvider` interface + `NearIntentProvider` (thin `NearIntentAdapter` wrapper) + phase normalization |
| `service.ts` | `PrivacyHub` — validates, resolves route, selects provider, forwards the lifecycle |
| `index.ts` | barrel |

## Route model

The single route remains **Starknet STRK → Base USDC**, resolving to provider `near-intents` with
capabilities `quote/prepare/execute/status/readiness` and destination address kind `evm`. Adding a
second provider later means adding a route entry + a `CrossChainProvider` implementation — the hub,
`WalletRuntime`, and Wallet Core are unchanged.

## Provider interface

```ts
interface CrossChainProvider {
  readonly id: string;
  quote(intent): Promise<PrivacyHubQuote>;
  prepare(intent, quote): Promise<PrivacyHubPrepared>;
  execute(intent, prepared, options?): Promise<PrivacyHubReceipt>;
  status(reference): Promise<PrivacyHubStatus>;
  readiness?(intent): Promise<PrivacyHubReadiness>;
}
```

Provider-specific detail (NEAR asset ids, the deposit address) never crosses the hub boundary: it
travels as an opaque `providerPayload` that only the originating provider reads.

## Status normalization

Provider states are collapsed into: `idle · quoting · preparing · funding · processing ·
destination-pending · success · failed · refunded · unknown`. `SUCCESS` is only reported when the
provider reconciles destination settlement; `unfunded` NEAR states map to `funding`, NEAR
`PROCESSING` maps to `processing`, and `UNKNOWN` stays `UNKNOWN`.

## Mainnet compatibility

The hub is settlement-agnostic. It honors the existing `settlementEnabled` gate (through the
`NearIntentAdapter`), so the hub can run against the Sepolia API layer (quote/prepare/status) today
and execute live mainnet settlement the moment the mainnet STRK20 operator + private paymaster +
funded wallet are provisioned — no hub-architecture change required.

## Runtime bridge

`WalletRuntime` exposes only thin, headless bridges and contains no route/provider/destination logic:

- `quotePrivacyHub(intent)`
- `executePrivacyHub(intent, quote?)` (composes prepare + execute)
- `getPrivacyHubStatus(reference, providerId?)`

## Confidential execution (Phase 6A — provider boundary only)

### Official integration surface (researched 2026-09)

NEAR's **Confidential Intents** is a private-transaction layer on NEAR Intents: a public NEAR chain
(`intents.near`) plus a private NEAR fork **FAR** (`intents.far`) where swaps settle with shielded
balances; a Private PoA Bridge mints/burns IMT tokens across the boundary. A **consumer** can opt in
via the 1Click REST API's `confidentiality` field (`"basic" | "advanced"`) on an otherwise-normal
foreign-to-foreign `ORIGIN_CHAIN → DESTINATION_CHAIN` swap — the request/response is otherwise
identical to a public swap.

### Blocker (verified live, not assumed)

A live probe shows `confidentiality: "basic"` / `"advanced"` return HTTP **401**
`"User authentication is required for confidential intent quotes"`, while `confidentiality:
"public"` succeeds keyless. Confidential quotes require a **User-Session token** from
`/v0/auth/authenticate` — a signed proof of account ownership via NEP-413 / ERC-191 / WebAuthn /
raw-ed25519 / …. NEAR Intents advertises **no Starknet intent-signing standard**, so the current
Starknet Wallet Core account cannot produce that signed message. Direct confidential integration is
therefore **not consumable** by this project's Starknet-only source identity today.

### What was built

Only the boundary (in `src/features/privacy-hub/confidential.ts`): capability metadata
(`source-private`, `destination-public`, `public-settlement`, `confidential-execution`,
`selective-disclosure`) on the route model, an explicit `confidentialIntentAvailability()`
(single source of truth for the blocker), and a `ConfidentialIntentProvider` SEAM whose methods fail
explicitly and is **never registered** in the hub — so there is no fabricated quote/settlement, no
fake HTTP, and no accidental provider fallback.

### Privacy model (exact, no over-claim)

| Layer | Hides | Exposes |
| --- | --- | --- |
| STRK20 | root wallet → private balance | that a shielded note was spent (on-chain pool commits) |
| Shadow Account | root wallet's identity as the application/deposit caller | the shadow address as the on-chain depositor |
| NEAR public Intents | nothing between deposit and settlement | deposit ↔ solver ↔ withdrawal are matchable on-chain |
| NEAR Confidential Intents (not yet used here) | the link between deposit and withdrawal | that a confidential swap happened, at a coarse level |
| Destination chain (Base) | nothing | the destination address, the USDC settlement tx, amount, timing |
| Selective disclosure (not yet used here) | provider-side disclosure controls | whatever the integrator opts to reveal |

The hub claims only what the current protocol guarantees: **source-private, destination-public,
public-settlement** for the live route.
