#!/usr/bin/env bash
# PEL circuits — Groth16 trusted setup (dev/test only).
# Run from repo root: bash circuits/setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="node $ROOT/node_modules/snarkjs/cli.js"
BUILD="$ROOT/circuits/build"
PTAU="$BUILD/ptau"
POT="$PTAU/pot12_final.ptau"

cd "$BUILD"
mkdir -p "$PTAU"

if [ ! -f "$PTAU/pot12_0000.ptau" ]; then
  echo "[ptau] new bn128 12"
  $CLI powersoftau new bn128 12 "$PTAU/pot12_0000.ptau" -v
fi
if [ ! -f "$PTAU/pot12_0001.ptau" ]; then
  echo "[ptau] contribute"
  $CLI powersoftau contribute "$PTAU/pot12_0000.ptau" "$PTAU/pot12_0001.ptau" -e="PEL-dev-$(date +%s)" -v
fi
if [ ! -f "$PTAU/pot12_beacon.ptau" ]; then
  echo "[ptau] beacon"
  $CLI powersoftau beacon "$PTAU/pot12_0001.ptau" "$PTAU/pot12_beacon.ptau" 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon" -v
fi
if [ ! -f "$POT" ]; then
  echo "[ptau] prepare phase2"
  $CLI powersoftau prepare phase2 "$PTAU/pot12_beacon.ptau" "$POT" -v
fi

for name in pel_open pel_close pel_update pel_fund pel_liquidate; do
  echo "[setup] $name"
  $CLI groth16 setup "$BUILD/$name.r1cs" "$POT" "$BUILD/$name.zkey"
  $CLI zkey export verificationkey "$BUILD/$name.zkey" "$BUILD/${name}_verification_key.json"
done

echo "DONE — zkey + verification keys written to $BUILD"
