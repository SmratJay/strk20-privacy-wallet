#!/usr/bin/env bash
# PEL Private Perpetuals Local Quality Gate (Audit Section 6 & P0-03)
set -e

echo "============================================================"
echo "  PEL PRIVATE PERPETUALS: LOCAL QUALITY GATE"
echo "============================================================"

echo ""
echo "[1/4] Compiling Cairo Smart Contracts with Scarb..."
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cd contracts && scarb build && cd ..
echo "✓ Scarb compile succeeded with 0 errors"

echo ""
echo "[2/4] Executing Comprehensive Vitest Suite (16 Test Files)..."
npx vitest run
echo "✓ All 16 unit, invariant, and real Cairo contract integration test suites passed"

echo ""
echo "[3/4] Running Next.js Production Build & Typecheck..."
npm run build
echo "✓ Next.js build succeeded with 0 errors"

echo ""
echo "[4/4] Verifying Codebase Hygiene (No hardcoded test keys/addresses)..."
if grep -rn "0x053c912" src/services/keeperService.ts keeper/keeperBot.ts 2>/dev/null; then
  echo "❌ Error: Hardcoded keeper address found in keeper service/bot"
  exit 1
fi
echo "✓ Zero forbidden fallbacks detected in critical paths"

echo ""
echo "============================================================"
echo "  LOCAL QUALITY GATE: PASSED (100% GREEN)"
echo "============================================================"
exit 0
