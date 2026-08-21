# PEL Circuit Audit — Private/Public Inputs, Commitments, Nullifiers, Oracle & Replay

All circuits are Circom 2.1.0 (BN254), compiled with snarkjs, proven client-side, and
verified on-chain by dedicated Garaga `Groth16VerifierBN254` contracts. Poseidon hash is
used for commitments/nullifiers (`circuits/lib/pel_hash.circom`).

**Shared constants:**
- `DOMAIN_SEP = "PEL_POSITION_V2" = 416789285783953861544134726490478130`
- `NULLIFIER_TAG = "PEL_NULLIFIER_V2" = 106698057160080439088554855157483918898`
- `MARGIN_NULLIFIER_TAG = "PEL_MARGIN_NULLIFIER_V2"` (OPEN only — distinct domain)
- `QTY_SCALE = 1e8` (sats/BTC), price in USD cents
- `MAX_LEVERAGE_BPS = 500500`, `MAX_EXEC_DEVIATION_BPS = 100`, `MAINT_BPS = 200`

## OPEN (`pel_open.circom`)

| | |
|---|---|
| **Public inputs** | `commitment`, `marginNullifier`, `marketId`, `margin`, `oraclePrice` |
| **Private inputs** | `side`, `quantity`, `entryPrice`, `nonce`, `ownerSecret`, `diffIsNeg`, `diffMag` |
| **Commitment** | `C = Poseidon(domain, market, side, q, e, m, f=0, nonce, secret)` |
| **Nullifier** | `N = Poseidon(MARGIN_TAG, secret, C)` (distinct margin tag) |
| **Constraints** | side ∈ {0,1}; margin>0, oraclePrice>0; leverage bound `q*e*1e4 <= 500500*m*1e8`; execution deviation `|entry-oracle|*1e4 <= 100*oracle` |
| **Oracle binding** | `oraclePrice` is public; on-chain Core asserts it equals the canonical oracle (rejects stale/manipulated) |
| **Replay** | on-chain `marginNullifier` marked spent |

## UPDATE (`pel_update.circom`)

| | |
|---|---|
| **Public inputs** | `oldCommitment`, `newCommitment`, `oldNullifier`, `marketId` |
| **Private inputs** | `side`, `q`, `e`, `m`, `funding`, `nonce`, `newNonce`, `ownerSecret` |
| **Commitment** | both `C(nonce)` and `C(newNonce)` with identical state |
| **Nullifier** | `N = Poseidon(TAG, secret, oldCommitment)` |
| **Constraints** | state unchanged, fresh nonce rotates commitment |
| **Replay** | on-chain `oldNullifier` marked spent |

## FUND (`pel_fund.circom`)

| | |
|---|---|
| **Public inputs** | `oldCommitment`, `newCommitment`, `oldNullifier`, `marketId`, `oraclePrice`, `fundingRateBpsHr`, `intervalsElapsed`, `fundingPayment`, `isLongPays` |
| **Private inputs** | `side`, `q`, `e`, `m`, `funding`, `nonce`, `newNonce`, `ownerSecret`, decomposition witnesses |
| **Commitment** | `C_old`, `C_new` (updated margin+funding, fresh nonce) |
| **Nullifier** | `N = Poseidon(TAG, secret, oldCommitment)` |
| **Constraints** | `notional = floor(q*mark/1e8)`; `rawFunding = floor(notional*|rate|/1e4)`; `fundingPayment = rawFunding * intervals`; `isLongPays = (rate>0)`; `newMargin >= 0`; newFunding = funding + payment |
| **Oracle binding** | `oraclePrice` public, asserted equal to canonical oracle |
| **Replay** | on-chain `oldNullifier` spent; on-chain enforces `intervals <= floor(elapsed/interval)` (no +1) |

## CLOSE (`pel_close.circom`)

| | |
|---|---|
| **Public inputs** | `commitment`, `finalNullifier`, `payoutCommitment`, `payoutAmount`, `marketId`, `oraclePrice`, `recipient` |
| **Private inputs** | `side`, `q`, `e`, `m`, `funding`, `fees`, `nonce`, `ownerSecret`, `payoutNonce`, signed decomposition |
| **Commitment** | `C` binds the position; `C_payout = Poseidon(PAYOUT_TAG, payoutAmount, payoutNonce)` |
| **Nullifier** | `N = Poseidon(TAG, secret, C)` (final) |
| **Constraints** | PnL = `q*delta/1e8` (floor, signed); `equity = m + pnl - funding - fees`; `payout = max(0, equity)`; canonical taker fee `fees = floor(floor(q*oracle/1e8)*7/1e4)` |
| **Oracle binding** | `oraclePrice` public, asserted equal to canonical oracle |
| **Replay** | on-chain `finalNullifier` spent; recipient is proof-bound (no payout theft) |

## LIQUIDATE (`pel_liquidate.circom`)

| | |
|---|---|
| **Public inputs** | `positionCommitment`, `positionNullifier`, `marketId`, `oraclePrice`, `keeper` |
| **Private inputs** | `side`, `q`, `e`, `m`, `funding`, `fees`, `nonce`, `ownerSecret`, decomposition |
| **Commitment** | `C` binds the position |
| **Nullifier** | `N = Poseidon(TAG, secret, C)` |
| **Constraints** | PnL signed floor; `equity = m + pnl - funding - fees`; `notional = floor(q*oracle/1e8)`; `maint = floor(notional*200/1e4)`; **`equity <= maint`** proven without revealing operands |
| **Oracle binding** | `oraclePrice` public, asserted equal to canonical oracle |
| **Replay** | on-chain `positionNullifier` spent; `keeper` is proof-bound (forged keeper rejected) |

## Summary: replay protection

Every operation spends a unique nullifier on-chain (`used_nullifiers` map in
`PELPerpsCore`), and every new commitment is checked not to already exist. This rejects
replayed OPEN/UPDATE/FUND/CLOSE/LIQUIDATE and reused commitments.
