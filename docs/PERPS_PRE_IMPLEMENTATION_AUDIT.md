# PEL / STRK20 Privacy Wallet — Pre-Implementation Audit (PHASE 0)

Audited commit: `c4654351a20ab8446e43391a53466b5b94df9220`
Date: 2026-08-21

PHASE 0 deliverable. Maps the actual architecture and execution paths, and
independently re-verifies every prior-audit finding against current code.
Labels: CONFIRMED / PARTIAL / NOT CONFIRMED, with `file:line` evidence.

---

## 1. Actual Architecture

There are **two parallel, mutually inconsistent stacks**.

### Stack A — "Real Groth16" (intended end-state)

```
circom witness (circuits/pel_*.circom)
  → snarkjs groth16.fullProve (src/services/pelCircuitService.ts)
  → Garaga calldata (garaga.getGroth16CallData)
  → starknetPerpsDispatcher (src/services/starknetPerpsDispatcher.ts)
  → PELPerpsCore.{open,update,fund,close,liquidate}_position
  → dedicated Groth16VerifierBN254.verify_groth16_proof_bn254 → Result<Span<u256>, felt252>
  → public inputs drive economics
  → STRK20Adapter (ERC20 custody / LP / insurance accounting)
```

Real. `pelCircuitService.ts` does genuine witness generation + `snarkjs.groth16.fullProve`
(`pelCircuitService.ts:277-281`, `:414-418`). The five circuit verifiers exist as distinct
Garaga-generated contracts with distinct VKs (see §3).

### Stack B — "Legacy fabricated-fact" (what the shipped UI/scripts mostly use)

```
zkProverService.generate*Fact (Poseidon fact hashes ONLY, no proof)
  → StwoVerifier (fact registry) verify_*_fact / register_*_fact
  → perpsService / factRegistryDispatcher / lifecycle scripts
```

`zkProverService.ts` produces Poseidon hashes and labels them `POSEIDON_SNIP36_FACT_VALID`
(`zkProverService.ts:632`). No proof is produced or verified. `perpsService.ts` (main UI
orchestrator) uses this stack and never persists a real witness. `ownerSecret` is set to the
public wallet address (`zkProverService.ts:564,579`).

The two stacks use different domain separators (`zkProverService.ts:101` vs
`types.ts:10` vs `canonical.ts:73`), so commitments from the two stacks do not match.

### Contract inventory (`contracts/src/`)

