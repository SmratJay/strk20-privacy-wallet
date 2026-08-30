/**
 * @file src/ai/tools.ts
 * @description Deterministic tool layer for the Hamster treasury agent.
 *
 * The agent interacts with the treasury ONLY through these domain tools. Every tool reads or
 * simulates over real portfolio/policy state using the same deterministic functions the rest of
 * the app uses (portfolio, policy, simulateAction). No tool exposes wallet/signing primitives,
 * viewing keys, notes, or arbitrary calldata to the model. Tools NEVER execute anything.
 *
 * The registry is strongly typed: unsupported tool names and malformed args are rejected without
 * any execution.
 */
import { ActionProposal } from '@/ai/schema';
import {
  simulateAction,
  ScenarioSimulation,
  evaluateProposal,
  TreasuryPolicy,
} from '@/ai/policy';
import { PortfolioSummary, PortfolioAssetPosition } from '@/ai/portfolio';
import { computeTreasuryHealth, TreasuryHealth } from '@/ai/health';
import { AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';
import { parseAmountExact, isZeroAmount } from '@/ai/amount';
import { generateRebalanceCandidates, RebalanceCandidate, selectBestAction } from '@/ai/plan';
import { verifyExecution, ExecutionVerification } from '@/ai/verification';
import { ShadowAccountCapability } from '@/ai/shadow';

export interface RecentActivityRow {
  id: string;
  amount: string;
  tokenSymbol: string;
  status: string;
}

export interface AgentIdentity {
  userAddress: string;
  privateTreasuryAddress: string;
  verification: 'privy' | 'client-claimed';
}

export interface AgentExecutionState {
  status: 'idle' | 'running' | 'success' | 'failure';
  transactionHash?: string;
  reason?: string;
  expected?: ScenarioSimulation;
}

/** Everything a tool can read. Built server-side from real state; never from the model. */
export interface AgentToolContext {
  summary: PortfolioSummary;
  policy: TreasuryPolicy;
  health: TreasuryHealth;
  prices: Record<string, AssetPrice>;
  identity: AgentIdentity;
  recentActivity: RecentActivityRow[];
  shadowCapability: ShadowAccountCapability;
  executionState?: AgentExecutionState;
  /** Optional live refresh (client injects it; the server has no wallet access). */
  refreshPortfolio?: () => Promise<PortfolioSummary>;
}

export type ToolId =
  | 'get_portfolio'
  | 'get_treasury_health'
  | 'get_policy'
  | 'get_prices'
  | 'get_private_identity'
  | 'get_approved_destinations'
  | 'get_recent_activity'
  | 'simulate_transfer'
  | 'simulate_rebalance'
  | 'compare_scenarios'
  | 'inspect_concentration'
  | 'inspect_liquidity'
  | 'inspect_diversification'
  | 'prepare_private_transfer'
  | 'prepare_shadow_execution'
  | 'get_execution_status'
  | 'refresh_portfolio'
  | 'compare_expected_vs_actual';

export interface ToolCallIntent {
  type: 'tool_call';
  tool: string;
  args: Record<string, unknown>;
}

export type ToolResult =
  | { ok: true; tool: string; output: unknown }
  | { ok: false; tool: string; error: string };

export interface AgentTool {
  name: ToolId;
  description: string;
  validateArgs: (raw: unknown) => { ok: true; args: Record<string, unknown> } | { ok: false; error: string };
  run: (ctx: AgentToolContext, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

// ─── Arg validators (no schema library; plain guards like the rest of src/ai) ───

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function canonicalToken(token: string): string {
  const c = canonicalizeAddress(token);
  return c.ok ? c.value : token.toLowerCase();
}

function positionFor(ctx: AgentToolContext, asset: string): PortfolioAssetPosition | undefined {
  const target = canonicalToken(asset);
  return ctx.summary.positions.find((p) => canonicalToken(p.token) === target);
}

function validateNoArgs(raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, args: {} };
  if (!isRecord(raw)) return { ok: false, error: 'args must be an object' };
  return { ok: true, args: raw };
}

function validateAssetAmount(raw: unknown, ctx?: AgentToolContext): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'args must be an object' };
  const asset = raw.asset;
  const amount = raw.amount;
  if (typeof asset !== 'string' || asset.trim() === '') return { ok: false, error: 'args.asset (token address) is required' };
  if (typeof amount !== 'string' || amount.trim() === '' || !/^\d+(\.\d+)?$/.test(amount.trim()) || isZeroAmount(amount)) {
    return { ok: false, error: 'args.amount must be a positive plain decimal string' };
  }
  return { ok: true, args: { asset: asset.trim(), amount: amount.trim() } };
}

