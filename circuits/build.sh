#!/usr/bin/env bash
# PEL circuits — full build: compile circom -> r1cs/wasm, then Groth16 setup.
# Prereqs: circom on PATH (https://github.com/iden3/circom/releases), node_modules installed.
# Run from repo root: bash circuits/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/circuits/build"
mkdir -p "$BUILD"

if ! command -v circom >/dev/null 2>&1; then
  echo "ERROR: circom not found on PATH. Install from https://github.com/iden3/circom/releases" >&2
  exit 1
fi

echo "[compile] pel_open"
circom "$ROOT/circuits/pel_open.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"

echo "[compile] pel_close"
circom "$ROOT/circuits/pel_close.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"

echo "[compile] pel_update"
circom "$ROOT/circuits/pel_update.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"

echo "[compile] pel_fund"
circom "$ROOT/circuits/pel_fund.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"

echo "[compile] pel_liquidate"
circom "$ROOT/circuits/pel_liquidate.circom" --r1cs --wasm --sym -o "$BUILD" -l "$ROOT/node_modules"

bash "$ROOT/circuits/setup.sh"
echo "PEL circuits built."
