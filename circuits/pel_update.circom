// PEL UPDATE circuit — proves a valid position recommit (nullifier rotation).
//
// Proves the position state (side, q, e, m, f) is unchanged while the commitment is
// rotated to a fresh nonce and the old nullifier is spent. This maintains privacy by
// preventing linkability of the position across actions and refreshes the replay guard.
//
// Public inputs:  [ oldCommitment, newCommitment, oldNullifier, marketId ]
// Private witness: side, quantity, entryPrice, margin, funding, nonce, newNonce, ownerSecret
pragma circom 2.1.0;

include "./lib/pel_hash.circom";

// DOMAIN_SEP = 416789285783953861544134726490478130
// NULLIFIER_TAG = 106698057160080439088554855157483918898

template PelUpdate() {
    signal input oldCommitment;
    signal input newCommitment;
    signal input oldNullifier;
    signal input marketId;

    signal input side;        // 0 = LONG, 1 = SHORT
    signal input quantity;    // sats
    signal input entryPrice;  // cents
    signal input margin;      // cents
    signal input funding;     // cents
    signal input nonce;
    signal input newNonce;
    signal input ownerSecret;

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

    // 3. new commitment binding (same state, fresh nonce)
    component cNew = PelPositionCommitment();
    cNew.domain <== 416789285783953861544134726490478130;
    cNew.market <== marketId;
    cNew.side <== side;
    cNew.quantity <== quantity;
    cNew.entry <== entryPrice;
    cNew.margin <== margin;
    cNew.funding <== funding;
    cNew.nonce <== newNonce;
    cNew.secret <== ownerSecret;
    newCommitment === cNew.commitment;
}

component main { public [ oldCommitment, newCommitment, oldNullifier, marketId ] } = PelUpdate();
