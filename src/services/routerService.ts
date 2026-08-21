/**
 * @file routerService.ts
 * @description PEL Intent-Based Privacy-Aware Execution Router
 *
 * ⚠️ SIMULATED / LOCAL PROTOTYPE — the route cost optimizer uses HARDCODED route hops,
 * fees, gas, and privacy-leakage scores. It performs NO real DEX/aggregator quotes and
 * MUST NOT be presented as live routing data. Real swap execution goes through
 * avnuService.ts (AVNU SDK).
 */

import { TokenInfo } from '@/config/tokens';

export type PrivacyMode = 'MAX_PRIVACY' | 'BALANCED' | 'MAX_SPEED';

export interface TradingIntent {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: bigint;
  side: 'BUY' | 'SELL';
  maxSlippageBps: number; // e.g. 50 = 0.5%
  deadlineSeconds: number;
  privacyPreference: PrivacyMode; // lambda weight
}

export interface RouteVenue {
  id: 'STRK20_INTERNAL' | 'AVNU_AGGREGATOR' | 'EKUBO_CLMM' | 'JEDISWAP_AMM' | 'PARADEX_RFQ';
  name: string;
  type: 'SHIELDED_POOL' | 'DEX_AGGREGATOR' | 'CONCENTRATED_AMM' | 'AMM' | 'PRIVATE_RFQ';
  icon: string;
}

export interface RouteHop {
  venue: RouteVenue;
  tokenIn: string;
  tokenOut: string;
  portionBps: number; // e.g. 10000 = 100%
  expectedOutput: bigint;
  feeToken: string;
  feeAmount: bigint;
  gasEstimatedGwei: number;
  latencyMs: number;
  // Privacy Leakage Signals (0 to 1)
  addressLinkage: number;      // A
  timingCorrelation: number;   // T
  calldataLeakage: number;     // C
  marketMetadataLeakage: number;// M
}

export interface ComputedRoute {
  id: string;
  intent: TradingIntent;
  hops: RouteHop[];
  totalExpectedOutput: bigint;
  minGuaranteedOutput: bigint;
  effectivePrice: number;
  priceImpactPct: number;
  totalGasEstimateGwei: number;
  totalFeeUsd: number;
  executionLatencyMs: number;
  
  // Privacy Metrics
  privacyLeakageScore: number; // Lambda(r) in [0, 100] (0 = Zero Leakage, 100 = Fully Exposed)
  anonymitySetScore: number;   // H = log2(n)
  privacyTier: 'SHIELDED' | 'SEMI_PRIVATE' | 'PUBLIC';
  
  // Composite Objective Score (Lower is Better)
  compositeCostScore: number;
  isRecommended: boolean;
}

class RouterService {
  /**
   * Calculate Privacy Leakage Score according to Section 5.4:
   * Lambda(r) = wa * A + wt * T + wc * C + wm * M
   */
  calculatePrivacyLeakage(hop: RouteHop): number {
    const wa = 0.40; // Address linkage weight
    const wt = 0.20; // Timing correlation weight
    const wc = 0.25; // Calldata / observable execution leakage weight
    const wm = 0.15; // Market metadata leakage weight

    const rawScore = (
      wa * hop.addressLinkage +
      wt * hop.timingCorrelation +
      wc * hop.calldataLeakage +
      wm * hop.marketMetadataLeakage
    );

    return Math.min(100, Math.max(0, Math.round(rawScore * 100)));
  }

  /**
   * Lambda coefficient based on user privacy preference (Section 5.3)
   */
  getLambdaWeight(mode: PrivacyMode): number {
    switch (mode) {
      case 'MAX_PRIVACY': return 2.5;
      case 'BALANCED': return 1.0;
      case 'MAX_SPEED': return 0.2;
    }
  }

