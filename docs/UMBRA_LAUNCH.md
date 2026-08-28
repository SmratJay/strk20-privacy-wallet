# UMBRA LAUNCH — Private Memecoin Launchpad on Starknet

> **Privacy is a property of the trade, not the market.**

UMBRA LAUNCH is a Pump.fun-style memecoin launchpad on Starknet with a **novel private
execution layer built on the official STRK20 privacy pool**. The market itself is fully
public (price, liquidity, curve state, graduation progress, volume). The user's *trade*
can be private: shielded STRK in → `PrivateCurveExecutor` → the same public curve →
shielded memecoin note out (and the reverse for selling).

This document is the source of truth for the architecture, the privacy/threat model, what
is public vs private, known linkability, deployment, and the hackathon submission plan.

---

## 1. TL;DR

| | Public execution | Private execution |
|---|---|---|
| Input | user's public STRK | shielded STRK20 STRK note |
| Market actor | user's wallet calls `BondingCurve.buy/sell` | `PrivateCurveExecutor` calls the SAME curve |
| Output | public memecoin balance | shielded STRK20 memecoin note |
| Wallet→trade linkage | fully visible | reduced to the STRK20 proof (see §6) |
| Market state | identical | identical (one canonical curve) |

**One canonical market, two execution layers.** There is exactly one bonding curve per
token. There is no `public_pool` / `private_pool` split, no second price oracle, no
rebalancing. The private/public distinction exists only in *who* touches the curve and
*how the output is returned*.

---

## 2. Architecture

```
                    UMBRA MEME MARKET
                           |
                    CANONICAL BONDING CURVE        (virtual-reserve CPMM, on-chain math)
                           |
             +-------------+-------------+
             |                           |
        PUBLIC EXECUTION           PRIVATE EXECUTION (STRK20)
             |                           |
      wallet → buy/sell            shielded note
             |                        withdraw → executor
             |                        PrivacyPool → PrivateCurveExecutor
             |                        executor → curve.buy/sell
             |                        executor → OpenNoteDeposit
             |                        pool fills open note
             |                           |
             +-------------+-------------+
                           |
                    SAME CURVE STATE
                           |
                        PRICE / GRADUATION
                           |
                     GraduationRouter (DEX liquidity seam)
```

### Components

1. **`Memecoin`** (`umbra-launch-contracts/src/memecoin.cairo`) — fixed-supply ERC20. Supply
   is minted once at construction to the curve. No owner-mintable mechanic. `burn` is public
   but only ever reduces the caller's own balance (unused by the curve).
2. **`BondingCurve`** (`src/bonding_curve.cairo`) — the canonical market. Virtual-reserve
   constant-product with `ceil` division on both directions (rounding dust always favors the
   pool, so buy+sell round trips strictly lose value — no rounding exploit). 1% fee retained
   by the curve on both legs, accruing to graduation liquidity. Graduation at a configured
   real-base target.
3. **`PrivateCurveExecutor`** (`src/private_curve_executor.cairo`) — the STRK20 invoke
   anonymizer for the curve. Mirrors the official `EkuboSwapAnonymizer` contract shape:
   called by the privacy pool via `privacy_invoke`, spends the withdrawn input on the curve,
   approves the pool, returns one `OpenNoteDeposit`. **The curve sees the executor as the
   trader — never the end user's wallet.**
4. **`TokenFactory`** (`src/token_factory.cairo`) — declares + deploys the memecoin, curve,
   and executor per launch via the standard class-deployment approach. Emits `TokenCreated`
   and `CurveCreated`.
5. **`GraduationRouter`** (`src/graduation_router.cairo`) — graduation liquidity seam.
   Receives the curve's final reserves on graduation; `on_graduation` emits the exact amounts
   for the UI; `forward_reserves` (governance) moves them to a configured liquidity manager.
   Direct atomic Ekubo migration is deliberately NOT wired here — see §8.

---

## 3. Exact STRK20 integration used

