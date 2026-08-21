// PEL FUND circuit — proves a valid funding accrual transition.
//
// Proves:
//   (a) old commitment binds (side, q, e, m, f, nonce, secret);
//   (b) old nullifier binds ownerSecret + old commitment;
//   (c) fundingPayment = floor(floor(q*markPrice/1e8) * |rate|/1e4) * intervals  (exact reference math);
//   (d) isLongPays is derived from the sign of the (signed) funding rate;
//   (e) newMargin = m - fundingPayment (longs pay) or m + fundingPayment (shorts pay), and stays >= 0;
//   (f) newFunding = f + fundingPayment;
//   (g) new commitment binds the updated (newMargin, newFunding) with a fresh nonce.
//
// Public inputs:  [ oldCommitment, newCommitment, oldNullifier, marketId, oraclePrice,
//                   fundingRateBpsHr, intervalsElapsed ]
// Private witness: side, quantity, entryPrice, margin, funding, nonce, ownerSecret, newNonce,
//                  rateIsNeg, rateAbs, notional, notionalRem, rawFunding, rawFundingRem,
//                  newMarginIsNeg, newMarginMag
pragma circom 2.1.0;

include "./lib/pel_math.circom";
include "./lib/pel_hash.circom";
include "circomlib/circuits/mux1.circom";

// DOMAIN_SEP = 416789285783953861544134726490478130
// NULLIFIER_TAG = 106698057160080439088554855157483918898

template PelFund() {
    signal input oldCommitment;
    signal input newCommitment;
    signal input oldNullifier;
    signal input marketId;
    signal input oraclePrice;        // mark price (cents)
    signal input fundingRateBpsHr;   // signed: positive = longs pay
    signal input intervalsElapsed;
    signal input fundingPayment;     // cents
    signal input isLongPays;         // 1 = longs pay, 0 = shorts pay

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input margin;      // cents
    signal input funding;     // cents
    signal input nonce;
    signal input ownerSecret;
    signal input newNonce;

    // decomposition witnesses
    signal input rateIsNeg;
    signal input rateAbs;
    signal input notional;
    signal input notionalRem;
    signal input rawFunding;
    signal input rawFundingRem;
    signal input newMarginIsNeg;
    signal input newMarginMag;

    side * (side - 1) === 0;

    // 1. old commitment binding
    component cOld = PelPositionCommitment();
    cOld.domain <== 416789285783953861544134726490478130;
    cOld.market <== marketId;
    cOld.side <== side;
    cOld.quantity <== quantity;
    cOld.entry <== entryPrice;
    cOld.margin <== margin;
    cOld.funding <== funding;
    cOld.nonce <== nonce;
    cOld.secret <== ownerSecret;
    oldCommitment === cOld.commitment;

    // 2. old nullifier binding
    component n = PelNullifier();
    n.tag <== 106698057160080439088554855157483918898;
    n.secret <== ownerSecret;
    n.commitment <== oldCommitment;
    oldNullifier === n.nullifier;

    // 3. signed decompose the funding rate: isLongPays = (rate > 0) = 1 - rateIsNeg
    component rd = SignedDecompose();
    rd.x <== fundingRateBpsHr;
    rd.isNeg <== rateIsNeg;
    rd.mag <== rateAbs;
    isLongPays === 1 - rateIsNeg;

    // 4. notional = floor(q * markPrice / 1e8)
    signal notionalProd;
    notionalProd <== quantity * oraclePrice;
    component nd = FloorDivBy(100000000);
    nd.prod <== notionalProd;
    nd.quot <== notional;
    nd.rem <== notionalRem;

    // 5. rawFunding = floor(notional * rateAbs / 1e4)
    signal rawProd;
    rawProd <== notional * rateAbs;
    component rd2 = FloorDivBy(10000);
    rd2.prod <== rawProd;
    rd2.quot <== rawFunding;
    rd2.rem <== rawFundingRem;

    // 6. fundingPayment = rawFunding * intervals
    fundingPayment === rawFunding * intervalsElapsed;

    // 7. newMargin = isLongPays ? (margin - fundingPayment) : (margin + fundingPayment)
    signal newMargin;
    component mmux = Mux1();
    mmux.c[0] <== margin + fundingPayment;   // isLongPays = 0 (shorts pay -> long receives)
    mmux.c[1] <== margin - fundingPayment;   // isLongPays = 1 (longs pay)
    mmux.s <== isLongPays;
    newMargin <== mmux.out;

    // 8. newMargin must remain non-negative
    component ndec = SignedDecompose();
    ndec.x <== newMargin;
    ndec.isNeg <== newMarginIsNeg;
    ndec.mag <== newMarginMag;
    newMarginIsNeg === 0;

    // 9. newFunding = funding + fundingPayment
    signal newFunding;
    newFunding <== funding + fundingPayment;

    // 10. new commitment binding (updated margin + funding, fresh nonce)
    component cNew = PelPositionCommitment();
    cNew.domain <== 416789285783953861544134726490478130;
    cNew.market <== marketId;
    cNew.side <== side;
    cNew.quantity <== quantity;
    cNew.entry <== entryPrice;
    cNew.margin <== newMargin;
    cNew.funding <== newFunding;
    cNew.nonce <== newNonce;
    cNew.secret <== ownerSecret;
    newCommitment === cNew.commitment;
}

component main { public [ oldCommitment, newCommitment, oldNullifier, marketId, oraclePrice, fundingRateBpsHr, intervalsElapsed, fundingPayment, isLongPays ] } = PelFund();