  /**
   * Find and rank executable routes across Starknet venues
   */
  async findOptimalRoutes(intent: TradingIntent, currentPrices: Record<string, number>): Promise<ComputedRoute[]> {
    const inDecimals = intent.tokenIn.decimals;
    const outDecimals = intent.tokenOut.decimals;
    const inAmountNum = Number(intent.amountIn) / 10 ** inDecimals;
    
    const priceIn = currentPrices[intent.tokenIn.symbol] || 1;
    const priceOut = currentPrices[intent.tokenOut.symbol] || 1;
    const baseOutputNum = (inAmountNum * priceIn) / priceOut;

    const lambda = this.getLambdaWeight(intent.privacyPreference);

    // Route 1: STRK20 Internal Note Swap (100% Confidential Peer Pool)
    const strk20Hop: RouteHop = {
      venue: {
        id: 'STRK20_INTERNAL',
        name: 'STRK20 Note Swap',
        type: 'SHIELDED_POOL',
        icon: 'Shield',
      },
      tokenIn: intent.tokenIn.symbol,
      tokenOut: intent.tokenOut.symbol,
      portionBps: 10000,
      expectedOutput: BigInt(Math.floor(baseOutputNum * 0.9985 * 10 ** outDecimals)),
      feeToken: intent.tokenIn.symbol,
      feeAmount: BigInt(Math.floor(inAmountNum * 0.0015 * 10 ** inDecimals)),
      gasEstimatedGwei: 80,
      latencyMs: 1200,
      addressLinkage: 0.02,
      timingCorrelation: 0.05,
      calldataLeakage: 0.01,
      marketMetadataLeakage: 0.05,
    };

    // Route 2: AVNU Smart DEX Router with Anonymizer Wrapper
    const avnuHop: RouteHop = {
      venue: {
        id: 'AVNU_AGGREGATOR',
        name: 'AVNU + Privacy Wrapper',
        type: 'DEX_AGGREGATOR',
        icon: 'Layers',
      },
      tokenIn: intent.tokenIn.symbol,
      tokenOut: intent.tokenOut.symbol,
      portionBps: 10000,
      expectedOutput: BigInt(Math.floor(baseOutputNum * 0.9995 * 10 ** outDecimals)),
      feeToken: intent.tokenIn.symbol,
      feeAmount: BigInt(Math.floor(inAmountNum * 0.0005 * 10 ** inDecimals)),
      gasEstimatedGwei: 45,
      latencyMs: 450,
      addressLinkage: 0.25,
      timingCorrelation: 0.30,
      calldataLeakage: 0.20,
      marketMetadataLeakage: 0.35,
    };

    // Route 3: Ekubo Direct CLMM (Max Output, Public Trace)
    const ekuboHop: RouteHop = {
      venue: {
        id: 'EKUBO_CLMM',
        name: 'Ekubo CLMM Direct',
        type: 'CONCENTRATED_AMM',
        icon: 'Zap',
      },
      tokenIn: intent.tokenIn.symbol,
      tokenOut: intent.tokenOut.symbol,
      portionBps: 10000,
      expectedOutput: BigInt(Math.floor(baseOutputNum * 1.0002 * 10 ** outDecimals)),
      feeToken: intent.tokenIn.symbol,
      feeAmount: BigInt(Math.floor(inAmountNum * 0.0003 * 10 ** inDecimals)),
      gasEstimatedGwei: 30,
      latencyMs: 300,
      addressLinkage: 0.95,
      timingCorrelation: 0.85,
      calldataLeakage: 0.90,
      marketMetadataLeakage: 0.90,
    };

    const candidateHops = [strk20Hop, avnuHop, ekuboHop];

    const routes: ComputedRoute[] = candidateHops.map((hop, idx) => {
      const leakage = this.calculatePrivacyLeakage(hop);
      const outputNum = Number(hop.expectedOutput) / 10 ** outDecimals;
      const slippageTolerance = 1 - (intent.maxSlippageBps / 10000);
      const minOutput = BigInt(Math.floor(outputNum * slippageTolerance * 10 ** outDecimals));
      const priceImpact = Math.max(0.01, (inAmountNum * priceIn) / 200000 * 100);
      
      // Cost Objective C(r) calculation (Section 5.3)
      const pricePenalty = Math.max(0, (baseOutputNum - outputNum) * priceOut);
      const feeUsd = (Number(hop.feeAmount) / 10 ** inDecimals) * priceIn;
      const gasUsd = (hop.gasEstimatedGwei * 0.000001) * 3400; // ETH gas price conversion
      const latencyCost = (hop.latencyMs / 1000) * 0.05;
      const privacyCost = lambda * (leakage / 10);

      const compositeCost = pricePenalty + feeUsd + gasUsd + latencyCost + privacyCost;

      let tier: 'SHIELDED' | 'SEMI_PRIVATE' | 'PUBLIC' = 'PUBLIC';
      if (leakage < 15) tier = 'SHIELDED';
      else if (leakage < 45) tier = 'SEMI_PRIVATE';

      return {
        id: `route_${hop.venue.id.toLowerCase()}_${idx}`,
        intent,
        hops: [hop],
        totalExpectedOutput: hop.expectedOutput,
        minGuaranteedOutput: minOutput,
        effectivePrice: inAmountNum > 0 ? outputNum / inAmountNum : 0,
        priceImpactPct: Number(priceImpact.toFixed(3)),
        totalGasEstimateGwei: hop.gasEstimatedGwei,
        totalFeeUsd: Number(feeUsd.toFixed(4)),
        executionLatencyMs: hop.latencyMs,
        privacyLeakageScore: leakage,
        anonymitySetScore: tier === 'SHIELDED' ? 9.8 : tier === 'SEMI_PRIVATE' ? 6.2 : 1.5,
        privacyTier: tier,
        compositeCostScore: Number(compositeCost.toFixed(4)),
        isRecommended: false,
      };
    });

    // Rank routes based on lowest composite cost score
    routes.sort((a, b) => a.compositeCostScore - b.compositeCostScore);
    if (routes.length > 0) {
      routes[0].isRecommended = true;
    }

    return routes;
  }
}

export const routerService = new RouterService();
