/**
 * @file src/ai/tools.ts
 * @description Deterministic tool layer for the Hamster treasury agent.
 *
 * The agent interacts with the treasury ONLY through these domain tools. Every tool reads or
 * simulates over real portfolio/policy state using the same deterministic functions the rest of
 * the app uses (portfolio, policy, simulateAction). No tool exposes wallet/signing primitives,
 * viewing keys, notes, or arbitrary calldata to the model. Tools NEVER execute anything.
 *
 * Tool-surface boundary:
 *   - Model-callable tools are reasoning/read/prepare tools only (10 of them).
 *   - Execution-lifecycle operations (refresh, execution status, verify) are NOT in this registry —
 *     they belong to the ExecutionRouter / UI, not the reasoning surface.
 *   - `prepare_action` produces a validated ExecutionIntent for the router; it never executes.
 */
import { ActionProposal } from '@/ai/schema';
import { simulateAction, ScenarioSimulation, evaluateProposal, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary, PortfolioAssetPosition } from '@/ai/portfolio';
import { computeTreasuryHealth, TreasuryHealth } from '@/ai/health';
import { AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';
import { parseAmountExact, isZeroAmount } from '@/ai/amount';
import { generateRebalanceCandidates, concentrationBreakEvenUsd, RebalanceCandidate } from '@/ai/plan';
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

/** Everything a tool can read. Built server-side from real state; never from the model. */
export interface AgentToolContext {
  summary: PortfolioSummary;
  policy: TreasuryPolicy;
  health: TreasuryHealth;
  prices: Record<string, AssetPrice>;
  identity: AgentIdentity;
  recentActivity: RecentActivityRow[];
  shadowCapability: ShadowAccountCapability;
}

export type ToolId =
  | 'get_portfolio'
  | 'get_health'
  | 'get_policy'
  | 'get_context'
  | 'get_activity'
  | 'inspect_risk'
  | 'generate_options'
  | 'simulate_action'
  | 'compare_scenarios'
  | 'prepare_action';

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

function validateAssetAmount(raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'args must be an object' };
  const asset = raw.asset;
  const amount = raw.amount;
  if (typeof asset !== 'string' || asset.trim() === '') return { ok: false, error: 'args.asset (token address) is required' };
  if (typeof amount !== 'string' || amount.trim() === '' || !/^\d+(\.\d+)?$/.test(amount.trim()) || isZeroAmount(amount)) {
    return { ok: false, error: 'args.amount must be a positive plain decimal string' };
  }
  return { ok: true, args: { asset: asset.trim(), amount: amount.trim() } };
}

function validateAssetOnly(raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'args must be an object' };
  if (raw.asset !== undefined && typeof raw.asset !== 'string') return { ok: false, error: 'args.asset must be a string' };
  return { ok: true, args: { asset: typeof raw.asset === 'string' ? raw.asset : '' } };
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
        priceUsd: p.priceUsd,
        priceSource: p.priceSource,
      })),
    },
  };
}

function toolGetHealth(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_health',
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

function toolGetContext(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_context',
    output: {
      privateTreasuryAddress: ctx.identity.privateTreasuryAddress,
      userAddress: ctx.identity.userAddress,
      verification: ctx.identity.verification,
      approvedDestinations: ctx.policy.allowedDestinations,
      shadowAccountsEnabled: ctx.shadowCapability.enabled,
      shadowReason: ctx.shadowCapability.reason,
    },
  };
}

function toolGetActivity(ctx: AgentToolContext): ToolResult {
  return {
    ok: true,
    tool: 'get_activity',
    output: { activity: ctx.recentActivity },
  };
}

function toolInspectRisk(ctx: AgentToolContext): ToolResult {
  const topPos = [...ctx.summary.positions].sort((a, b) => b.usdValue - a.usdValue)[0];
  const top = ctx.summary.topAsset;
  const cap = ctx.policy.maxPositionPct;
  const aboveCap = cap < 100 && ctx.health.concentrationPct > cap;
  const headroom = Math.max(0, ctx.health.liquidityUsd - ctx.policy.minLiquidityUsd);
  const shortfall = Math.max(0, ctx.policy.minLiquidityUsd - ctx.health.liquidityUsd);
  let dominantRisk: 'concentration' | 'liquidity' | 'diversification' | 'none' = 'none';
  if (aboveCap) dominantRisk = 'concentration';
  else if (!ctx.health.aboveLiquidityTarget) dominantRisk = 'liquidity';
  else if (ctx.health.diversification === 'low') dominantRisk = 'diversification';
  const breakEven = topPos ? concentrationBreakEvenUsd(ctx.summary, ctx.policy, topPos.token) : null;
  return {
    ok: true,
    tool: 'inspect_risk',
    output: {
      dominantRisk,
      topAsset: top?.symbol ?? null,
      concentrationPct: round1(ctx.health.concentrationPct),
      concentrationCap: cap >= 100 ? 'off' : cap,
      aboveCap,
      breakEvenUsd: breakEven === null ? null : round2(breakEven),
      assetCount: ctx.health.assetCount,
      diversification: ctx.health.diversification,
      liquidityUsd: round2(ctx.health.liquidityUsd),
      liquidityFloor: ctx.policy.minLiquidityUsd,
      aboveFloor: ctx.health.aboveLiquidityTarget,
      liquidityHeadroomUsd: round2(headroom),
      liquidityShortfallUsd: round2(shortfall),
    },
  };
}

