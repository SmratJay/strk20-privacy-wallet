/**
 * @file src/ai/health.ts
 * @description Deterministic treasury health / risk metrics for the Hamster AI copilot.
 *
 * Pure functions — no network, no wallet, no LLM. Everything is derived from the existing
 * portfolio summary (aggregate balances + prices) and the active TreasuryPolicy. The health
 * score is a simple, documented weighted penalty model; it is NOT a substitute for the
 * deterministic policy (evaluateProposal) which remains the execution gate.
 */
import { ActionProposal } from '@/ai/schema';
import { PolicyVerdict, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TreasuryHealth {
  /** 0..100 — higher is healthier. Advisory only. */
  healthScore: number;
  /** Top-asset allocation %. */
  concentrationPct: number;
  concentrationRisk: RiskLevel;
  /** USD of liquid positions (usable toward the liquidity policy). */
  liquidityUsd: number;
  /** Active policy minimum liquidity. */
  liquidityTargetUsd: number;
  /** liquidity / target (0 when target is 0). */
  liquidityRatio: number;
  liquidityRisk: RiskLevel;
  diversification: 'low' | 'medium' | 'high';
  assetCount: number;
  /** liquidity − target (negative = below the active minimum). */
  policyHeadroomUsd: number;
  /** True when liquidity meets the active minimum. */
  aboveLiquidityTarget: boolean;
}

/**
 * Compute treasury health from the portfolio + active policy.
 *
 * Health score (documented, deterministic):
 *   start 100
 *   − max(0, concentrationPct − 40) × 0.5   (100% concentration → −30)
 *   − (1 − liquidityRatio) × 40 when below the target (up to −40)
 *   − (3 − assetCount) × 10 when fewer than 3 assets (1 asset → −20)
 *   clamped to 0..100.
 */
export function computeTreasuryHealth(summary: PortfolioSummary, policy: TreasuryPolicy): TreasuryHealth {
  const assetCount = summary.positions.length;
  const concentrationPct = summary.topAsset?.pct ?? 0;
  const liquidityUsd = summary.liquidityUsd;
  const target = policy.minLiquidityUsd;
  const liquidityRatio = target > 0 ? liquidityUsd / target : liquidityUsd > 0 ? Number.POSITIVE_INFINITY : 0;

  const concentrationRisk: RiskLevel = concentrationPct > 80 ? 'high' : concentrationPct > 60 ? 'medium' : 'low';
  const liquidityRisk: RiskLevel =
    liquidityRatio < 1 ? 'critical' : liquidityRatio < 1.5 ? 'high' : liquidityRatio < 2 ? 'medium' : 'low';
  const diversification: 'low' | 'medium' | 'high' = assetCount >= 4 ? 'high' : assetCount >= 3 ? 'medium' : 'low';

  let score = 100;
  score -= Math.max(0, concentrationPct - 40) * 0.5;
  if (liquidityRatio < 1) score -= (1 - liquidityRatio) * 40;
  if (assetCount < 3) score -= (3 - assetCount) * 10;
  score = Math.max(0, Math.min(100, score));

  return {
    healthScore: score,
    concentrationPct,
    concentrationRisk,
    liquidityUsd,
    liquidityTargetUsd: target,
    liquidityRatio,
    liquidityRisk,
    diversification,
    assetCount,
    policyHeadroomUsd: liquidityUsd - target,
    aboveLiquidityTarget: liquidityUsd >= target,
  };
}

/**
 * Extract a user-requested liquidity target from a natural-language request, e.g.
 * "keep at least $50 liquid" → 50, "keep $1,000 liquid" → 1000.
 *
 * This is a lightweight heuristic for the request-vs-policy display ONLY. It never changes
 * the active policy: if the requested target conflicts with the policy, the UI explains the
 * conflict instead of silently honoring the request. Returns null when no liquidity target is
 * mentioned.
 */
export function extractRequestedLiquidityUsd(prompt: string): number | null {
  if (!prompt || !/liquid/i.test(prompt)) return null;
  const normalized = prompt.replace(/,/g, '');
  const m = /(?:\$\s*(\d+(?:\.\d+)?))|(\d+(?:\.\d+)?)\s*(?:dollars?|usd)/i.exec(normalized);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Request-vs-policy conflict check. The user may ask for a liquidity target that is LOWER
 * than the active policy minimum; the policy is never silently lowered to honor the request.
 * Returns true when the requested target conflicts with the active policy (i.e. execution
 * that keeps only the requested amount would be blocked by the policy).
 */
export function liquidityRequestConflicts(requestedUsd: number | null, policy: TreasuryPolicy): boolean {
  if (requestedUsd === null || requestedUsd < 0) return false;
  return requestedUsd < policy.minLiquidityUsd;
}

export type Actionability = 'ADVISORY' | 'EXECUTABLE' | 'BLOCKED';

/**
 * Classify what the user can do with the current proposal:
 *   - ADVISORY: a report — the copilot diagnosed but proposed no action (nothing executes).
 *   - EXECUTABLE: a concrete action exists AND every deterministic policy check passes.
 *   - BLOCKED: a concrete action exists but the policy rejects it (show the failed checks).
 */
export function classifyActionability(proposal: ActionProposal, verdict: PolicyVerdict): Actionability {
  if (proposal.action.type === 'report') return 'ADVISORY';
  return verdict.allowed ? 'EXECUTABLE' : 'BLOCKED';
}

/** Failed policy checks for a blocked verdict (label + detail), for the UI to explain. */
export function blockedPolicyChecks(verdict: PolicyVerdict): { id: string; label: string; detail: string }[] {
  return verdict.checks.filter((c) => !c.passed).map((c) => ({ id: c.id, label: c.label, detail: c.detail }));
}

export interface Diagnosis {
  concentrationLine: string;
  liquidityLine: string;
  diversificationLine: string;
  bestNextStep: string;
}

/**
 * Build the "Hamster's Take" diagnosis from computed health + portfolio data. Pure and
 * data-driven — every number comes from the actual portfolio/policy; only the wording is
 * templated. The AI recommendation (proposal.reason) is shown separately and is structured
 * via the proposal schema, never parsed from prose.
 */
export function buildDiagnosis(health: TreasuryHealth, summary: PortfolioSummary): Diagnosis {
  const topSymbol = summary.topAsset?.symbol ?? '—';
  const concentrationLine = `${health.concentrationPct.toFixed(0)}% of your private treasury is ${topSymbol}.`;
  const targetLabel = `$${health.liquidityTargetUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const liquidityLine = health.aboveLiquidityTarget
    ? `Liquidity is $${health.liquidityUsd.toFixed(2)}, above the ${targetLabel} policy minimum.`
    : `You have $${health.liquidityUsd.toFixed(2)} liquid against a ${targetLabel} minimum policy.`;
  const diversificationLine =
    health.assetCount <= 1
      ? 'Only one asset exists in the treasury.'
      : `${health.assetCount} assets; diversification is ${health.diversification}.`;

  let bestNextStep: string;
  if (!health.aboveLiquidityTarget) {
    bestNextStep = 'Increase liquidity before attempting a rebalance.';
  } else if (health.concentrationRisk === 'high') {
    bestNextStep = 'Reduce concentration by rebalancing into another approved asset.';
  } else {
    bestNextStep = 'No action is required; the treasury is within policy.';
  }

  return { concentrationLine, liquidityLine, diversificationLine, bestNextStep };
}