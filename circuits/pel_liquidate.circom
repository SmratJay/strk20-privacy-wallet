// PEL LIQUIDATE circuit — proves a position is underwater (equity <= maintenance margin)
// WITHOUT revealing the equity, margin, quantity, or entry.
//
// Proves:
//   (a) commitment binds (side, q, e, m, f, nonce, secret);
//   (b) nullifier binds ownerSecret + commitment;
//   (c) PnL = q * delta / QTY_SCALE (signed, floor), delta = P-e (LONG) / e-P (SHORT);
//   (d) equity = margin + PnL - funding - fees;
//   (e) notional = floor(q * markPrice / 1e8), maint = floor(notional * maintBps / 1e4);
//   (f) equity <= maint  (the liquidation predicate, proved without revealing operands).
//
// Public inputs:  [ positionCommitment, positionNullifier, marketId, oraclePrice, keeper ]
// Private witness: side, quantity, entryPrice, margin, funding, fees, nonce, ownerSecret,
//                  diffIsNeg, diffMag, pnlMag, pnlRem, notional, notionalRem, maint, maintRem,
//                  equityIsNeg, equityMag
pragma circom 2.1.0;

include "./lib/pel_math.circom";
include "./lib/pel_hash.circom";
include "circomlib/circuits/mux1.circom";

// DOMAIN_SEP = 416789285783953861544134726490478130
// NULLIFIER_TAG = 106698057160080439088554855157483918898
// MAINT_BPS = 200 (2.00%)

template PelLiquidate() {
    signal input positionCommitment;
    signal input positionNullifier;
    signal input marketId;
    signal input oraclePrice;
    signal input keeper;

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input margin;      // cents
    signal input funding;     // cents
    signal input fees;        // cents
    signal input nonce;
    signal input ownerSecret;

    signal input diffIsNeg;
    signal input diffMag;
    signal input pnlMag;
    signal input pnlRem;
    signal input notional;
    signal input notionalRem;
    signal input maint;
    signal input maintRem;
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
    positionCommitment === c.commitment;

    // 2. nullifier binding
    component n = PelNullifier();
    n.tag <== 106698057160080439088554855157483918898;
    n.secret <== ownerSecret;
    n.commitment <== positionCommitment;
    positionNullifier === n.nullifier;

    // 3. price delta (signed)
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

    // 4. signed decompose delta
    component dd = SignedDecompose();
    dd.x <== delta;
    dd.isNeg <== diffIsNeg;
    dd.mag <== diffMag;

    // 5. pnlMagnitude = floor(q * diffMag / 1e8)
    signal pnlProd;
    pnlProd <== quantity * diffMag;
    component pfd = FloorDivBy(100000000);
    pfd.prod <== pnlProd;
    pfd.quot <== pnlMag;
    pfd.rem <== pnlRem;

    // 6. signed PnL
    signal pnl;
    component pmux = Mux1();
    pmux.c[0] <== pnlMag;
    pmux.c[1] <== (0 - pnlMag);
    pmux.s <== diffIsNeg;
    pnl <== pmux.out;

    // 7. equity = margin + pnl - funding - fees  (signed)
    signal equity;
    equity <== margin + pnl - funding - fees;

    // 8. signed decompose equity
    component ed = SignedDecompose();
    ed.x <== equity;
    ed.isNeg <== equityIsNeg;
    ed.mag <== equityMag;

    // 9. notional = floor(q * markPrice / 1e8)
    signal notionalProd;
    notionalProd <== quantity * oraclePrice;
    component nd = FloorDivBy(100000000);
    nd.prod <== notionalProd;
    nd.quot <== notional;
    nd.rem <== notionalRem;

    // 10. maint = floor(notional * maintBps / 1e4)
    signal maintProd;
    maintProd <== notional * 200;
    component md = FloorDivBy(10000);
    md.prod <== maintProd;
    md.quot <== maint;
    md.rem <== maintRem;

    // 11. liquidation predicate: equity <= maint
    //     if equity is negative (equityIsNeg=1) -> liquidatable trivially
    //     else require equityMag <= maint.
    signal magLeMaint;
    component le = LessEqThan(252);
    le.in[0] <== equityMag;
    le.in[1] <== maint;
    magLeMaint <== le.out;

    // (1 - equityIsNeg) implies magLeMaint == 1
    (1 - equityIsNeg) * (1 - magLeMaint) === 0;
}

component main { public [ positionCommitment, positionNullifier, marketId, oraclePrice, keeper ] } = PelLiquidate();
