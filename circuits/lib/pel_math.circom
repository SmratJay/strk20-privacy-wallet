// PEL math library — signed fixed-point helpers for the transition circuits.
// All values are integers; |signed values| are assumed < 2^128.
pragma circom 2.1.0;

include "circomlib/circuits/comparators.circom";

// QTY_SCALE = 100000000 (sats per BTC)
// 2^128 = 340282366920938463463374607431768211456

// Decompose a signed field value into sign + magnitude.
// Constraint: x === mag * (1 - 2*isNeg)  AND  mag < 2^128
//  - if x >= 0 (< 2^128): forces isNeg = 0, mag = x
//  - if x <  0 (large field elem): forces isNeg = 1, mag = |x|
template SignedDecompose() {
    signal input x;
    signal input isNeg;
    signal input mag;
    signal output oIsNeg;
    signal output oMag;

    isNeg * (isNeg - 1) === 0;
    x === mag * (1 - 2*isNeg);

    component lt = LessThan(129);
    lt.in[0] <== mag;
    lt.in[1] <== 340282366920938463463374607431768211456;
    lt.out === 1;

    oIsNeg <== isNeg;
    oMag <== mag;
}

// floor(prod / 100000000) with remainder bound.
template PnlFloorDiv() {
    signal input prod;   // non-negative
    signal input quot;   // witness: floor(prod / 1e8)
    signal input rem;    // witness: 0 <= rem < 1e8
    signal output out;

    quot * 100000000 + rem === prod;

    component lt = LessThan(252);
    lt.in[0] <== rem;
    lt.in[1] <== 100000000;
    lt.out === 1;

    out <== quot;
}

// Generic floor division by a compile-time constant: quot = floor(prod / divisor).
template FloorDivBy(divisor) {
    signal input prod;   // non-negative
    signal input quot;   // witness: floor(prod / divisor)
    signal input rem;    // witness: 0 <= rem < divisor
    signal output out;

    quot * divisor + rem === prod;

    component lt = LessThan(252);
    lt.in[0] <== rem;
    lt.in[1] <== divisor;
    lt.out === 1;

    out <== quot;
}
