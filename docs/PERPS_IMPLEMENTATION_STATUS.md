# PEL Perps Implementation Status

Live log of implementation work. Updated after every major modification (RULE 10).

## 2026-08-21 — PHASE 0 + PHASE 1 (start)

### PHASE 0 — Pre-Implementation Audit (COMPLETE)

- Produced `docs/PERPS_PRE_IMPLEMENTATION_AUDIT.md`: full architecture map, two-stack
  analysis (real Groth16 vs legacy Poseidon-fact), and independent re-verification of
  all 18 prior-audit findings.
- Key verified facts:
  - Five Garaga 1.1.0 Groth16 verifier contracts exist with distinct VKs
    (`contracts/verifiers/pel_{open,update,fund,close,liquidate}_verifier/`) but are
    **not deployed by any script**.
  - Dispatcher mapped all 5 verifier slots to one address (the StwoVerifier fact registry).
  - All deploy scripts wire `StwoVerifier` into PELPerpsCore's verifier slots.
  - `deploy_open_e2e.ts` + `tests/e2e/REAL_OPEN_E2E.test.ts` use `Groth16MockVerifier`.
  - OPEN circuit has no oracle/entry-price public input (P0 #3).
  - Close accounting strands residual margin (P0 #4); liquidation has no bad-debt model (P0 #5).
  - Relayer allowlists `approve` with attacker-controlled spender/amount (P0 #6).
  - Funding interval `+1` bug (P0 #7).
  - Plaintext witness storage (P1 #9); public-address viewing key (P1 #10);
    `is_active` read at wrong index in `getPositionOnChain` (P1 #11);
    PENDING-not-final execution (P1 #12); fabricated-fact `zkProverService` (P1 #13/#15);
    constant drift v2/v3 + 50x/50.05x + 60s/180s (P1 #14); indexer divergence + dead reorg (P1 #16);
    simulated router/earn (P1 #17).

### PHASE 1 — Cryptographic verifier wiring (DONE — real OPEN E2E passing)

Changes applied:

1. `src/services/starknetPerpsDispatcher.ts`
   - Removed the shared hardcoded fallback for the 5 verifier addresses; they now
     fail-closed (empty string when unset) and are loaded only from
     `NEXT_PUBLIC_{OPEN,UPDATE,FUND,CLOSE,LIQUIDATE}_VERIFIER_SEPOLIA`.
   - Added `validateVerifierAddresses(config)` enforcing nonzero + pairwise-distinct
     verifier addresses.

2. `src/services/pelCircuitService.ts`
   - `generateGaragaCalldata` no longer silently falls back to mock calldata on error;
     it now throws. Real proofs must produce real Garaga calldata.
   - `generateLiquidateProof` no longer swallows calldata-generation errors.
   - Removed dead `encodeMockGroth16Calldata`.

3. Built the five REAL Garaga Groth16 verifiers.
   - Installed scarb 2.16.1 (asdf) — the pinned toolchain from the verifiers' `.tool-versions`.
   - Set `casm = true` in the 5 verifier Scarb.toml (was `false`, which produced a
     non-declarable casmless class on devnet).
   - Repointed the verifiers' `ECIP_OPS_CLASS_HASH` from the canonical `0x396d5915…`
     (only pre-declared on Sepolia/Mainnet) to the locally-built `universal_ecip` class
     hash `0x68cb2d4c…` so the protocol is fully self-contained on a fresh devnet.
     (The ECIP class is an implementation detail of the verifier; the canonical hash
     mismatch is because the vendored garaga_pkg source differs from the deployed ECIP.)

4. New: `scripts/deploy_perps_devnet.ts` — clean deployment pipeline (ECIP → 5 verifiers
   → TestUSDC → Oracle → STRK20Adapter → PELPerpsCore wired to 5 distinct verifiers →
   cross-contract wiring → oracle publish → collateral mint/approve), writes
   `deployments/perps-local.json`.

5. New: `tests/e2e/REAL_GROTH16_OPEN_E2E.test.ts` — authoritative real OPEN E2E.
   **All 9 tests pass** against an actual deployed Garaga OPEN verifier (no mock):
   - 5 distinct nonzero verifier addresses
   - ECIP class declared at the verifiers' library_call target
   - real snarkjs proof + Garaga calldata
   - on-chain transaction SUCCEEDED (real Groth16 verification)
   - position state read from on-chain storage (correct field indices)
   - exact collateral movement (margin × 10 000) into the adapter
   - ADVERSARIAL: replay reverts (NULLIFIER_ALREADY_SPENT)
   - ADVERSARIAL: mutated proof calldata reverts (real verifier rejects)

### Known remaining risks / limitations

- For a **Sepolia** deployment the verifiers must reference the canonical ECIP class
  `0x396d5915…` (already declared there), OR we deploy our own ECIP class to Sepolia and
  keep the local hash. Decision deferred to the deployment phase.
- Pre-existing TypeScript errors in some tests (`protocolVersion: number`, missing
  `nullifier`/`recipient` fields) exist before this session; to be fixed in the relevant phase.
- PHASE 2+ (economic correctness, UPDATE/FUND/CLOSE/LIQUIDATE real E2E, relayer, etc.)
  still pending.

---

## 2026-08-21 (later) — PHASE 2/3/4/6 code fixes (production code, no tests touched)

### PHASE 2 — Economic correctness

- **P0 #3 (oracle-bound OPEN)** — `circuits/pel_open.circom` now has `oraclePrice` as a
  5th public input and proves `|entry - oracle| * 10000 <= 100 * oracle` in-circuit.
  Rebuilt the OPEN circuit + zkey + regenerated the OPEN verifier (via
  `scripts/regenerate_verifier.py`, which re-serializes `ic`/`N_PUBLIC_INPUTS` from the
  snarkjs VK — verified byte-identical on an unchanged circuit). `PELPerpsCore.open_position`
  now asserts `price.price == proof_oracle_price`.
- **P0 #4 (close accounting)** — `PELPerpsCore.close_position` routes the residual locked
  margin (`locked_margin - payout`) to LP NAV via `collect_insurance_contribution`, and
  skips `release_shielded_payout` when payout == 0. No margin is stranded.
- **P0 #5 (liquidation/bad debt)** — documented the waterfall (equity/maint/bounty/insurance/
  bad-debt) in `pel_perps_core.cairo`; accounting is conservation-correct (verified by the
  lifecycle E2E conservation assertions).
- **P0 #7 (funding `+1`)** — removed the unjustified `+1` interval in `fund_position`;
  canonical rule is `intervalsElapsed <= floor(elapsed / interval)`.
- **P1 #15 (fee enforcement)** — `circuits/pel_close.circom` now derives `fees` from the
  canonical taker fee (`floor(floor(q·oracle/1e8)·7/1e4)`) instead of a free input.
  `pelCircuitService.computeCloseSettlement`/`generateCloseProof` derive the fee;
  `CloseWitness.feesCents` is deprecated. Rebuilt the CLOSE circuit + regenerated the
  CLOSE verifier.
- **NEW P0 (nullifier collision)** — OPEN used the same nullifier tag as CLOSE/UPDATE/FUND/
  LIQUIDATE, so OPEN spent the nullifier that CLOSE needed (lifecycle impossible). OPEN now
  uses a distinct `MARGIN_NULLIFIER_TAG`; `pelCircuitService.computeMarginNullifier` added.
- **P0 #6 (relayer)** — removed `approve` from `ALLOWED_ENTRYPOINTS` + its schema, and
  removed the collateral token from `getAllowlistedContracts()`.

### PHASE 3/4/6 — verification + security + constants

- **P1 #11 (position decoding)** — `starknetPerpsDispatcher.getPositionOnChain` reads
  `is_active` at index 7 (was 5).
- **P1 #12 (finality)** — `executeOnChain` waits for acceptance and returns
  SUCCESS/REVERTED/REJECTED (never treats `execute()` as success).
- **P1 #9 (witness encryption)** — `witnessStore` now encrypts witnesses at rest with
  AES-GCM keyed by SHA-256 of a wallet signature (`requestWitnessEncryptionSignature`);
  no plaintext fallback. `findWitnessByCommitment` (localStorage scan) removed. Keeper now
  requires explicit `configure(walletAddress, witnessSignature)`.
- **P1 #10 (viewing key / notes)** — `vaultService` no longer derives the "viewing key"
  from the public address and no longer fabricates block numbers; vault documented as a
  LOCAL PROTOTYPE (no on-chain privacy).
- **P1 #13 (persistence ordering)** — `PerpsTab` persists the witness only after on-chain
  confirmation; `protocolVersion` set to 3; oracle price fetched from the on-chain oracle.
- **P1 #14 (constant drift)** — `types.ts` PROTOCOL_VERSION/configVersion → 3, domain
  separators aligned to canonical; `canonical.ts` oracle staleness → 180s.
- **P1 #16 (indexer)** — fixed `daemonIndexerService` event-layout (PositionOpened /
  PositionLiquidated field indices), removed the bogus OPEN nullifier, and wired reorg
  detection (`handleReorg`) into `pollOnce`.
- **P1 #17 (honesty)** — `routerService` and `earnService` documented as SIMULATED.

### Open items (deferred / for the user)

- The pre-existing mock-based scripts (`scripts/deploy_open_e2e.ts`,
  `scripts/sepolia_perps_e2e.ts`) and several `tests/*` still use the OLD API
  (`generateOpenProof` without `oraclePriceCents`, `saveWitness` old signature, hand-built
  circuit inputs) — these are superseded by `deploy_perps_devnet.ts` + the real E2E tests
  and must be updated when the test suite is re-run.
- snforge unit tests are blocked by missing Rust (`cargo`); `contracts/tests/test_adapter_conservation.cairo`
  is written but unrun.

