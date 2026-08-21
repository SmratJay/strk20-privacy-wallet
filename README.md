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
  bridge.privacy_invoke_with_computation(computed, [nonce])
```

The pool spends the trader's shielded note **inside the same proven transaction**, so the
margin is a real private note; the bridge records the position keyed by the pseudonymous
`identity_key`. On close, the payout is emitted back into the pool as a **shielded note**
so the trader can unshield later.

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
| **LIQUIDATE** | `pel_liquidate.circom` | positionCommitment, positionNullifier, marketId, oraclePrice, keeper | seize collateral, bounty + insurance |

The **LIQUIDATE** circuit proves `equity <= maintenance` without revealing the operands.

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

The `STRK20Adapter` is a proportional LP pool. LPs deposit USDC and receive shares at a NAV
share price. LP value is the counterparty to trader PnL. Withdrawals are **reserve-aware**:
LPs cannot withdraw value required to cover open interest (50% reserve floor).

## 14. How insurance works

Liquidation seizes collateral: 2% goes to the keeper bounty, 98% to the insurance fund. The
insurance fund backs trader profits when LP NAV is insufficient. No value is ever created
from nothing — every transition conserves token custody against accounting buckets.

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
npx vitest run                                          # full suite
npm run typecheck
cd contracts && scarb build                             # Cairo contracts
```

## 18. Deploy

```bash
# Devnet: deploys five verifiers + core + adapter + oracle + bridge (scripts/deploy_perps_devnet.ts)
npx vitest run tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts
# Sepolia / Mainnet: fill deployments/sepolia.json and deployments/mainnet.json, then run
# the deployment scripts (see scripts/ and the Deployment checklist in docs/).
```

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

## Real-network status

- **Devnet**: verified — five distinct verifiers, real Groth16 OPEN proof verified on-chain,
  bridge `privacy_compute`/`privacy_invoke_with_computation` verified on-chain with a real
  proof.
- **Sepolia / Mainnet STRK20 shield/perp execution**: **PENDING** — requires the operator
  proving + discovery services (external infrastructure) and funded accounts. See
  `infra/strk20-operator/README.md` and the final engineering report for the exact steps.
