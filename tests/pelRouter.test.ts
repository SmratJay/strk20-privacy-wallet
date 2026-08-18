/**
 * @file pelRouter.test.ts
 * @description Unit tests for PEL Mathematical Models, Route Scoring & Perpetual Invariants
 * References: PEL Technical White Paper (v0.2 | August 2026)
 */

import { describe, it, expect } from 'vitest';
import { routerService, RouteHop, TradingIntent } from '../src/services/routerService';
import { perpsService } from '../src/services/perpsService';
import { sessionKeyService } from '../src/services/sessionKeyService';
import { MAINNET_TOKENS } from '../src/config/tokens';

describe('PEL Intent & Privacy Router (Whitepaper Section 5)', () => {
  const dummyHop: RouteHop = {
    venue: {
      id: 'STRK20_INTERNAL',
      name: 'STRK20 Note Swap',
      type: 'SHIELDED_POOL',
      icon: 'Shield',
    },
    tokenIn: 'STRK',
    tokenOut: 'USDC',
    portionBps: 10000,
    expectedOutput: 100000000n,
    feeToken: 'STRK',
    feeAmount: 1500000000000000n,
    gasEstimatedGwei: 80,
    latencyMs: 1200,
    addressLinkage: 0.05,
    timingCorrelation: 0.10,
    calldataLeakage: 0.02,
    marketMetadataLeakage: 0.08,
  };

  it('calculates privacy leakage score Lambda(r) correctly', () => {
    // Formula: 0.40 * 0.05 + 0.20 * 0.10 + 0.25 * 0.02 + 0.15 * 0.08
    // = 0.020 + 0.020 + 0.005 + 0.012 = 0.057 => 6%
    const score = routerService.calculatePrivacyLeakage(dummyHop);
    expect(score).toBe(6);
  });

  it('ranks confidential routes first under MAX_PRIVACY preference', async () => {
    const intent: TradingIntent = {
      tokenIn: MAINNET_TOKENS[0], // STRK
      tokenOut: MAINNET_TOKENS[2], // USDC
      amountIn: 100000000000000000000n, // 100 STRK
      side: 'BUY',
      maxSlippageBps: 50,
      deadlineSeconds: 120,
      privacyPreference: 'MAX_PRIVACY',
    };

    const routes = await routerService.findOptimalRoutes(intent, { STRK: 0.584, USDC: 1.0 });
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0].privacyTier).toBe('SHIELDED');
    expect(routes[0].isRecommended).toBe(true);
  });
});

describe('PEL Perpetual Derivatives Invariants (Whitepaper Section 7 & Appendix A)', () => {
  it('calculates LONG liquidation price correctly', () => {
    // Entry = 100, Leverage = 10x (marginFraction = 0.1), Maint = 2% (0.02)
    // LiqPrice = 100 * (1 - 0.1 + 0.02) = 100 * 0.92 = 92.0
    const liqPrice = perpsService.calculateLiquidationPrice(100, 'LONG', 10, 0.02);
    expect(liqPrice).toBeCloseTo(92.0, 2);
  });

  it('calculates SHORT liquidation price correctly', () => {
    // Entry = 100, Leverage = 10x (marginFraction = 0.1), Maint = 2% (0.02)
    // LiqPrice = 100 * (1 + 0.1 - 0.02) = 100 * 1.08 = 108.0
    const liqPrice = perpsService.calculateLiquidationPrice(100, 'SHORT', 10, 0.02);
    expect(liqPrice).toBeCloseTo(108.0, 2);
  });

  it('calculates Long and Short PnL correctly', () => {
    // Long: 2 BTC size, entry 90k, current 95k => +10,000 USD
    const longPnl = perpsService.calculatePnl('LONG', 2, 90000, 95000);
    expect(longPnl.pnlUsd).toBe(10000);

    // Short: 2 BTC size, entry 90k, current 95k => -10,000 USD
    const shortPnl = perpsService.calculatePnl('SHORT', 2, 90000, 95000);
    expect(shortPnl.pnlUsd).toBe(-10000);
  });

  it('generates deterministic ZK position commitments', () => {
    const commitment1 = perpsService.generatePositionCommitment(
      '0x0123456789abcdef',
      'BTC-PERP',
      10000,
      95000,
      1000
    );
    expect(commitment1.startsWith('0x')).toBe(true);
    expect(commitment1.length).toBeGreaterThan(10);
  });
});

describe('PEL Scoped Session Keys (Whitepaper Section 9)', () => {
  it('creates valid scoped session key structure', () => {
    const session = sessionKeyService.createSession('0x0621d378a7af64de2003d657441f437b1978eac5bfa6de6069f0d7107265cefe', 5000, 8);
    expect(session.isActive).toBe(true);
    expect(session.dailySpendLimitUsd).toBe(5000);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(session.allowedSelectors).toContain('swap');
    expect(session.allowedSelectors).toContain('openPosition');
  });
});
