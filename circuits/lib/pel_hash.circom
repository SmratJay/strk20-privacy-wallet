// PEL commitment & nullifier (Poseidon, BN254 via circomlib).
// Must be kept identical to the client-side commitment in src/services/pelCircuitService.ts
// and tests/circuits (circomlibjs Poseidon).
pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";

// DOMAIN_SEP    = "PEL_POSITION_V2"  = 416789285783953861544134726490478130
// NULLIFIER_TAG = "PEL_NULLIFIER_V2" = 106698057160080439088554855157483918898
// PAYOUT_TAG    = "PEL_PAYOUT_V2"    = 6359699795286374809669161932338

// C = Poseidon(domain, market, side, q, e, m, f, nonce, secret)  [9 inputs]
template PelPositionCommitment() {
    signal input domain;
    signal input market;
    signal input side;
    signal input quantity;
    signal input entry;
    signal input margin;
    signal input funding;
    signal input nonce;
    signal input secret;
    signal output commitment;

    component hash = Poseidon(9);
    hash.inputs[0] <== domain;
    hash.inputs[1] <== market;
    hash.inputs[2] <== side;
    hash.inputs[3] <== quantity;
    hash.inputs[4] <== entry;
    hash.inputs[5] <== margin;
    hash.inputs[6] <== funding;
    hash.inputs[7] <== nonce;
    hash.inputs[8] <== secret;
    commitment <== hash.out;
}

// N = Poseidon(tag, secret, commitment)  [3 inputs]
template PelNullifier() {
    signal input tag;
    signal input secret;
    signal input commitment;
    signal output nullifier;

    component hash = Poseidon(3);
    hash.inputs[0] <== tag;
    hash.inputs[1] <== secret;
    hash.inputs[2] <== commitment;
    nullifier <== hash.out;
}

// C_payout = Poseidon(tag, payoutAmount, payoutNonce)  [3 inputs]
template PelPayoutCommitment() {
    signal input tag;
    signal input payoutAmount;
    signal input payoutNonce;
    signal output payoutCommitment;

    component hash = Poseidon(3);
    hash.inputs[0] <== tag;
    hash.inputs[1] <== payoutAmount;
    hash.inputs[2] <== payoutNonce;
    payoutCommitment <== hash.out;
}