// ─── Tool implementations ─────────────────────────────────────────────────

function toolGetPortfolio(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_portfolio',
    output: {
      totalUsd: round2(ctx.summary.totalUsd),
      liquidityUsd: round2(ctx.summary.liquidityUsd),
      liquidPct: round1(ctx.summary.liquidPct),
      positions: ctx.summary.positions.map((p) => ({
        symbol: p.symbol,
        token: p.token,
        balanceHuman: round4(p.balanceHuman),
        usdValue: round2(p.usdValue),
        pct: round1(p.pct),
        liquid: p.liquid,
        priceSource: p.priceSource,
      })),
    },
  };
}

function toolGetTreasuryHealth(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_treasury_health',
    output: {
      healthScore: round1(ctx.health.healthScore),
      concentrationPct: round1(ctx.health.concentrationPct),
      concentrationRisk: ctx.health.concentrationRisk,
      liquidityUsd: round2(ctx.health.liquidityUsd),
      liquidityTargetUsd: ctx.health.liquidityTargetUsd,
      liquidityRatio: round2(ctx.health.liquidityRatio),
      diversification: ctx.health.diversification,
      assetCount: ctx.health.assetCount,
      aboveLiquidityTarget: ctx.health.aboveLiquidityTarget,
      policyHeadroomUsd: round2(ctx.health.policyHeadroomUsd),
    },
  };
}

function toolGetPolicy(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_policy',
    output: {
      minLiquidityUsd: ctx.policy.minLiquidityUsd,
      maxPositionPct: ctx.policy.maxPositionPct,
      maxTxUsd: ctx.policy.maxTxUsd,
      allowedAssets: ctx.policy.allowedAssets.length,
      approvedDestinations: ctx.policy.allowedDestinations,
      selfTransferAddress: ctx.policy.selfTransferAddress ?? null,
    },
  };
}

function toolGetPrices(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_prices',
    output: ctx.summary.positions.map((p) => ({
      symbol: p.symbol,
      priceUsd: p.priceUsd,
      source: p.priceSource,
      priceFetchedAt: p.priceFetchedAt ?? null,
    })),
  };
}

function toolGetPrivateIdentity(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_private_identity',
    output: {
      privateTreasuryAddress: ctx.identity.privateTreasuryAddress,
      userAddress: ctx.identity.userAddress,
      verification: ctx.identity.verification,
      shadowAccountsEnabled: ctx.shadowCapability.enabled,
    },
  };
}

function toolGetApprovedDestinations(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_approved_destinations',
    output: {
      approved: ctx.policy.allowedDestinations,
      userAddress: ctx.identity.userAddress,
    },
  };
}

function toolGetRecentActivity(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_recent_activity',
    output: { activity: ctx.recentActivity },
  };
}

function simulate(ctx: AgentToolContext, asset: string, amount: string): ScenarioSimulation {
  return simulateAction(ctx.summary, ctx.policy, { asset, amount });
}

function toolSimulateTransfer(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset);
  const amount = String(args.amount);
  const pos = positionFor(ctx, asset);
  if (!pos) return { ok: false, tool: 'simulate_transfer', error: `${asset} is not a treasury position.` };
  const sim = simulate(ctx, asset, amount);
  if (!sim.ok) return { ok: false, tool: 'simulate_transfer', error: sim.error ?? 'simulation failed' };
  return { ok: true, tool: 'simulate_transfer', output: scenarioOutput(pos.symbol, sim) };
}

function toolSimulateRebalance(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset ?? '');
  const target = positionFor(ctx, asset);
  if (!target && asset !== '') return { ok: false, tool: 'simulate_rebalance', error: `${asset} is not a treasury position.` };
  const candidates = generateRebalanceCandidates(ctx.summary, ctx.policy, { asset: asset || undefined });
  return {
    ok: true,
    tool: 'simulate_rebalance',
    output: candidates.map((c) => ({
      id: c.id,
      label: c.label,
      asset: c.action.asset,
      amount: c.action.amount,
      concentrationBefore: round1(c.simulation.before.concentrationPct),
      concentrationAfter: round1(c.simulation.after.concentrationPct),
      liquidityAfter: round2(c.simulation.after.liquidityUsd),
      policyCompliant: c.policyCompliant,
    })),
  };
}

