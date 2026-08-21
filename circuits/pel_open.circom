// PEL OPEN circuit — proves a valid position opening.
//
// Proves: (a) the public commitment C binds the private position witness;
//         (b) the public margin-nullifier N binds ownerSecret + C;
//         (c) side ∈ {0,1}, margin > 0;
//         (d) leverage bound: q*entry*BPS_SCALE <= MAX_LEVERAGE_BPS * margin * QTY_SCALE.
//
// Public inputs:  [ commitment, marginNullifier, marketId ]
// Private witness: side, quantity, entryPrice, margin, nonce, ownerSecret
pragma circom 2.1.0;

include "./lib/pel_hash.circom";
include "circomlib/circuits/comparators.circom";

// DOMAIN_SEP     = "PEL_POSITION_V2"  = 416789285783953861544134726490478130
// NULLIFIER_TAG  = "PEL_NULLIFIER_V2" = 106698057160080439088554855157483918898
// MAX_LEVERAGE_BPS = 50x + 0.05x tolerance = 500500

template PelOpen() {
    signal input commitment;
    signal input marginNullifier;
    signal input marketId;

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input margin;      // cents
    signal input nonce;
    signal input ownerSecret;

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

    // 2. margin-nullifier binding
    component n = PelNullifier();
    n.tag <== 106698057160080439088554855157483918898;
    n.secret <== ownerSecret;
    n.commitment <== commitment;
    marginNullifier === n.nullifier;

    // 3. margin > 0
    component mz = IsZero();
    mz.in <== margin;
    mz.out === 0;

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
}

component main { public [ commitment, marginNullifier, marketId ] } = PelOpen();