| Contract | Role | Status |
|---|---|---|
| `PELPerpsCore` | State machine, 5 verifier slots, nullifier registry | Structurally correct |
| `STRK20Adapter` | ERC20 custody, LP pool, insurance, payouts | Accounting bugs (P0 #4/#5) |
| `OracleAdapter` | Price feed, freshness + deviation breaker | Real |
| `Groth16VerifierBN254` iface + `Groth16MockVerifier` | interface + mock | Mock present (P0 #2) |
| `StwoVerifier` | Poseidon fact registry | Legacy Stack B |
| `TestUSDC` | 6-dec ERC20 collateral | Real |
| `types.cairo` | MarketConfig / PositionRecord | Real |

### Verifier contracts (`contracts/verifiers/pel_*_verifier/`)

Five Garaga 1.1.0 Groth16 verifiers exist, one per circuit. Their
`groth16_verifier_constants.cairo` files have **distinct** md5 (verified):
open `2c6b1644…`, update `d2562c38…`, fund `894729a4…`, close `2d57e7bc…`,
liquidate `85c5c28a…`. Shared `groth16_verifier.cairo` is byte-identical and exposes
`verify_groth16_proof_bn254(Span<felt252>) -> Result<Span<u256>, felt252>`.
**None of the five verifiers is deployed by any script in the repo.**

### Deployment inventory

Every deploy script (`deployClean.mjs`, `deployAllContracts.mjs`, `deployContracts.mjs`,
`deployInstances.mjs`, `deploySepolia*.mjs`, `deployUpgraded.mjs`, `deployHardenedV2.mjs`,
`declareAllRemaining.mjs`) deploys 4 contracts: `StwoVerifier`, `OracleAdapter`,
`STRK20Adapter`, `PELPerpsCore` — wiring **StwoVerifier (a fact registry) into the
verifier slot** of PELPerpsCore. `deploy_open_e2e.ts` deploys `Groth16MockVerifier`
(`deploy_open_e2e.ts:141`) and programs it via `set_mock_public_inputs`
(`:239-241`).

### Key execution paths

- Real OPEN path exists only in `deploy_open_e2e.ts` (devnet, mock verifier) and
  `sepolia_perps_e2e.ts` (real proof, but dispatcher verifier addr = StwoVerifier).
- Real circuits compile; artifacts in `circuits/build/` (`.r1cs`, `.zkey`, `.wasm`, VK JSON).
- No script deploys the 5 real verifiers.

---

## 2. Confirmed Bugs / Findings (independent re-verification)

### P0 #1 — Verifier wiring: CONFIRMED

`src/services/starknetPerpsDispatcher.ts:29-34` maps all five verifier addresses to the
same hardcoded `0x4a750f879b518129e9c2a3152c806238ce48ed7200a8f9de01fb789f0c1cdde`
(which is also `stwoVerifierAddress`, `:34`). `scripts/deploy_perps_local.ts:46-50` repeats
the same single address. No distinct-address deployment manifest exists.

### P0 #2 — Mock verifier in E2E: CONFIRMED

`scripts/deploy_open_e2e.ts` deploys `Groth16MockVerifier` (`:141-146`), calls
`set_mock_public_inputs` (`:239-244`) with the proof's public signals, then asserts
`verify_groth16_proof_bn254` returns ≥8 fields (`:246-253`). No real Groth16 verification.

### P0 #3 — OPEN entry price not oracle-bound: CONFIRMED

`circuits/pel_open.circom:74` public inputs are `[commitment, marginNullifier, marketId, margin]`
— **no oraclePrice, no entryPrice**. `PELPerpsCore.open_position` reads the oracle for
freshness only (`pel_perps_core.cairo:250-252`); it never checks `|entry-oracle|/oracle <= deviation`.
`validatePriceDeviation` exists in `fixedPoint.ts:184` but is never enforced on-chain or in the circuit.

### P0 #4 — Close collateral accounting: CONFIRMED

`STRK20Adapter.release_shielded_payout` (`strk20_adapter.cairo:241-282`) deducts only
`margin_portion = amount - profit_amount` from `total_locked_collateral`. For a losing close
(`payout < locked_margin`), `profit_amount = 0` so only `payout` is deducted; the residual
`locked_margin - payout` remains stranded in `total_locked_collateral`. `collect_insurance_contribution`
(trader loss → LP NAV, `:374-388`) is **never called** from `close_position`.

### P0 #5 — Liquidation / bad-debt accounting: PARTIAL

Circuit correctly proves `equity <= maintenance` (`pel_liquidate.circom:135-145`). But
`liquidate_position` (`pel_perps_core.cairo:468-529`) does not itself check equity/maint
(relies on circuit), and the adapter seizes a flat 2% keeper bounty + 98% to insurance
(`:511-521`). No bad-debt deficit tracking, no LP-loss accounting, no distinction between
healthy/underwater/deeply-underwater beyond the circuit predicate. `riskEngine.ts:209`
has `BadDebtWaterfall` but it is not wired to Cairo.

### P0 #6 — Relayer security: CONFIRMED

`src/services/relayerSecurity.ts:26` allowlists `approve` with attacker-controlled
`spender` + `amount` (`:90-93`). Collateral token is an allowlisted contract
(`:109`). No authentication on the endpoint (`route.ts:15-90`): no API key/signature;
`validateRelayerCalls` is called with no `clientId` (`route.ts:21`) so rate limiting is global.

### P0 #7 — Funding interval authorization: CONFIRMED

`pel_perps_core.cairo:422` computes `max_allowed_intervals = (time_elapsed / interval) + 1`
(the unjustified `+1`). `new_funding_timestamp = last + intervals*interval` (`:440`) may
overshoot `now`. `intervalsElapsed` is a public input constrained only by `<= max_allowed`,
not by a canonical floor rule shared across circuit/Cairo/TS.

### P0 #8 — Private liquidation architecture: CONFIRMED (limitation, not solved)

`keeperService.ts:119-122` calls `findWitnessByCommitment` which scans all
`pel_witness_v2_*` localStorage namespaces (`witnessStore.ts:194-222`). The keeper requires
the user's private witness and therefore is a client-browser keeper, not permissionless.

### P1 #9 — Witness storage encryption: CONFIRMED

`witnessStore.ts` stores `ownerSecret`/nonce in **plaintext** localStorage
(`writeRaw:111-117`; `saveWitness`/`loadAllWitnesses` path `:155-178`). AES-GCM exists only
in `exportWitnesses`/`importWitnesses` (`:267-309`) and only when a signature is supplied.

### P1 #10 — STRK20 note privacy: CONFIRMED

`vaultService.ts:239-250` stores notes plaintext in localStorage; `:128` fabricates
`blockNumber = 13540000 + nextIndex`; `viewingKeyService.ts:24` derives the viewing key from
the public address (via `vaultService.ts:100`), so it is publicly recomputable.

### P1 #11 — Position decoding: CONFIRMED

`PositionRecord` has 8 fields (`types.cairo:41-50`): `commitment, margin_nullifier,
locked_margin, market_id, created_at, updated_at, last_funding_timestamp, is_active`.
`starknetPerpsDispatcher.getPositionOnChain` reads `res[5]` as `is_active`
(`starknetPerpsDispatcher.ts:381-388`); index 5 is `updated_at`, and `is_active` is index 7.

### P1 #12 — Transaction finality: CONFIRMED

`starknetPerpsDispatcher.executeOnChain` returns `status: 'PENDING'` immediately after
`account.execute` (`:399-417`); it never waits for acceptance. Several callers treat the
returned tx hash as success.

### P1 #13 — Frontend witness persistence: CONFIRMED

`perpsService.ts` imports `saveWitness`/`loadWitness`/`deleteWitness` (`:10`) but never
calls them; `openPosition` persists only a local `PerpPosition` with a fabricated fact
(`:242-262`). Witness is not persisted after on-chain confirmation.

### P1 #14 — Protocol constant drift: CONFIRMED

- Protocol version: `types.ts:17` = 2, `canonical.ts:71` = 3, Cairo `config_version` = 3.
- Leverage: circuit `MAX_LEVERAGE_BPS = 500500` (50.05x) vs Cairo `max_leverage = 50`.
- Oracle age: `canonical.ts:84` = 60s vs `canonical.ts:96`/Cairo/OracleAdapter = 180s.
- Domain separators disagree (`types.ts:10` vs `canonical.ts:73` vs `zkProverService.ts:101`).

### P1 #15 — Fee enforcement: CONFIRMED

`pel_close.circom` `fees` is a free private input (no canonical constraint);
`pel_open.circom` has no fee; `PELPerpsCore` never enforces taker/maker fees on-chain.

### P1 #16 — Indexer correctness: CONFIRMED

`positionIndexerService.ts` and `daemonIndexerService.ts` disagree on event data layout
(`PositionOpened` field indices, `PositionLiquidated.keeper` at data[2] vs data[3]).
`daemonIndexerService.handleReorg` (`:198-230`) is never invoked; `lastBlockHash` is never
updated from chain. Reorg rollback is dead code.

### P1 #17 — Router / Earn / Portfolio honesty: CONFIRMED

`routerService.ts` uses hardcoded routes/fees/gas (simulated). `earnService.ts` uses
hardcoded APY/TVL and localStorage deposits (simulated). `avnuService.ts` is real with a
simulated fallback. No explicit REAL/SIMULATED documentation exists in the UI.

---

## 3. Cryptographic Correctness of the Five Verifiers (verified)

- Five generated verifier contracts exist; constants are distinct (VKs differ).
- Entry point matches the PELPerpsCore interface (`verify_groth16_proof_bn254`).
- Verifier Scarb uses ECIP ops class hash `0x396d5915…` (shared library class).

Gap: no deployment script declares/deploys these five; no manifest maps the five
distinct addresses into PELPerpsCore.

## 4. Test Coverage (summary)

- Unit: `tests/riskEngine.test.ts`, `tests/circuits/*`, `tests/factRegistry.test.ts`,
  `tests/lpNavEconomics.test.ts`, `tests/collateralCustody.test.ts`,
  `tests/invariants/assetConservation.test.ts`, `tests/indexerAndKeeper.test.ts`,
  `tests/strk20Crypto.test.ts`, `tests/pelRouter.test.ts`, `tests/pelPerpsEngine.test.ts`.
- Integration: `tests/integration/*` (realCairoContractIntegration, PEL_REAL_E2E,
  PEL_REAL_LIQUIDATION_E2E, fullContractIntegration).
- E2E: `tests/e2e/*` (REAL_OPEN_E2E, fullLifecycle, liquidationPath).
- Adversarial: `tests/adversarial/*`.
- Gaps: no test asserts the 5 verifier addresses are distinct/nonzero; no real deployed
  Groth16 verifier E2E; mock verifier dominates the on-chain test paths.

## 5. Dependencies / Build

- Node/Next 15, `starknet@10.4`, `snarkjs@0.7.6`, `circomlib@2.0.5`, `circomlibjs@0.1.7`,
  `garaga@1.1.0`; Scarb `pel_perpetuals_core` with `starknet >=2.8.0`.
- Scripts: `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run circuit:build`.
- Cairo tests: `scarb test` / `snforge test` (in `contracts/`).

## 6. Priority Implementation Order (agreed with mission)

1. PHASE 1 — deploy + wire five distinct verifiers; remove mock from real E2E; real OPEN E2E.
2. PHASE 2 — economic correctness (oracle binding, funding timing, fees, close/liquidation).
3. PHASE 3 — real proof E2E for UPDATE/FUND/CLOSE/LIQUIDATE.
4. PHASE 4 — security hardening (relayer, witness encryption, viewing keys, finality, indexer).
5. PHASE 5 — keeper honesty.
6. PHASE 6 — canonical constants + docs + final suite.