function simulate(ctx: AgentToolContext, asset: string, amount: string): ScenarioSimulation {
  return simulateAction(ctx.summary, ctx.policy, { asset, amount });
}

function toolSimulateAction(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset);
  const amount = String(args.amount);
  const pos = positionFor(ctx, asset);
  if (!pos) return { ok: false, tool: 'simulate_action', error: `${asset} is not a treasury position.` };
  const sim = simulate(ctx, asset, amount);
  if (!sim.ok) return { ok: false, tool: 'simulate_action', error: sim.error ?? 'simulation failed' };
  return { ok: true, tool: 'simulate_action', output: scenarioOutput(pos.symbol, sim) };
}

function toolGenerateOptions(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset ?? '');
  if (asset !== '' && !positionFor(ctx, asset)) return { ok: false, tool: 'generate_options', error: `${asset} is not a treasury position.` };
  const candidates = generateRebalanceCandidates(ctx.summary, ctx.policy, { asset: asset || undefined });
  return {
    ok: true,
    tool: 'generate_options',
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

function toolPrepareAction(ctx: AgentToolContext, args: Record<string, unknown>): ToolResult {
  const asset = String(args.asset);
  const amount = String(args.amount);
  const requestedRecipient = typeof args.recipient === 'string' && args.recipient.trim() !== '' ? args.recipient.trim() : null;
  const pos = positionFor(ctx, asset);
  if (!pos) return { ok: false, tool: 'prepare_action', error: `${asset} is not a treasury position.` };

  let recipient: string | null = null;
  if (requestedRecipient) {
    const target = canonicalToken(requestedRecipient);
    const approved = ctx.policy.allowedDestinations.some((d) => canonicalToken(d) === target);
    if (!approved) {
      return { ok: false, tool: 'prepare_action', error: 'recipient is not an approved destination.' };
    }
    recipient = requestedRecipient;
  } else {
    recipient = ctx.policy.allowedDestinations[0] ?? null;
  }
  if (!recipient) {
    return { ok: false, tool: 'prepare_action', error: 'no approved destination is configured; execution is unavailable.' };
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
    tool: 'prepare_action',
    output: {
      prepared: {
        type: 'private_transfer',
        asset,
        amount,
        recipient,
        amountBaseUnits: verdict.amountBaseUnits.toString(),
        amountUsd: round2(verdict.amountUsd),
      },
      executionPath: 'standard',
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

// ─── Registry (model-callable surface only) ─────────────────────────────────

export const AGENT_TOOLS: Record<ToolId, AgentTool> = {
  get_portfolio: { name: 'get_portfolio', description: 'Read the private treasury portfolio (positions, USD values, allocations, prices).', validateArgs: validateNoArgs, run: toolGetPortfolio },
  get_health: { name: 'get_health', description: 'Read advisory health: concentration, liquidity, diversification.', validateArgs: validateNoArgs, run: toolGetHealth },
  get_policy: { name: 'get_policy', description: 'Read the active deterministic guardrail and approved destinations.', validateArgs: validateNoArgs, run: toolGetPolicy },
  get_context: { name: 'get_context', description: 'Read the STRK20 private identity, approved destinations, and shadow-account capability.', validateArgs: validateNoArgs, run: toolGetContext },
  get_activity: { name: 'get_activity', description: 'Read recent treasury activity.', validateArgs: validateNoArgs, run: toolGetActivity },
  inspect_risk: { name: 'inspect_risk', description: 'Identify the dominant treasury risk (concentration / liquidity / diversification).', validateArgs: validateNoArgs, run: toolInspectRisk },
  generate_options: { name: 'generate_options', description: 'Generate deterministic, policy-ranked rebalance options for an asset (optional asset).', validateArgs: validateAssetOnly, run: toolGenerateOptions },
  simulate_action: { name: 'simulate_action', description: 'Simulate moving an amount of an asset to the approved reserve (never executes).', validateArgs: validateAssetAmount, run: toolSimulateAction },
  compare_scenarios: { name: 'compare_scenarios', description: 'Compare 1..6 { asset, amount } candidate moves and their policy status.', validateArgs: (raw) => (isRecord(raw) ? { ok: true, args: raw } : { ok: false, error: 'args must be an object' }), run: toolCompareScenarios },
  prepare_action: { name: 'prepare_action', description: 'Prepare a private-transfer action for review (validates + evaluates policy; never executes).', validateArgs: (raw) => { const r = validateAssetAmount(raw); if (!r.ok) return r; return isRecord(raw) ? { ok: true, args: raw } : r; }, run: toolPrepareAction },
};

export const AGENT_TOOL_NAMES: ToolId[] = Object.keys(AGENT_TOOLS) as ToolId[];

/**
 * Execute a tool call from the model. Unsupported tools (including execution-lifecycle tools and
 * any low-level primitives) and malformed args are rejected without executing anything.
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