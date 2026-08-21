// PEL OPEN circuit — proves a valid position opening.
//
// Proves: (a) the public commitment C binds the private position witness;
//         (b) the public margin-nullifier N binds ownerSecret + C (distinct margin tag);
//         (c) side ∈ {0,1}, margin > 0, oraclePrice > 0;
//         (d) leverage bound: q*entry*BPS_SCALE <= MAX_LEVERAGE_BPS * margin * QTY_SCALE;
//         (e) execution-price deviation: |entry - oracle| * BPS_SCALE <= maxDev * oracle.
//
// Public inputs:  [ commitment, marginNullifier, marketId, margin, oraclePrice ]
//   - margin is public so the on-chain Core can pull the exact ERC-20 collateral amount.
//   - oraclePrice is public so the on-chain Core can bind execution to the canonical
//     oracle state (and reject stale/manipulated prices).
//   - side / quantity / entryPrice / nonce / ownerSecret remain private.
// Private witness: side, quantity, entryPrice, nonce, ownerSecret, diffIsNeg, diffMag
pragma circom 2.1.0;

include "./lib/pel_hash.circom";
include "./lib/pel_math.circom";
include "circomlib/circuits/comparators.circom";

// DOMAIN_SEP            = "PEL_POSITION_V2"        = 416789285783953861544134726490478130
// MARGIN_NULLIFIER_TAG  = "PEL_MARGIN_NULLIFIER_V2" = 7688405287452665414607748171986428873125503038446851634
// MAX_LEVERAGE_BPS      = 50x + 0.05x tolerance    = 500500
// MAX_EXEC_DEVIATION_BPS= 100 (1.0%)

template PelOpen() {
    signal input commitment;
    signal input marginNullifier;
    signal input marketId;
    signal input margin;
    signal input oraclePrice;

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input nonce;
    signal input ownerSecret;

    // signed decomposition witnesses for (entryPrice - oraclePrice)
    signal input diffIsNeg;
    signal input diffMag;

    // side is binary
    side * (side - 1) === 0;

    // 1. commitment binding
    component c = PelPositionCommitment();
    c.domain <== 416789285783953861544134726490478130;
    c.market <== marketId;
    c.side <== side;
    c.quantity <== quantity;
    c.entry <== entryPrice;
    c.margin <== margin;
    c.funding <== 0;
    c.nonce <== nonce;
    c.secret <== ownerSecret;
    commitment === c.commitment;

    // 2. margin-nullifier binding (DISTINCT margin tag — must not collide with the
    //    position nullifier spent on CLOSE/UPDATE/FUND/LIQUIDATE, which uses the
    //    position nullifier tag).
    component n = PelNullifier();
    n.tag <== 7688405287452665414607748171986428873125503038446851634;
    n.secret <== ownerSecret;
    n.commitment <== commitment;
    marginNullifier === n.nullifier;

    // 3. margin > 0 and oraclePrice > 0
    component mz = IsZero();
    mz.in <== margin;
    mz.out === 0;
    component oz = IsZero();
    oz.in <== oraclePrice;
    oz.out === 0;

    // 4. leverage bound (non-negative multiplication comparison)
    //    impliedLeverageBps = (q*e/1e8) * 10000 / m  <=  MAX_LEVERAGE_BPS
    //    <=>  q*e*10000  <=  MAX_LEVERAGE_BPS * m * 100000000
    signal lhs;
    signal rhs;
    lhs <== quantity * entryPrice * 10000;
    rhs <== 500500 * margin * 100000000;
    component le = LessEqThan(252);
    le.in[0] <== lhs;
    le.in[1] <== rhs;
    le.out === 1;

    // 5. execution-price deviation: |entry - oracle| * 10000 <= 100 * oracle
    signal delta;
    delta <== entryPrice - oraclePrice;
    component dd = SignedDecompose();
    dd.x <== delta;
    dd.isNeg <== diffIsNeg;
    dd.mag <== diffMag;

    signal devLhs;
    signal devRhs;
    devLhs <== diffMag * 10000;
    devRhs <== 100 * oraclePrice;
    component dle = LessEqThan(252);
    dle.in[0] <== devLhs;
    dle.in[1] <== devRhs;
    dle.out === 1;
}

component main { public [ commitment, marginNullifier, marketId, margin, oraclePrice ] } = PelOpen();
