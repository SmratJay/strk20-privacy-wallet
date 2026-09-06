# STRK20 / Operator Compatibility Matrix

Exact versions and addresses the ORRANGE Wallet Core STRK20 integration targets. Do NOT silently
upgrade or change these — the adapter and tests are pinned to them.

## SDK / library revisions

| Component | Version | Where pinned | Notes |
|---|---|---|---|
| `@starkware-libs/starknet-privacy-sdk` | **`0.14.3-rc.5`** (vendored build of `github.com/starkware-libs/starknet-privacy`, `sdk/` @ tag `PRIVACY-0.14.3-RC.5`) | `vendor/starknet-privacy-sdk/package.json`, `package.json` (`file:vendor/...`) | The ONLY SDK surface the adapter targets. Tests assert the app only imports APIs exported by this revision (`createPrivateTransfers`, `IndexerDiscoveryProvider`, `Open`). |
| `starknet.js` | **`10.5.0`** | `package.json` (app + vendored SDK dependency) | SDK/app parity enforced by test. |
| `@avnu/avnu-sdk` | `^4.2.0` | `package.json` | Public AVNU swap quotes/calls (see `src/services/swapService.ts`). The AVNU SDK's private-swap API is NOT usable: Sepolia has zero AVNU liquidity, and the prover requires a starknet.js `WalletAccountV6` the Wallet Core account is not. The REAL private swap uses the repo's own BondingCurve V2 via the STRK20 shadow-account path. |

## Current upstream compatibility matrix (official, 2026-09)

The official `starkware-libs/starknet-privacy` matrix pins all components in one row. Orrange's
vendored SDK is `0.14.3-rc.5` — **one patch behind** the matrix's `PRIVACY-0.14.3-RC.6`.

| Component | Matrix tag |
|---|---|
| Transaction Prover | `PRIVACY-0.14.3-RC.2` |
| Proof Interceptor | `PRIVACY-0.14.3-RC.6` |
| Discovery Service | `PRIVACY-0.14.3-RC.2` |
| Pathfinder | `eqlabs/pathfinder:v0.22.7` (`PATHFINDER_STORAGE_STATE_TRIES=10000`) |
| SDK | `PRIVACY-0.14.3-RC.6` |

**Mainnet action:** before relying on mainnet execution, either prove `0.14.3-rc.5` against the
mainnet deployment or make the smallest change (vendored SDK → `PRIVACY-0.14.3-RC.6`) and re-run
the full suite. No broad dependency upgrade is planned.

## Mainnet prover (Starkscan relay)

The mainnet proving service is the **Starkscan STRK20 prover relay** (`api.starkscan.co/v1/SN_MAIN`,
mainnet-only, operator-issued, async job+poll). The browser SDK expects a synchronous
`starknet_proveTransaction` JSON-RPC, so Orrange proxies it server-side:

- `src/app/api/starkscan/prove/route.ts` — server route (holds `STARKSCAN_API_KEY`; never in browser).
- `src/services/starkscanProver.ts` — async submit+poll client (X-Starkscan-Api-Key, Idempotency-Key).
- `GET /api/starkscan/prove` — auth probe: `401=unauthenticated`, `403=forbidden (no scope)`,
  `404=dormant`, else `authenticated`. Verified live against the relay (dummy key ⇒ 401).

Mainnet proving is async and can hold a prover slot for minutes ⇒ mainnet resolves
`proverTimeoutMs = 15 min`; Sepolia stays at the fast synchronous default.

## Operator / on-chain configuration (Sepolia)

| Item | Config source | Expected (Sepolia) | Notes |
|---|---|---|---|
| STRK20 pool | `NEXT_PUBLIC_STRK20_SEPOLIA_POOL` (default `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`) | deployed (class hash verified on-chain by real-network test) | RC5-compatible pool. |
| Proving service | `NEXT_PUBLIC_STRK20_PROVER_URL` | reachable STWO prover | Proves against `currentHead - PROVING_SAFETY_MARGIN` (10 blocks). |
| Discovery service | `NEXT_PUBLIC_STRK20_DISCOVERY_URL` | reachable indexer (`/v1/sync/*`) | Direct HTTPS by default; OHTTP via `NEXT_PUBLIC_STRK20_DISCOVERY_OHTTP=true` when the operator supports it. |
| Fee token | constant `STRK_TOKEN_ADDRESS` | STRK | Pool charges `get_fee_amount()` per `apply_actions`. |
| Shadow-account anonymizer | `NEXT_PUBLIC_STRK20_ANONYMIZER_SEPOLIA` (per network) | RC5-compatible anonymizer contract | PUBLIC config, network-scoped, never a server secret. Empty ⇒ private-identity creation reports explicit unavailability. |
| Ready account class hash | `NEXT_PUBLIC_READY_CLASSHASH` (default `0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f`) | verified on-chain | Used for counterfactual derivation + deployment. |

## Deployment-specific fee-bounds (NOT universal Starknet defaults)

`Strk20Adapter.resolveResourceBounds()` fallback (used only when the node rejects the PROOF0
proof version during fee estimation) hardcodes the following `max_amount` caps, valid for the
current Sepolia STRK20 deployment:

- L2 gas `max_amount`: `1_210_000_000`
- L1 gas `max_amount`: `1`
- L1-data gas `max_amount`: `10_000`
- `max_price_per_unit`: live block gas price × 2 (headroom)

These are NOT generic Starknet defaults and must be revisited for any other network/pool.

## Viewing key

`ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1` — frozen, deterministic
`canonicalize(poseidon(masterSecret, starknetKeccak(domain:<network>)))`. This is Orrange's
wallet-level derivation, not a STRK20 protocol-mandated KDF. Do not change it or add a second
derivation (see `src/wallet/privacy.ts`).