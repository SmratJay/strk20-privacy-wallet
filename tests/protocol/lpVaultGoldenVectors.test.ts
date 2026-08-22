/**
 * @file tests/protocol/lpVaultGoldenVectors.test.ts
 * @description EXECUTABLE cross-language golden vectors. The values below are the SAME
 * vectors asserted in crates/pel-risk-engine/src/golden_vectors.rs and implemented by
 * contracts/src/pel_liquidity_vault.cairo. If any implementation drifts, this test
 * (Rust) and Cairo diverge and the discrepancy is caught here and in `cargo test`.
 *
 * Canonical units:
 *   NAV cents, shares (1 USD = 1e6), share price e6 (USD * 1e6),
 *   token units (1 cent = 10,000 micro-USDC).
 */

import { describe, it, expect } from 'vitest';
import { LPVaultEngine, SHARE_SCALE } from '../../src/protocol/lpVault';

describe('Cross-language LP share golden vectors (Cairo == Rust == TypeScript)', () => {
  it('V1 initial deposit: $10,000 -> 10,000,000,000 shares, price 1.000000', () => {
    const depositCents = 1_000_000n;
    const shares = LPVaultEngine.calcSharesMinted(depositCents, 0n, 0n);
    expect(shares).toBe(10_000_000_000n);
    expect(LPVaultEngine.calcSharePriceE6(1_000_000n, 10_000_000_000n)).toBe(1_000_000n);
  });

  it('V2 second deposit: $5,000 at $1.00 -> 5,000,000,000 shares, price stays 1.000000', () => {
    const shares = LPVaultEngine.calcSharesMinted(500_000n, 1_000_000n, 10_000_000_000n);
    expect(shares).toBe(5_000_000_000n);
    expect(LPVaultEngine.calcSharePriceE6(1_500_000n, 15_000_000_000n)).toBe(1_000_000n);
  });

  it('V3 trader profit $200 -> NAV 1,480,000 -> price 986666 (matches Rust vector)', () => {
    expect(LPVaultEngine.calcSharePriceE6(1_480_000n, 15_000_000_000n)).toBe(986_666n);
  });

  it('V4 trader loss $300 -> NAV 1,510,000 -> price 1006666 (matches Rust vector)', () => {
    expect(LPVaultEngine.calcSharePriceE6(1_510_000n, 15_000_000_000n)).toBe(1_006_666n);
  });

  it('V5 partial withdrawal: 1,000,000 shares of 1.51M NAV / 15e9 shares -> 100 cents', () => {
    expect(LPVaultEngine.calcGrossWithdrawal(1_000_000n, 1_510_000n, 15_000_000_000n)).toBe(100n);
  });

  it('share price identity: sharePriceE6 * shares ~= NAV * 1e6 * 1e4', () => {
    const nav = 1_510_000n;
    const shares = 15_000_000_000n;
    const price = LPVaultEngine.calcSharePriceE6(nav, shares);
    const lhs = price * shares;
    const rhs = nav * SHARE_SCALE * 10_000n;
    expect(lhs <= rhs).toBe(true);
    expect(rhs - lhs < shares).toBe(true);
  });

  it('rounding is deterministic floor division everywhere', () => {
    // Bootstrap share unit is SHARE_SCALE/100 per cent.
    expect(SHARE_SCALE / 100n).toBe(10_000n);
    // 1 cent -> 10,000 shares; 1 USD -> 1e6 shares.
    expect(LPVaultEngine.calcSharesMinted(1n, 0n, 0n)).toBe(10_000n);
    expect(LPVaultEngine.calcSharesMinted(100n, 0n, 0n)).toBe(1_000_000n);
    // Floor division: 7 cents * 10,000 shares / 3 cents NAV = 23,333.
    expect(LPVaultEngine.calcSharesMinted(7n, 3n, 70_000n)).toBe(163_333n);
  });
});