function toolCompareScenarios(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const list = args.scenarios;
  if (!Array.isArray(list) || list.length === 0 || list.length > 6) {
    return { ok: false, tool: 'compare_scenarios', error: 'args.scenarios must be an array of 1..6 { asset, amount }' };
  }
  const out: unknown[] = [];
  for (const item of list) {
    const rec = isRecord(item) ? item : {};
    const asset = rec.asset;
    const amount = rec.amount;
    if (typeof asset !== 'string' || typeof amount !== 'string') {
      return { ok: false, tool: 'compare_scenarios', error: 'each scenario needs asset and amount' };
    }
    const pos = positionFor(ctx, asset);
    if (!pos) return { ok: false, tool: 'compare_scenarios', error: `${asset} is not a treasury position.` };
    const sim = simulate(ctx, asset, amount);
    if (!sim.ok) {
      out.push({ asset, amount, error: sim.error });
    } else {
      out.push(scenarioOutput(pos.symbol, sim));
    }
  }
  return { ok: true, tool: 'compare_scenarios', output: { scenarios: out } };
}

function toolInspectConcentration(ctx: AgentToolContext): ToolResult {
  const top = ctx.summary.topAsset;
  const cap = ctx.policy.maxPositionPct;
  return {
    ok: true,
    tool: 'inspect_concentration',
    output: {
      topAsset: top?.symbol ?? null,
      concentrationPct: round1(ctx.health.concentrationPct),
      cap: cap >= 100 ? 'off' : cap,
      aboveCap: cap < 100 && ctx.health.concentrationPct > cap,
      assetCount: ctx.summary.positions.length,
    },
  };
}

function toolInspectLiquidity(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'inspect_liquidity',
    output: {
      liquidityUsd: round2(ctx.health.liquidityUsd),
      floor: ctx.policy.minLiquidityUsd,
      aboveFloor: ctx.health.aboveLiquidityTarget,
      headroomUsd: round2(Math.max(0, ctx.health.liquidityUsd - ctx.policy.minLiquidityUsd)),
      shortfallUsd: round2(Math.max(0, ctx.policy.minLiquidityUsd - ctx.health.liquidityUsd)),
    },
  };
}

function toolInspectDiversification(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'inspect_diversification',
    output: {
      assetCount: ctx.health.assetCount,
      diversification: ctx.health.diversification,
      topAssetPct: round1(ctx.health.concentrationPct),
    },
  };
}

function toolPreparePrivateTransfer(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset);
  const amount = String(args.amount);
  const requestedRecipient = typeof args.recipient === 'string' && args.recipient.trim() !== '' ? args.recipient.trim() : null;
  const pos = positionFor(ctx, asset);
  if (!pos) return { ok: false, tool: 'prepare_private_transfer', error: `${asset} is not a treasury position.` };

  let recipient: string | null = null;
  if (requestedRecipient) {
    const target = canonicalToken(requestedRecipient);
    const approved = ctx.policy.allowedDestinations.some((d) => canonicalToken(d) === target);
    if (!approved) {
      return { ok: false, tool: 'prepare_private_transfer', error: 'recipient is not an approved destination.' };
    }
    recipient = requestedRecipient;
  } else {
    recipient = ctx.policy.allowedDestinations[0] ?? null;
  }
  if (!recipient) {
    return { ok: false, tool: 'prepare_private_transfer', error: 'no approved destination is configured; execution is unavailable.' };
  }

  const proposal: ActionProposal = {
    intent: 'rebalance',
    reason: 'Agent-prepared private transfer',
    action: { type: 'private_transfer', asset, amount, recipient },
    requiresUserConfirmation: true,
  };
  const verdict = evaluateProposal(proposal, ctx.summary, ctx.policy);
  const sim = simulate(ctx, asset, amount);
  return {
    ok: true,
    tool: 'prepare_private_transfer',
    output: {
      prepared: {
        type: 'private_transfer',
        asset,
        amount,
        recipient,
        amountBaseUnits: verdict.amountBaseUnits.toString(),
        amountUsd: round2(verdict.amountUsd),
      },
      simulation: sim.ok ? scenarioOutput(pos.symbol, sim) : { error: sim.error },
      verdict: {
        allowed: verdict.allowed,
        reportOnly: verdict.reportOnly,
        failedChecks: verdict.checks.filter((c) => !c.passed).map((c) => c.id),
      },
      note: 'prepared only — nothing is executed until the user reviews and confirms.',
    },
  };
}

