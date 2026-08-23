# ORRANGE — STRK20 Privacy Wallet × PEL Private Perpetuals

> **Private perpetual futures on Starknet, composed with the real STRK20 privacy pool.**
> Shield USDC → open a private BTC-PERP → realize private PnL/funding/fees → close into a
> shielded payout → unshield later. Positions are proven by Groth16 zk-SNARKs and verified
> by five dedicated on-chain verifiers.

Built by **Jai Bhati** ([@SmratJay](https://github.com/SmratJay)) — Founder of [orrange.xyz](https://orrange.xyz).

[![Cairo Scarb](https://img.shields.io/badge/Cairo%20Scarb-v2.16.1-emerald)](https://scarb.dev)
[![Starknet](https://img.shields.io/badge/starknet-v10.4.0-blue)](https://starknetjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-v15-black)](https://nextjs.org)

---

## 1. What is PEL?

**PEL (Private Execution Layer)** is a zero-knowledge perpetual-futures protocol on Starknet.
Traders deposit **shielded collateral** and open leveraged positions whose **size, entry
price, direction, margin, funding, fees, PnL, and payout** are never publicly disclosed.
Each state transition is a **Groth16 zk-SNARK** whose proof is verified on-chain; only a
**commitment** and a **nullifier** are posted to L2.

## 2. Why do perpetuals need privacy?

Institutional and sophisticated traders face an information asymmetry problem on public
perpetuals venues: their position size, entry, leverage, and liquidation points are visible
to everyone. This lets counterparties, MEV searchers, and market makers front-run or
liquidate them. Privacy prevents this by hiding the position while keeping **solvency and
liquidation cryptographically enforceable**.

## 3. Why STRK20?

**STRK20** is Starknet's native privacy pool (Umbra-style note-based shielded transfers).
It is the authoritative custody + proof layer for shielded USDC on Starknet. PEL composes
with STRK20 so that the **collateral** a trader puts into a perp is a **real shielded note**
spent inside the privacy pool — not a public ERC20 transfer.

## 4. How STRK20 interacts with PEL

The official `@starkware-libs/starknet-privacy-sdk` (vendored at `vendor/`) drives all
shield/unshield/private-transfer against the real pool. PEL composes with the pool through a
canonical **`PELPerpsSTRK20Bridge`** contract that implements the pool's real
external-invocation interface:

```
pool.computeAndInvoke(...)
  identity_key = compute_identity_key(sender, sk, bridge)
  bridge.privacy_compute(identity_key, [marketId, marginCents, ...openProofCalldata]) -> computed
  bridge.privacy_invoke_with_computation(computed, [nonce, ...openProofCalldata])
    -> PELPerpsCore.open_position_shielded(...)   (real Groth16 verification on-chain)
```

The pool spends the trader's shielded note **inside the same proven transaction**, so the
margin is a real private note; the bridge records the position keyed by the pseudonymous
`identity_key` AND relays the proof to `PELPerpsCore.open_position_shielded`, which verifies
the real Groth16 OPEN proof itself and records the on-chain position. On close, the payout is
emitted by `PELPerpsCore.close_position` (authoritative `PositionClosed` event), read back
from chain, and shielded into the pool as a **shielded note** so the trader can unshield later.

> **Canonical user-facing OPEN:** the Perps terminal calls `strk20SdkService.openPerpPosition`
> → STRK20 `PrivateTransfers` → `computeAndInvoke` → bridge → Core. The direct
> `PELPerpsCore.open_position` (ERC20 `transfer_from`) path is NOT used by the UI; the
> dispatcher's legacy branches are explicitly isolated for historical tests only.
> The STRK20 viewing key is derived from the wallet signer (never fabricated — fail closed).

## 5. What data is private

- Trader identity (pseudonymous identity key, not wallet address)
- Position size, entry price, direction
- Margin, funding, fees, PnL, payout
- Any linkage between position ↔ entry ↔ recipient

## 6. What data remains public

- The position **commitment** and **nullifier** (state on L2)
- Market, oracle price, protocol parameters
- Accounting bucket totals (locked collateral, LP NAV, insurance, unclaimed payouts/bounties)
- Whether a position exists and is active (but not its economics)

## 7–11. How OPEN / UPDATE / FUND / CLOSE / LIQUIDATE work

All five operations follow one canonical pattern: **generate a Groth16 proof → verify it
on-chain with the dedicated verifier → apply the Cairo state transition (commitment +
nullifier rotation) → settle accounting**. Replay is prevented by the nullifier registry.

| Op | Proof | Public inputs (bound) | State transition |
|----|-------|-----------------------|------------------|
| **OPEN** | `pel_open.circom` | commitment, marginNullifier, marketId, margin, oraclePrice | lock margin, store position |
| **UPDATE** | `pel_update.circom` | oldCommitment, newCommitment, oldNullifier, marketId | rotate commitment |
| **FUND** | `pel_fund.circom` | oldCommitment, newCommitment, oldNullifier, marketId, oraclePrice, fundingRate, intervals, fundingPayment, isLongPays | clear funding |
| **CLOSE** | `pel_close.circom` | commitment, finalNullifier, payoutCommitment, payoutAmount, marketId, oraclePrice, recipient | settle PnL, shielded payout |
| **LIQUIDATE** | `pel_liquidate.circom` | positionCommitment, positionNullifier, marketId, oraclePrice, keeper, seizedCollateral, badDebt | seize collateral, bounty + LP/insurance/treasury + bad-debt waterfall |

The **LIQUIDATE** circuit proves `equity <= maintenance` without revealing the operands and
outputs the **proof-bound `seizedCollateral` and `badDebt`** consumed by the vault's
settlement waterfall.

## 12. How keepers work

The keeper is an **escrowed-witness liquidator** (`keeperWitnessStore.ts`). At open, the
position witness is escrowed to the keeper (encrypted at rest). The keeper polls the oracle,
detects `equity <= maintenance`, builds the liquidation proof, and submits it — **without the
trader's browser or wallet being online**. It uses an async polling loop with exponential
backoff, bounded concurrency, idempotency, and graceful shutdown (not a bare `setInterval`).

> **Honest trust note:** the LIQUIDATE circuit proves the predicate over private inputs, so a
> keeper must hold the escrowed witness. This makes the keeper **semi-trusted** (it can read
> the witnesses it escrows, though the position stays private on-chain and to all others).
> A fully trustless keeper requires a circuit redesign (e.g. encrypted-liquidity or
> dealer/insurance-mediated liquidation). See `docs/` for the analysis.

## 13. How LPs work

The **`PELLiquidityVault`** is the canonical LP counterparty and custody boundary. LPs
deposit USDC and receive proportional shares at a NAV-based share price (share price e6 =
NAV × 1e6 × 1e4 / totalShares). LP value is the counterparty to trader PnL:

- **Trader loss → LP receives the FULL loss** (no 70/20/10 split on PnL).
- **Trader profit → LP pays the FULL profit** (insurance backstops, then fail-closed revert).
- **Protocol revenue** (liquidation remnants) is split 70% LP / 20% insurance / 10% treasury.

Withdrawals are **reserve-aware** (Model A queue): shares are burned at request, NAV is
reduced by the frozen value at request, and a 50% locked-margin reserve floor protects open
interest. Protocol-enforced risk gates (utilization ≤ 85%, single-position cap ≤ 5% NAV
notional) are checked on-chain by the vault, not the browser.

## 14. How insurance works

`PELInsuranceReserve` is a **real USDC custody contract**: its booked balance is always backed
by tokens it physically holds. Liquidation seizes collateral and runs a waterfall:

1. **Trader loss** (margin − seized) → 100% LP NAV.
2. **Seized collateral** → 2% keeper bounty → 70% LP / 20% insurance (real transfer) / 10% treasury.
3. **Bad debt** (`equity < 0`) → insurance absorbs real USDC; any uncovered remainder is
   recorded as explicit `bad_debt_total` and absorbed by LP NAV (never silently clamped).

No value is created from nothing — every transition conserves token custody against the
accounting buckets (locked margin + pool margin + NAV + payouts + bounties + withdrawals +
treasury + bad debt).

## 15. How proofs work

Circuits are written in **Circom** (`circuits/*.circom`) and compiled to R1CS + zkey with
**snarkjs**; witnesses + Groth16 proofs are generated client-side (`pelCircuitService.ts`);
calldata is produced by **Garaga** and verified on-chain by five **distinct** Garaga
`Groth16VerifierBN254` contracts (one per circuit). Verifiers are nonzero and pairwise
distinct (fail-closed validation).

## 16–17. Run locally / tests

```bash
npm install
# Start a Starknet devnet (e.g. starknet-devnet on :5050)
npx vitest run tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts   # real Groth16 OPEN on devnet
npx vitest run tests/e2e/REAL_LIFECYCLE_E2E.test.ts      # OPEN→CLOSE→LIQUIDATE conservation
npx vitest run --exclude tests/e2e                       # unit/integration/adversarial suites
npm run typecheck
cd contracts && scarb build                             # Cairo contracts (compiles)
cd contracts && snforge test                             # Cairo LP/vault/adapter integration tests
cd crates/pel-risk-engine && cargo test                  # Rust risk engine + golden vectors
```

## 18. Deploy

```bash
# Devnet: deploys five verifiers + core + adapter + oracle + bridge + set_bridge wiring
npx vitest run tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts
# Sepolia / Mainnet: fill deployments/sepolia.json and deployments/mainnet.json, then run
# the deployment scripts (see scripts/ and the Deployment checklist in docs/).
```

Startup config validation (`validateDeploymentConfig`) fails closed when:
- any of the five verifiers is unset/zero/duplicated, or
- PEL collateral token != STRK20 Sepolia USDC (one canonical collateral everywhere).

## 19. Verify contracts

Verify each class on the explorer. Confirm the five verifiers are distinct, the Core points
to the correct verifier per circuit, and the bridge is wired to the pool + Core.

## 20. Reproduce the demo

1. Shield USDC into the STRK20 pool (requires the operator proving + discovery services —
   `infra/strk20-operator/README.md`).
2. Open a private BTC-PERP via the bridge (real shielded collateral).
3. Watch the on-chain position confirm, move price, then close into a shielded payout.
4. Unshield later.

---

## Architecture diagram

```
                          REAL STRK20 PRIVACY POOL (custody + proof)
   ┌─────────────────────────────────────────────────────────────────────┐
   │  shielded USDC notes  →  shield / private-transfer / unshield       │
   │  computeAndInvoke → PELPerpsSTRK20Bridge (privacy_compute /         │
   │                       privacy_invoke_with_computation)              │
   └───────────────┬─────────────────────────────────────────────────────┘
                   │ identity_key (pseudonymous) + shielded note spent
                   ▼
   PELPerpsSTRK20Bridge ── verifies OPEN/CLOSE Groth16 proofs ──► 5 × Groth16VerifierBN254
                   │ records in-pool collateral, emits shielded payout notes
                   ▼
   PELPerpsCore (state machine: OPEN/UPDATE/FUND/CLOSE/LIQUIDATE)
                   │   ▲
                   ▼   │ oracle price (freshness + proof-bound)
   STRK20Adapter ─ LP NAV / insurance / bounties / payouts  ◄── OracleAdapter (Pragma)
                   ▲
                   │
   Autonomous Keeper (escrowed-witness liquidator) + Position Indexer
```

## Accounting model (deterministic integers)

- **USDC base units**: 6 decimals, `1 USDC = 1_000_000 units`
- **Internal accounting**: USD cents, `1 USDC = 100 cents`
- **Conversion**: `1 cent = 10_000 USDC base units`
- **BTC quantity**: sats, `1 BTC = 100_000_000 sats`
- **Price**: USD cents
- **Invariant**: `token.balanceOf(adapter) >= (locked + LP_NAV + insurance + unclaimed_payouts + unclaimed_bounties) * 10_000`

All protocol math uses **bigint integers**; floats are display-only in the frontend.

## Security notes (trust assumptions)

- **Admin** can update: oracle adapter, STRK20 adapter, the five verifiers, pool, Core
  reference. These are documented single-role (`admin`) functions. No hidden backdoors.
- **The keeper is semi-trusted** (see §12). Real STRK20 execution requires the operator
  proving + discovery services.

## Deployment manifests

`deployments/sepolia.json` and `deployments/mainnet.json` are the authoritative,
documented sources of truth. Addresses may be overridden by env vars but the manifests are
canonical. `strk20.json` tracks real contracts and transactions (never fabricated).

## 25. STRK20 operator health

`src/services/strk20OperatorHealth.ts` reports honest operator status (`HEALTHY` /
`UNAVAILABLE` / `UNCONFIGURED`) by probing `NEXT_PUBLIC_STRK20_PROVER_URL` and
`NEXT_PUBLIC_STRK20_DISCOVERY_URL` `/health` endpoints and checking the SDK loads. The Perps
UI surfaces this; privacy operations fail closed (never fake privacy behavior) when the
operator is missing. `infra/strk20-operator/` provides a deterministic docker-compose +
`.env.example`.

## 26. Legacy isolation

The fact-based relayer (`src/app/api/relayer/execute/route.ts`) is **disabled by default** —
it requires the explicit opt-in `NEXT_PUBLIC_ENABLE_LEGACY_RELAYER=1`. The canonical
user-facing flows (STRK20 private invoke for OPEN; direct wallet-signed CLOSE/UPDATE/FUND)
never use it. Legacy dispatcher branches are marked LEGACY-ONLY and are only reachable by
historical tests.

## 27. The two STRK20 integration lanes

There are intentionally **two** STRK20 lanes in this app — do not merge them.

### LANE A — Generic STRK20 wallet UX (privacy wallet → Wallet API)

```
privacy-enabled wallet (Wallet API >= 0.10, e.g. Ready)
  └─ wallet_strk20InvokeTransaction / wallet_strk20Balances
       └─ Shield (deposit) / Private Send (transfer) / Unshield (withdraw)
```

- Implemented in `src/services/strk20WalletApiService.ts` + `Strk20WalletLaneGate`.
- The **wallet** owns viewing keys, channels, notes, SNIP-36 proof generation, and the pool
  interactions. The app never touches viewing keys, never reconstructs notes, never writes
  financial state to `localStorage`, and never falls back to public ERC-20 transfers.
- Private balances come from `wallet_strk20Balances`; a wallet that is not STRK20-capable (or
  a wrong chain) fails closed with clear guidance.
- The Wallet API adds its own fee action; deposit is two wallet prompts (approve + deposit).

### LANE B — PEL private perps (raw SDK → ComputeAndInvoke → PEL bridge → PEL Core)

```
raw Privacy SDK (PRIVACY-0.14.3-RC.5 vendored)
  └─ computeAndInvoke
       └─ PELPerpsSTRK20Bridge.privacy_compute / privacy_invoke_with_computation
            └─ PELPerpsCore.open_position_shielded
```

- Used only for the PEL private OPEN path (`strk20SdkService.openPerpPosition`).
- Requires the operator **proving + discovery** stack (RC.2 prover + RC.2 discovery +
  Pathfinder v0.22.7) — see `infra/strk20-operator/README.md`.
- The PEL prover problem is **not** solved in this codebase; the PEL OPEN remains an advanced
  operator path.

## Real-network status

- **Devnet**: verified — five distinct verifiers, real Groth16 OPEN proof verified on-chain,
  bridge `privacy_compute`/`privacy_invoke_with_computation` verified on-chain with a real
  proof.
- **Devnet LP counterparty**: verified — `PELLiquidityVault` + `PELInsuranceReserve` deployed
  and wired to `PELPerpsCore`; real Cairo tests (deposit/shares, PnL, funding, liquidation
  waterfall, insurance custody, bad debt, withdrawal queue, risk gates, conservation) pass via
  `snforge test`; Rust risk engine + golden vectors pass via `cargo test`.
- **Generic STRK20 (Shield / Private Send / Unshield / Private balance)**: runs through a
  **privacy-enabled wallet** (Wallet API lane) on Starknet Sepolia — no app-side operator
  required. Requires a STRK20-capable wallet (e.g. Ready).
- **PEL private OPEN on Sepolia**: **PENDING** — requires the operator proving + discovery
  services (external infrastructure) and funded accounts. See
  `infra/strk20-operator/README.md` and the final engineering report for the exact steps.