- **SDK / upstream**: `@starkware-libs/starknet-privacy-sdk` **0.14.3-rc.5** (vendored at
  `vendor/starknet-privacy-sdk/`, upstream tag `PRIVACY-0.14.3-RC.5`,
  github.com/starkware-libs/starknet-privacy). Reference executor: `EkuboSwapAnonymizer`
  (class hash `0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7` upstream).
- **Pool (mainnet)**: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- **Pool (sepolia)**: `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
- **Execution lane**: the **Ready privacy wallet Wallet API** (starknet-specs wallet-api
  v0.10.4-rc.1). The dapp builds STRK20 *actions* — including an `invoke` action whose
  calldata uses the official **`${openNoteIds[0]}` placeholder** — and the wallet assembles
  the proof (resolving the open-note id), signs, and we submit via `wallet_addInvokeTransaction`.

### The private flow (as built by the frontend)

**PRIVATE BUY** (`src/services/privateLaunchService.ts` → `buildPrivateBuyActions`):

```
[
  { type: 'withdraw',  token: STRK,     amount, recipient: executor },
  { type: 'transfer',  token: HAMSTR,   amount: 'OPEN', recipient: user },
  { type: 'invoke',    contract: executor, calldata: [0, STRK, amount, '${openNoteIds[0]}'] },
]
```

The pool:
1. `Withdraw` STRK → executor (pool pays the executor).
2. Creates the user's open HAMSTR note.
3. Invokes `executor.privacy_invoke(0 /*buy*/, STRK, amount, openNoteId)`.
4. Executor approves curve for STRK, calls `curve.buy(amount, executor)`, receives HAMSTR.
5. Executor approves the pool for the HAMSTR output and returns
   `Span<OpenNoteDeposit>{ note_id, HAMSTR, amount }`.
6. Pool pulls HAMSTR from the executor and fills the user's open note → **private HAMSTR**.

**PRIVATE SELL** mirrors it with `[1 /*sell*/, HAMSTR, amount, '${openNoteIds[0]}']`, the
executor approves the curve for HAMSTR, calls `curve.sell`, and the pool fills a STRK note.

**The curve's public state changes identically** to a public trade of the same size —
verified by snforge test `test_public_and_private_share_the_same_price`.

---

## 4. What is public vs private

### PUBLIC (everyone can observe on-chain)
- Token address, name/symbol/supply.
- Curve reserves (real + virtual), `k`, fees.
- Price, market cap, liquidity, accumulated volume.
- Graduation progress and completion.
- Market-level activity: the executor is a public contract; its curve interaction (amount
  in, token out) is visible in the public call trace, exactly like a public trade's impact.

### PRIVATE (STRK20-protected)
- **The user's wallet is not the caller** of the curve. The curve's `trader` is the
  `PrivateCurveExecutor`.
- The user's shielded input note (STRK) is spent inside the pool proof — the pool hides
  sender, recipient, amount and token of the note spend.
- The user's output is a **shielded open-note deposit** — a fresh encrypted note only the
  user's viewing key can decrypt.
- The wallet→trade link exists only inside the STRK20 proof, which the pool validates
  without revealing it.

---

## 5. Privacy model & threat model

STRK20's privacy pool hides the sender, recipient, amount and token of shielded notes inside
the pool (encrypted notes + nullifier proofs). UMBRA LAUNCH inherits exactly those
properties for the **trade leg**, and adds a public-executor hop so the market-facing actor
is the executor, not the user.

**What an outside observer can still do:**

| Attack / observation | Feasibility | Mitigation |
|---|---|---|
| See a market move happened | Trivially | Intended — market is public |
| See the exact trade size on the curve | Trivially (public trace) | Intended |
| Link "this wallet bought HAMSTR" | Requires breaking STRK20 or correlating below | STRK20 proof + executor hop |
| Time-correlate a deposit/shield with a trade | Possible | Documented warning in UI |
| Amount-correlate a shield with a trade | Possible if shield amount ≈ trade amount | Documented warning in UI |
| Note-maturity correlation | Possible (fresh notes) | Documented warning in UI |
| Wallet/gas visibility | The signing wallet pays gas and is visible as the tx sender | Documented warning in UI |
| Paymaster relayer IP / timing | Not used (wallet submits directly) | n/a |

**The executor cannot be abused:**
- `privacy_invoke` only accepts the configured privacy pool as caller
  (`get_caller_address() == pool`).
- Only the configured input token per operation (BUY→STRK, SELL→memecoin); any other token
  reverts (`BUY_INPUT_NOT_BASE` / `SELL_INPUT_NOT_TOKEN`).
- Only routes through its configured curve; no arbitrary recipients; output always flows to
  the pool's open-note mechanism.
- No reentrancy exposure: the pool guards `apply_actions`, and the executor only calls the
  curve/ERC20s (no callback surface).

---

## 6. Honest linkability statement

UMBRA LAUNCH **does not claim anonymity or untraceability**. Specifically:

- The **public call trace** shows: the executor moved `X` STRK into the curve and received
  `Y` HAMSTR (public market effect). This is indistinguishable from a public trade *at the
  market level*.
- The **STRK20 transaction** shows: a user (whose identity is the pool proof) withdrew a
  shielded STRK note to the executor and received a shielded HAMSTR note. A determined
  observer who controls both the pool indexer and timing can attempt correlation.
- **Deposit-and-trade bundling**: if a user shields STRK and trades within minutes, the
  shield (a public `deposit` action) can be time-correlated with the private trade. The UI
  warns about this. Fully unlinkable usage requires letting notes mature and mixing over
  time — a property of the protocol, not the UI.
- **Gas / submission**: the wallet that signs the proof is the tx sender; an observer sees
  that account submitted the STRK20 transaction. This is a real, documented leakage.

We surface these warnings in the UI *before* any private execution (the amber "Privacy
warnings — please read" panel on the token page).

---

## 7. Contracts

All in `umbra-launch-contracts/` (Scarb 2.16.1, snforge 0.57.0, edition 2024_07). The
existing PEL perps `contracts/` package is untouched.

| File | Contract | Purpose |
|---|---|---|
| `src/memecoin.cairo` | `Memecoin` | Fixed-supply ERC20 |
| `src/bonding_curve.cairo` | `BondingCurve` | Canonical virtual-reserve CPMM + fees + graduation |
| `src/private_curve_executor.cairo` | `PrivateCurveExecutor` | STRK20 `privacy_invoke` anonymizer |
| `src/token_factory.cairo` | `TokenFactory` | Launches token+curve+executor, emits `TokenCreated`/`CurveCreated` |
| `src/graduation_router.cairo` | `GraduationRouter` | Graduation liquidity seam |
| `src/test_base_asset.cairo` | `TestBaseAsset` | Test-only ERC20 with mint |

### BondingCurve math (on-chain, integer only)

```
k          = virtual_base * virtual_token          (u256)
total_base  = virtual_base + base_reserve           (real STRK in)
total_token = virtual_token - token_reserve         (real tokens sold out)
buy : net = in*(1-fee) ; token_out = total_token - ceil(k/(total_base+net))
sell: net = in*(1-fee) ; base_out   = total_base   - ceil(k/(total_token+net))
```

- `ceil` on the pool's outgoing amount both directions → rounding dust always favors the
  pool → no round-trip exploit (proven by `test_round_trip_cannot_extract_value`).
- Reserve accounting happens **before** external transfers (checks-effects-interactions).
- `base_out ≤ base_reserve` is asserted (`BASE_RESERVE_NEGATIVE`) — the virtual base reserve
  can never go negative.
- Tokens returned on sell are **not burned**; they return to curve custody, keeping the
  physical balance exactly equal to `total_supply - token_reserve` (no depletion; the burn
  variant was found to break this invariant and removed).

---

## 8. Graduation

When `base_reserve ≥ graduation_target`:
1. `graduated = true` — trading permanently stops (both public and private reverts).
2. The curve moves its real base reserves + remaining token balance to the configured
   `graduation_recipient` (the `GraduationRouter`).
3. `GraduationRouter.on_graduation` emits the exact amounts for the UI.

**Ekubo migration boundary**: direct atomic seeding of a real Ekubo pool is *not* wired in
this MVP — it requires live pool-key construction against the current Ekubo core, and
getting it wrong would break the privacy flow. `GraduationRouter.forward_reserves` is the
governance seam where a real Ekubo pool/position-manager integration plugs in. Documented
remaining work (kept honest, not faked).

---

## 9. Test results

### snforge (48/48 passing) — `cd umbra-launch-contracts && snforge test`

- **Memecoin**: metadata, supply, transfer, approval, burn, insufficient-balance reverts,
  zero-supply deploy rejected.
- **BondingCurve**: initial state, quotes (incl. 0), buy+price-up, sell+price-reverse,
  reserve invariant, fee retention, buy/sell-after-graduation reverts, early-graduation
  revert, graduation transfers to router, zero-buy/sell reverts, sell-more-than-held
  reverts, round-trip cannot extract value.
- **PrivateCurveExecutor**: private buy path, private sell path, arbitrary-caller rejection,
  wrong-input-token rejection (both directions), invalid operation, zero amount, zero note
  id, private==public price (one market), no arbitrary-recipient surface.
- **TokenFactory**: full stack creation, distinct duplicates, supply fully in curve,
  invalid-parameter reverts, created token trades, graduation journey, executor inert
  post-graduation.
- **Adversarial**: cannot drain arbitrary ERC20, cannot drain base via sell, non-deployer
  cannot change graduation recipient, reserves drained on graduation.

### Vitest (210/210 passing, 8 new) — `npm test`

- `src/__tests__/privateLaunchActions.test.ts` — exact STRK20 action shapes, `${openNoteIds[0]}`
  placeholder, one OPEN note per invoke.
- `src/__tests__/launchMetrics.test.ts` — metric computation, graduation %, no divide-by-zero.

### TypeScript / build
- `npx tsc --noEmit` clean.
- `npm run build` (Next.js) succeeds; `/launch` and `/launch/[token]` routes built.

---

## 10. Deployment

### Prerequisites
- `umbra-launch-contracts`: `scarb build` (done — artifacts verified in `target/dev/`).
- A funded deployer in `deployments/deployer_account.json`.

### Mainnet (or Sepolia)
```bash
scarb build                      # in umbra-launch-contracts/
node scripts/launch_deploy.mjs             # mainnet
# or
node scripts/launch_deploy.mjs --sepolia   # testnet first
```
The script declares all 5 contracts, deploys `GraduationRouter` + `TokenFactory`, launches
HAMSTR, and prints the `.env.local` lines:

```
NEXT_PUBLIC_UMBRA_FACTORY=…
NEXT_PUBLIC_UMBRA_ROUTER=…
NEXT_PUBLIC_UMBRA_HAMSTR_TOKEN=…
NEXT_PUBLIC_UMBRA_HAMSTR_CURVE=…
NEXT_PUBLIC_UMBRA_HAMSTR_EXECUTOR=…
```

### Verify before / after (never fabricate)
- `node scripts/launch_smoke.mjs [--sepolia]` reads the real curve state and prints a live
  `quote_buy`.
- `node scripts/launch_smoke.mjs --buy` performs a real tiny public buy and prints the tx.
- Verify addresses on the explorer; record every hash in `deployments/umbra-launch.json`
  (the script already does).

### Safety checklist (per the hackathon rules)
1. `scarb build` ✓ (artifacts verified)
2. `snforge test` ✓ (48/48)
3. adversarial tests ✓
4. class hashes computed from artifacts ✓ (script prints them)
5. constructor params: governance, STRK base, pool, router, 3 class hashes ✓
6. deploy only after local tests ✓
7. record addresses ✓ (manifest)
8. verify on explorer before live txs ✓ (smoke script)

---

## 11. Frontend

- `/launch` — discovery: trending cards with MC / liquidity / price / graduation progress,
  the "Public market · Private execution" statement banner.
- `/launch/[token]` — market stats, graduation bar, **public/private balances** (public
  HAMSTR + private HAMSTR 🛡 / public STRK + private STRK), **BUY/SELL × PUBLIC/PRIVATE**,
  on-chain quote, full transaction-state machine (quoting → signing/proving → submitting →
  done), the privacy explainer, and the honest privacy-warning panel.
- All reads are live RPC calls; if contracts aren't configured yet the UI shows a clear
  "pending deployment" state — no fabricated balances.

### Demo script (3 minutes)
1. 0:00 — Open `/launch`. "The market is public. Your trade doesn't have to be."
2. 0:30 — Open HAMSTR. Point out price/MC/liquidity/graduation are live on-chain.
3. 1:00 — Select **BUY → PUBLIC**, buy a small amount; show the tx and the public balance.
4. 1:30 — Select **PRIVATE**. Show the warning panel ("what this does / doesn't protect").
5. 2:00 — Private buy: the STRK20 wallet proves the transaction (withdraw STRK → executor →
   curve → shielded HAMSTR note). Show the "Proving private trade…" state and the tx hash.
6. 2:40 — Private sell of the shielded HAMSTR note → shielded STRK note. Both balances update.
7. 3:00 — "One market. Two execution layers. The market stays public; your wallet→trade link
   doesn't have to be."

---

## 12. Hackathon submission: strk20.json

The three required mainnet transactions that touch the STRK20 pool:

| # | What | How |
|---|---|---|
| 1 | STRK → privacy pool (register/shield) | Ready wallet `wallet_strk20InvokeTransaction` deposit |
| 2 | **Private buy** (STRK note → curve → HAMSTR note) | `wallet_strk20PrepareInvoke` + `wallet_addInvokeTransaction` via UMBRA LAUNCH |
| 3 | **Private sell** (HAMSTR note → curve → STRK note) | same private lane, reversed |

Each tx hash is recorded from the actual wallet/chain response and entered into
`strk20.json` (see the updated file) — never fabricated. They are marked PENDING until the
contracts are deployed and the operator prover/discovery services for the mainnet pool are
live.

---

## 13. Known limitations

- **Operator infra**: STRK20 private execution needs the mainnet pool's operator prover +
  discovery services (same constraint as the rest of the wallet repo). Until they are live,
  private txs cannot be proven on mainnet.
- **Ekubo graduation**: not wired (documented seam only).
- **Volume/holders**: "volume" is derived from curve reserves (accumulated base); holder
  counts need an indexer and are shown as unknown.
- **Base USD price**: placeholder feed; never conflated with on-chain truth.
- **No private-position object**: private users own notes only (per spec — no
  `PrivatePosition`).

## 14. Files changed

**Contracts (new package, PEL untouched):** `umbra-launch-contracts/{Scarb.toml,
src/{lib,objects,interfaces,memecoin,bonding_curve,private_curve_executor,token_factory,
graduation_router,test_base_asset}.cairo, tests/test_{utils,memecoin,bonding_curve,
private_curve_executor,token_factory,adversarial,integration}.cairo}`.

**Frontend:** `src/config/launch.ts`, `src/services/launchService.ts`,
`src/services/privateLaunchService.ts`, `src/app/launch/page.tsx`,
`src/app/launch/[token]/page.tsx`, `src/components/wallet/AppShell.tsx` (nav),
`src/app/wallet/page.tsx` (Launch entry).

**Tests:** `src/__tests__/privateLaunchActions.test.ts`, `src/__tests__/launchMetrics.test.ts`.

**Deploy:** `scripts/launch_deploy.mjs`, `scripts/launch_smoke.mjs`.

**Docs/registry:** `docs/UMBRA_LAUNCH.md`, `README.md`, `strk20.json`.