function toolPrepareShadowExecution(ctx: AgentToolContext, _args: Record<string, unknown>): ToolResult {
  const cap = ctx.shadowCapability;
  if (!cap.enabled) {
    return {
      ok: false,
      tool: 'prepare_shadow_execution',
      error: `shadow account capability is disabled: ${cap.reason}. The standard private-transfer path remains available.`,
    };
  }
  return {
    ok: true,
    tool: 'prepare_shadow_execution',
    output: {
      supported: true,
      note: 'shadow account execution is prepared client-side after user confirmation; the server never receives the viewing key.',
      anonymizerAddress: cap.anonymizerAddress,
      dappName: cap.dappName,
    },
  };
}

function toolGetExecutionStatus(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_execution_status',
    output: ctx.executionState ?? { status: 'idle' },
  };
}

async function toolRefreshPortfolio(ctx: AgentToolContext): Promise<ToolResult> {
  const portfolioOutput = (toolGetPortfolio(ctx) as { ok: true; output: unknown }).output;
  if (!ctx.refreshPortfolio) {
    return { ok: true, tool: 'refresh_portfolio', output: { refreshed: false, summary: portfolioOutput } };
  }
  const summary = await ctx.refreshPortfolio();
  const health = computeTreasuryHealth(summary, ctx.policy);
  return {
    ok: true,
    tool: 'refresh_portfolio',
    output: { refreshed: true, summary: (toolGetPortfolio({ ...ctx, summary, health } as AgentToolContext) as { ok: true; output: unknown }).output },
  };
}

function toolCompareExpectedVsActual(ctx: AgentToolContext): ToolResult {
  const expected = ctx.executionState?.expected;
  if (!expected) {
    return { ok: false, tool: 'compare_expected_vs_actual', error: 'no expected outcome from a prior execution to compare.' };
  }
  const verification: ExecutionVerification = verifyExecution(expected.after, ctx.summary);
  return {
    ok: true,
    tool: 'compare_expected_vs_actual',
    output: {
      before: expected.before,
      expected: expected.after,
      actual: verification.actual,
      matches: verification.matches,
      tolerancePct: verification.tolerancePct,
    },
  };
}

// ─── Registry ──────────────────────────────────────────────────────────────

