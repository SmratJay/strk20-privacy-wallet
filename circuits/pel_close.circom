// PEL CLOSE circuit — proves a valid position close / PnL settlement.
//
// Proves:
//   (a) commitment C binds the private position witness;
//   (b) final nullifier N binds ownerSecret + C;
//   (c) payout commitment binds (payoutAmount, payoutNonce);
//   (d) PnL = q * delta / QTY_SCALE   where delta = (P - e) for LONG, (e - P) for SHORT
//       (signed, floor division);
//   (e) equity = margin + PnL - funding - fees;
//   (f) payoutAmount === max(0, equity).
//
// Public inputs:  [ commitment, finalNullifier, payoutCommitment, payoutAmount, marketId, oraclePrice ]
// Private witness: side, quantity, entryPrice, margin, funding, fees, nonce, ownerSecret, payoutNonce,
//                  diffIsNeg, diffMag, pnlMag, pnlRem, equityIsNeg, equityMag
pragma circom 2.1.0;

include "./lib/pel_math.circom";
include "./lib/pel_hash.circom";
include "circomlib/circuits/mux1.circom";

// DOMAIN_SEP = 416789285783953861544134726490478130
// NULLIFIER_TAG = 106698057160080439088554855157483918898
// PAYOUT_TAG = 6359699795286374809669161932338

template PelClose() {
    signal input commitment;
    signal input finalNullifier;
    signal input payoutCommitment;
    signal input payoutAmount;
    signal input marketId;
    signal input oraclePrice;
    signal input recipient;

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input margin;      // cents
    signal input funding;     // cents
    signal input fees;        // cents
    signal input nonce;
    signal input ownerSecret;
    signal input payoutNonce;

    // signed decomposition witnesses
    signal input diffIsNeg;
    signal input diffMag;
    signal input pnlMag;
    signal input pnlRem;
    signal input equityIsNeg;
    signal input equityMag;

    side * (side - 1) === 0;

    // 1. commitment binding
    component c = PelPositionCommitment();
    c.domain <== 416789285783953861544134726490478130;
    c.market <== marketId;
    c.side <== side;
    c.quantity <== quantity;
    c.entry <== entryPrice;
    c.margin <== margin;
    c.funding <== funding;
    c.nonce <== nonce;
    c.secret <== ownerSecret;
    commitment === c.commitment;

    // 2. final nullifier binding
    component n = PelNullifier();
    n.tag <== 106698057160080439088554855157483918898;
    n.secret <== ownerSecret;
    n.commitment <== commitment;
    finalNullifier === n.nullifier;

    // 3. price delta (signed): deltaLong = P - e, deltaShort = e - P
    signal deltaLong;
    signal deltaShort;
    signal delta;
    deltaLong <== oraclePrice - entryPrice;
    deltaShort <== entryPrice - oraclePrice;
    component dmux = Mux1();
    dmux.c[0] <== deltaLong;
    dmux.c[1] <== deltaShort;
    dmux.s <== side;
    delta <== dmux.out;

    // 4. signed decompose delta and bind the sign/magnitude
    component dd = SignedDecompose();
    dd.x <== delta;
    dd.isNeg <== diffIsNeg;
    dd.mag <== diffMag;

    // 5. pnlMagnitude = floor(q * diffMag / QTY_SCALE)
    signal prod;
    prod <== quantity * diffMag;
    component pfd = PnlFloorDiv();
    pfd.prod <== prod;
    pfd.quot <== pnlMag;
    pfd.rem <== pnlRem;

    // 6. signed PnL (sign matches diff sign)
    signal pnl;
    component pmux = Mux1();
    pmux.c[0] <== pnlMag;
    pmux.c[1] <== (0 - pnlMag);
    pmux.s <== diffIsNeg;
    pnl <== pmux.out;

    // 7. equity = margin + pnl - funding - fees  (signed)
    signal equity;
    equity <== margin + pnl - funding - fees;

    // 8. signed decompose equity, payout = max(0, equity)
    component ed = SignedDecompose();
    ed.x <== equity;
    ed.isNeg <== equityIsNeg;
    ed.mag <== equityMag;

    signal payout;
    component omux = Mux1();
    omux.c[0] <== equityMag;
    omux.c[1] <== 0;
    omux.s <== equityIsNeg;
    payout <== omux.out;
    payoutAmount === payout;

    // 9. payout commitment binding
    component pc = PelPayoutCommitment();
    pc.tag <== 6359699795286374809669161932338;
    pc.payoutAmount <== payoutAmount;
    pc.payoutNonce <== payoutNonce;
    payoutCommitment === pc.payoutCommitment;
}

component main { public [ commitment, finalNullifier, payoutCommitment, payoutAmount, marketId, oraclePrice, recipient ] } = PelClose();