export const AGENT_TOOLS: Record<ToolId, AgentTool> = {
  get_portfolio: { name: 'get_portfolio', description: 'Read the private treasury portfolio (positions, USD values, allocations).', validateArgs: validateNoArgs, run: toolGetPortfolio },
  get_treasury_health: { name: 'get_treasury_health', description: 'Read advisory health: concentration, liquidity, diversification.', validateArgs: validateNoArgs, run: toolGetTreasuryHealth },
  get_policy: { name: 'get_policy', description: 'Read the active deterministic guardrail and approved destinations.', validateArgs: validateNoArgs, run: toolGetPolicy },
  get_prices: { name: 'get_prices', description: 'Read per-position USD prices and their freshness.', validateArgs: validateNoArgs, run: toolGetPrices },
  get_private_identity: { name: 'get_private_identity', description: 'Read the STRK20 private identity and shadow-account capability.', validateArgs: validateNoArgs, run: toolGetPrivateIdentity },
  get_approved_destinations: { name: 'get_approved_destinations', description: 'Read the approved private destinations for execution.', validateArgs: validateNoArgs, run: toolGetApprovedDestinations },
  get_recent_activity: { name: 'get_recent_activity', description: 'Read recent treasury activity.', validateArgs: validateNoArgs, run: toolGetRecentActivity },
  simulate_transfer: { name: 'simulate_transfer', description: 'Simulate moving an amount of an asset to the approved reserve (never executes).', validateArgs: validateAssetAmount, run: toolSimulateTransfer },
  simulate_rebalance: { name: 'simulate_rebalance', description: 'Generate deterministic rebalance candidates for an over-concentrated asset.', validateArgs: (raw) => (isRecord(raw) && (raw.asset === undefined || typeof raw.asset === 'string') ? { ok: true, args: { asset: typeof raw.asset === 'string' ? raw.asset : '' } } : { ok: false, error: 'args.asset must be a string' }), run: toolSimulateRebalance },
  compare_scenarios: { name: 'compare_scenarios', description: 'Compare 1..6 { asset, amount } candidate moves and their policy status.', validateArgs: (raw) => (isRecord(raw) ? { ok: true, args: raw } : { ok: false, error: 'args must be an object' }), run: toolCompareScenarios },
  inspect_concentration: { name: 'inspect_concentration', description: 'Inspect concentration vs the guardrail cap.', validateArgs: validateNoArgs, run: toolInspectConcentration },
  inspect_liquidity: { name: 'inspect_liquidity', description: 'Inspect liquidity vs the guardrail floor.', validateArgs: validateNoArgs, run: toolInspectLiquidity },
  inspect_diversification: { name: 'inspect_diversification', description: 'Inspect diversification by asset count.', validateArgs: validateNoArgs, run: toolInspectDiversification },
  prepare_private_transfer: { name: 'prepare_private_transfer', description: 'Prepare a private-transfer action (validates + evaluates policy; never executes).', validateArgs: (raw) => { const r = validateAssetAmount(raw); if (!r.ok) return r; return isRecord(raw) ? { ok: true, args: raw } : r; }, run: toolPreparePrivateTransfer },
  prepare_shadow_execution: { name: 'prepare_shadow_execution', description: 'Check whether shadow-account execution is available (feature-gated).', validateArgs: validateNoArgs, run: toolPrepareShadowExecution },
  get_execution_status: { name: 'get_execution_status', description: 'Read the current execution status.', validateArgs: validateNoArgs, run: toolGetExecutionStatus },
  refresh_portfolio: { name: 'refresh_portfolio', description: 'Refresh the portfolio from fresh state.', validateArgs: validateNoArgs, run: toolRefreshPortfolio },
  compare_expected_vs_actual: { name: 'compare_expected_vs_actual', description: 'Compare a prior execution expectation against the current portfolio.', validateArgs: validateNoArgs, run: toolCompareExpectedVsActual },
};

export const AGENT_TOOL_NAMES: ToolId[] = Object.keys(AGENT_TOOLS) as ToolId[];

/**
 * Execute a tool call from the model. Unsupported tools and malformed args are rejected
 * without executing anything. Returns a discriminated result to feed back to the model.
 */
export function executeTool(ctx: AgentToolContext, intent: ToolCallIntent): Promise<ToolResult> {
  const tool = AGENT_TOOLS[intent.tool as ToolId];
  if (!tool) {
    return Promise.resolve({ ok: false, tool: intent.tool, error: `unsupported tool: ${intent.tool}` });
  }
  const validated = tool.validateArgs(intent.args);
  if (!validated.ok) {
    return Promise.resolve({ ok: false, tool: intent.tool, error: validated.error });
  }
  const result = tool.run(ctx, validated.args);
  return Promise.resolve(result);
}

/** Best compliant rebalance candidate (deterministic). */
export function bestRebalanceAction(ctx: AgentToolContext): RebalanceCandidate | null {
  return selectBestAction(generateRebalanceCandidates(ctx.summary, ctx.policy));
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function scenarioOutput(symbol: string, sim: ScenarioSimulation): unknown {
  return {
    symbol,
    amount: sim.amountHuman,
    estimated: sim.estimated,
    before: { concentrationPct: round1(sim.before.concentrationPct), liquidityUsd: round2(sim.before.liquidityUsd), totalUsd: round2(sim.before.totalUsd) },
    after: { concentrationPct: round1(sim.after.concentrationPct), liquidityUsd: round2(sim.after.liquidityUsd), totalUsd: round2(sim.after.totalUsd) },
    policy: {
      allowed: sim.verdict.allowed,
      reportOnly: sim.verdict.reportOnly,
      failedChecks: sim.verdict.checks.filter((c) => !c.passed).map((c) => c.id),
    },
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}