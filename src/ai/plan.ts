/**
 * @file src/ai/plan.ts
 * @description AgentPlan: the structured output of the Hamster treasury agent.
 *
 * The model emits candidate ACTIONS (asset + amount) and narrative. The server computes every
 * number deterministically with the same simulator the rest of the app uses — the model can
 * never inject scenario outcomes, balances, or prices. Candidate generation and ranking are
 * also deterministic so the "best action" is a pure function of (portfolio, policy).
 */
import { ActionProposal, validateProposal } from '@/ai/schema';
import { simulateAction, ScenarioSimulation, TreasuryPolicy } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';
import { buildDiagnosis, computeTreasuryHealth, TreasuryHealth } from '@/ai/health';
import { canonicalizeAddress } from '@/ai/address';
import { parseAmountExact, isZeroAmount } from '@/ai/amount';
import { ShadowAccountCapability } from '@/ai/shadow';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentScenarioAction {
  type: 'private_transfer';
  asset: string;
  amount: string;
  recipient: string;
}

export interface AgentScenario {
  id: string;
  label: string;
  action: AgentScenarioAction;
  /** REAL computed scenario (deterministic; never model-invented). */
  simulation: ScenarioSimulation;
  policyCompliant: boolean;
}

export type PlanPolicyStatus = 'PASS' | 'FAIL' | 'ADVISORY';

/** The effective guardrail captured when the plan was produced (audit/integrity state). */
export interface GuardrailSnapshot {
  minLiquidityUsd: number;
  maxPositionPct: number;
  maxTxUsd: number;
}

/**
 * The execution portion of an AgentPlan. Server-compiled, deterministic, canonical. The model
 * may only suggest the asset + amount; every derived field (base units, recipient, snapshot,
 * expected simulation, execution path) is filled by the compiler and never trusted from the model.
 *
 * `executionPath` is `standard` for every executable plan in this build. Shadow exists only as a
 * capability/readiness field elsewhere; the router rejects `shadow` as not implemented.
 */
export interface ExecutionIntent {
  executionPath: 'standard' | 'shadow';
  asset: string;
  amountHuman: string;
  /** EXACT base units as a decimal string (server-computed via parseAmountExact). */
  amountBaseUnits: string;
  /** Authoritative approved destination (first approved / user account). */
  recipient: string;
  guardrailSnapshot: GuardrailSnapshot;
  /** The selected scenario's real simulation — used for display AND post-execution verification. */
  expectedSimulation: ScenarioSimulation;
}

export interface AgentPlan {
  type: 'plan';
  goal: string;
  observations: string[];
  risks: string[];
  scenarios: AgentScenario[];
  /** References a scenario id, or null when the plan is advisory (no action). */
  selectedScenarioId: string | null;
  expectedOutcome: string;
  policyStatus: PlanPolicyStatus;
  /** Always true when a state-changing action is selected; the server forces this. */
  requiresUserConfirmation: boolean;
  reason: string;
  /** Canonical executable intent (null for advisory plans). */
  executionIntent: ExecutionIntent | null;
}

/** Model-facing shape: candidate actions + narrative; numbers are filled by the server. */
export interface RawPlanScenario {
  id: string;
  label?: string;
  action: { type: 'private_transfer'; asset: string; amount: string } | null;
}

export interface RawAgentPlan {
  type: 'plan';
  goal: string;
  observations?: string[];
  risks?: string[];
  scenarios: RawPlanScenario[];
  selectedScenarioId?: string | null;
  expectedOutcome?: string;
  requiresUserConfirmation?: boolean;
  reason?: string;
}

export interface PlanContext {
  summary: PortfolioSummary;
  policy: TreasuryPolicy;
  health: TreasuryHealth;
  shadowCapability: ShadowAccountCapability;
}

export function buildPlanContext(summary: PortfolioSummary, policy: TreasuryPolicy, shadowCapability: ShadowAccountCapability): PlanContext {
  return { summary, policy, health: computeTreasuryHealth(summary, policy), shadowCapability };
}

// ─── Candidate generation (deterministic) ──────────────────────────────────

export interface RebalanceCandidate {
  id: string;
  label: string;
  action: { asset: string; amount: string; recipient: string };
  simulation: ScenarioSimulation;
  policyCompliant: boolean;
  /** Deterministic ranking score — lower is better (Infinity = not compliant). */
  score: number;
}

function canonicalToken(token: string): string {
  const c = canonicalizeAddress(token);
  return c.ok ? c.value : token.toLowerCase();
}

function positionFor(summary: PortfolioSummary, token: string) {
  const target = canonicalToken(token);
  return summary.positions.find((p) => canonicalToken(p.token) === target);
}

function roundAmount(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * USD amount of the target asset that, if moved out, would bring its concentration exactly to
 * the cap: x = (assetUsd − cap·total) / (1 − cap). Null when impossible (single asset, cap off).
 */
export function concentrationBreakEvenUsd(summary: PortfolioSummary, policy: TreasuryPolicy, targetToken: string): number | null {
  const cap = policy.maxPositionPct / 100;
  if (cap <= 0 || cap >= 1 || summary.totalUsd <= 0) return null;
  const pos = positionFor(summary, targetToken);
  if (!pos || pos.usdValue <= 0 || pos.priceUsd <= 0) return null;
  const x = (pos.usdValue - cap * summary.totalUsd) / (1 - cap);
  if (x <= 0 || x >= pos.usdValue) return null;
  return x;
}

/**
 * Generate 2..5 deterministic rebalance candidates for an over-concentrated asset.
 * Each candidate is simulated with the real policy math; policy-violating candidates are
 * flagged (and ranked after compliant ones). Never executes anything.
 */
export function generateRebalanceCandidates(
  summary: PortfolioSummary,
  policy: TreasuryPolicy,
  opts: { asset?: string; count?: number } = {},
): RebalanceCandidate[] {
  if (summary.positions.length === 0) return [];

  // Target asset: an explicit address, or the largest position (the concentration driver).
  const position = opts.asset
    ? positionFor(summary, opts.asset)
    : [...summary.positions].sort((a, b) => b.usdValue - a.usdValue)[0];
  if (!position || position.balanceHuman <= 0) return [];

  const count = Math.min(5, Math.max(2, opts.count ?? 4));
  const recipient = policy.allowedDestinations[0] ?? '';

  const amounts = new Set<string>();
  for (const frac of [0.1, 0.25, 0.5, 0.75]) {
    if (amounts.size >= count) break;
    const amount = roundAmount(position.balanceHuman * frac);
    if (amount && !amounts.has(amount)) amounts.add(amount);
  }
  // A candidate sized to bring concentration exactly to the cap (minimal meaningful move).
  const breakEven = concentrationBreakEvenUsd(summary, policy, position.token);
  if (breakEven !== null && amounts.size < count) {
    const amount = roundAmount(breakEven / position.priceUsd);
    if (amount && !amounts.has(amount)) amounts.add(amount);
  }

  const candidates: RebalanceCandidate[] = [];
  let i = 0;
  for (const amount of amounts) {
    i += 1;
    const simulation = simulateAction(summary, policy, { asset: position.token, amount });
    const policyCompliant = simulation.ok && simulation.verdict.allowed;
    const id = `candidate-${i}`;
    candidates.push({
      id,
      label: `move ${amount} ${position.symbol}`,
      action: { asset: position.token, amount, recipient },
      simulation,
      policyCompliant,
      score: scoreCandidate(simulation, policyCompliant),
    });
  }
  return rankCandidates(candidates);
}

/** Deterministic ranking score — favors compliant, meaningful risk reduction, minimal movement. */
export function scoreCandidate(sim: ScenarioSimulation, policyCompliant: boolean): number {
  if (!sim.ok || !policyCompliant) return Number.POSITIVE_INFINITY;
  const amountFrac = sim.after.totalUsd > 0 ? (sim.before.totalUsd - sim.after.totalUsd) / sim.before.totalUsd : 0;
  // Lower concentration-after = more risk reduction; movement is penalized to prefer minimal moves.
  return sim.after.concentrationPct + amountFrac * 50;
}

/** Sort candidates: compliant first (lower score first), non-compliant last, stable. */
export function rankCandidates(candidates: RebalanceCandidate[]): RebalanceCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDiff = a.score - b.score;
    if (scoreDiff !== 0) return scoreDiff;
    if (a.policyCompliant !== b.policyCompliant) return a.policyCompliant ? -1 : 1;
    return b.simulation.after.liquidityUsd - a.simulation.after.liquidityUsd;
  });
}

/** The best compliant candidate, or null when none is compliant. */
export function selectBestAction(candidates: RebalanceCandidate[]): RebalanceCandidate | null {
  return candidates.find((c) => c.policyCompliant) ?? null;
}

// ─── Compilation ────────────────────────────────────────────────────────────

export type CompilePlanResult = { ok: true; plan: AgentPlan } | { ok: false; error: string };

function buildScenario(
  ctx: PlanContext,
  id: string,
  label: string,
  asset: string,
  amount: string,
): AgentScenario | { error: string } {
  const position = positionFor(ctx.summary, asset);
  if (!position) return { error: `${asset} is not a treasury position.` };
  const parsed = parseAmountExact(amount, position.decimals);
  if (!parsed.ok || parsed.value <= 0n) return { error: parsed.ok ? 'amount must be > 0' : parsed.error };
  const recipient = ctx.policy.allowedDestinations[0] ?? '';
  const simulation = simulateAction(ctx.summary, ctx.policy, { asset, amount });
  return {
    id,
    label,
    action: { type: 'private_transfer', asset, amount, recipient },
    simulation,
    policyCompliant: simulation.ok && simulation.verdict.allowed,
  };
}

/**
 * Build the canonical ExecutionIntent for a selected scenario. Every derived field is computed
 * here deterministically — the model never supplies base units, recipient, policy values,
 * expected numbers, or the execution path.
 */
function buildExecutionIntent(ctx: PlanContext, scenario: AgentScenario): ExecutionIntent {
  const position = positionFor(ctx.summary, scenario.action.asset);
  const parsed = parseAmountExact(scenario.action.amount, position?.decimals ?? 18);
  return {
    executionPath: 'standard',
    asset: scenario.action.asset,
    amountHuman: scenario.action.amount,
    amountBaseUnits: (parsed.ok ? parsed.value : 0n).toString(),
    recipient: scenario.action.recipient,
    guardrailSnapshot: {
      minLiquidityUsd: ctx.policy.minLiquidityUsd,
      maxPositionPct: ctx.policy.maxPositionPct,
      maxTxUsd: ctx.policy.maxTxUsd,
    },
    expectedSimulation: scenario.simulation,
  };
}

function deterministicNarrative(ctx: PlanContext): { observations: string[]; risks: string[] } {
  const diagnosis = buildDiagnosis(ctx.health, ctx.summary);
  const risks: string[] = [];
  if (ctx.health.concentrationRisk === 'high' || ctx.health.concentrationRisk === 'medium') {
    risks.push(`${diagnosis.concentrationLine}`);
  }
  if (!ctx.health.aboveLiquidityTarget) risks.push(`Liquidity is below the ${ctx.policy.minLiquidityUsd} guardrail floor.`);
  if (ctx.health.diversification === 'low') risks.push('Diversification is low.');
  if (ctx.summary.positions.length === 0) risks.push('The treasury is empty.');
  if (ctx.policy.allowedDestinations.length === 0) risks.push('No approved destination is configured, so execution is unavailable.');
  return {
    observations: [diagnosis.concentrationLine, diagnosis.liquidityLine].filter(Boolean),
    risks,
  };
}

/** Deterministic narrative (observations + risks) derived from the real portfolio and policy. */
export function deterministicNarrativeFor(ctx: PlanContext): { observations: string[]; risks: string[] } {
  return deterministicNarrative(ctx);
}

/**
 * Compile a model response into a validated AgentPlan. Accepts either the agent protocol
 * (`{ type: 'plan', … }`) or a legacy single-shot `ActionProposal` (compiled as a one-scenario
 * plan). All scenario numbers are recomputed deterministically — never taken from the model.
 */
export function compileAgentPlan(raw: unknown, ctx: PlanContext): CompilePlanResult {
  // Security: the model can never modify policy or destination controls.
  if (raw !== null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.constraints !== undefined || r.policy !== undefined) {
      return { ok: false, error: 'policy is server-controlled; the agent cannot set constraints or policy' };
    }
  }

  if (isLegacyProposal(raw)) {
    return compileLegacyProposal(raw as Record<string, unknown>, ctx);
  }
  return compileRawPlan(raw, ctx);
}

function isLegacyProposal(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.intent === 'string' && r.action !== undefined && r.type === undefined;
}

function compileLegacyProposal(raw: Record<string, unknown>, ctx: PlanContext): CompilePlanResult {
  const validated = validateProposal(raw);
  if (!validated.ok) return { ok: false, error: validated.error };
  const proposal = validated.value;
  const narrative = deterministicNarrative(ctx);
  const goal = raw.insight ? 'Treasury recommendation' : 'Treasury analysis';

  if (proposal.action.type !== 'private_transfer') {
    const plan: AgentPlan = {
      type: 'plan',
      goal,
      observations: narrative.observations,
      risks: narrative.risks,
      scenarios: [],
      selectedScenarioId: null,
      expectedOutcome: (raw.insight as { outcome?: string } | undefined)?.outcome ?? 'No state-changing action is required.',
      policyStatus: 'ADVISORY',
      requiresUserConfirmation: false,
      reason: proposal.reason,
      executionIntent: null,
    };
    return { ok: true, plan };
  }

  const scenario = buildScenario(ctx, 'candidate-1', `move ${proposal.action.amount}`, proposal.action.asset, proposal.action.amount);
  if ('error' in scenario) return { ok: false, error: scenario.error };
  const insight = raw.insight as { diagnosis?: string; recommendation?: string; why?: string; outcome?: string } | undefined;
  const plan: AgentPlan = {
    type: 'plan',
    goal,
    observations: insight?.diagnosis ? [insight.diagnosis, ...narrative.observations] : narrative.observations,
    risks: narrative.risks,
    scenarios: [scenario],
    selectedScenarioId: 'candidate-1',
    expectedOutcome: insight?.outcome ?? 'The action is evaluated against your guardrail.',
    policyStatus: scenario.policyCompliant ? 'PASS' : 'FAIL',
    requiresUserConfirmation: true,
    reason: proposal.reason,
    executionIntent: buildExecutionIntent(ctx, scenario),
  };
  return { ok: true, plan };
}

function compileRawPlan(raw: unknown, ctx: PlanContext): CompilePlanResult {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: 'plan must be an object' };
  const r = raw as Record<string, unknown>;
  if (r.type !== 'plan') return { ok: false, error: 'model output must be a tool_call or a plan' };
  if (typeof r.goal !== 'string' || r.goal.trim() === '') return { ok: false, error: 'plan.goal missing' };
  if (!Array.isArray(r.scenarios) || r.scenarios.length > 6) return { ok: false, error: 'plan.scenarios must be an array of 0..6' };

  const observations = Array.isArray(r.observations) ? r.observations.filter((o): o is string => typeof o === 'string') : [];
  const risks = Array.isArray(r.risks) ? r.risks.filter((o): o is string => typeof o === 'string') : [];
  const reason = typeof r.reason === 'string' ? r.reason.trim() : 'Treasury analysis';
  const expectedOutcome = typeof r.expectedOutcome === 'string' ? r.expectedOutcome.trim() : '';

  const scenarios: AgentScenario[] = [];
  for (const entry of r.scenarios) {
    if (entry === null || typeof entry !== 'object') return { ok: false, error: 'scenario must be an object' };
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== 'string' || s.id.trim() === '') return { ok: false, error: 'scenario.id missing' };
    const action = s.action;
    if (action === null || action === undefined) return { ok: false, error: 'scenario.action must be a private_transfer' };
    if (typeof action !== 'object') return { ok: false, error: 'scenario.action must be an object' };
    const a = action as Record<string, unknown>;
    if (a.type !== 'private_transfer') return { ok: false, error: `unsupported scenario action type: ${String(a.type)}` };
    if (typeof a.asset !== 'string' || a.asset.trim() === '') return { ok: false, error: 'scenario.action.asset missing' };
    if (typeof a.amount !== 'string' || !/^\d+(\.\d+)?$/.test(a.amount.trim()) || isZeroAmount(a.amount)) {
      return { ok: false, error: 'scenario.action.amount must be a positive plain decimal' };
    }
    const built = buildScenario(ctx, s.id.trim(), typeof s.label === 'string' ? s.label.trim() : `move ${a.amount}`, a.asset.trim(), a.amount.trim());
    if ('error' in built) return { ok: false, error: built.error };
    scenarios.push(built);
  }

  let selectedScenarioId: string | null = null;
  if (typeof r.selectedScenarioId === 'string' && r.selectedScenarioId.trim() !== '') {
    const target = r.selectedScenarioId.trim();
    if (!scenarios.some((sc) => sc.id === target)) return { ok: false, error: `selectedScenarioId does not match any scenario: ${target}` };
    selectedScenarioId = target;
  }

  if (selectedScenarioId === null && scenarios.length > 0) {
    // The agent described candidates but no selection — pick the best compliant one deterministically.
    const best = selectBestAction(
      scenarios.map((sc) => ({
        id: sc.id,
        label: sc.label,
        action: sc.action,
        simulation: sc.simulation,
        policyCompliant: sc.policyCompliant,
        score: scoreCandidate(sc.simulation, sc.policyCompliant),
      })),
    );
    if (best) selectedScenarioId = best.id;
  }

  const selected = selectedScenarioId ? scenarios.find((sc) => sc.id === selectedScenarioId) ?? null : null;
  const policyStatus: PlanPolicyStatus = selected ? (selected.policyCompliant ? 'PASS' : 'FAIL') : 'ADVISORY';
  // Security invariant: any state-changing plan MUST require confirmation. The server forces it.
  const requiresUserConfirmation = selected !== null;

  const plan: AgentPlan = {
    type: 'plan',
    goal: r.goal.trim(),
    observations,
    risks,
    scenarios,
    selectedScenarioId,
    expectedOutcome,
    policyStatus,
    requiresUserConfirmation,
    reason,
    executionIntent: selected ? buildExecutionIntent(ctx, selected) : null,
  };
  return { ok: true, plan };
}

// ─── Validation of the compiled plan (schema guard, used by tests/UI) ───────

export function validateAgentPlan(raw: unknown): { ok: true; value: AgentPlan } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object') return { ok: false, error: 'plan must be an object' };
  const r = raw as Record<string, unknown>;
  if (r.type !== 'plan') return { ok: false, error: 'plan.type must be "plan"' };
  if (typeof r.goal !== 'string' || r.goal.trim() === '') return { ok: false, error: 'plan.goal missing' };
  if (!Array.isArray(r.observations)) return { ok: false, error: 'plan.observations must be an array' };
  if (!Array.isArray(r.risks)) return { ok: false, error: 'plan.risks must be an array' };
  if (!Array.isArray(r.scenarios)) return { ok: false, error: 'plan.scenarios must be an array' };
  for (const sc of r.scenarios) {
    if (sc === null || typeof sc !== 'object') return { ok: false, error: 'scenario must be an object' };
    const s = sc as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.label !== 'string') return { ok: false, error: 'scenario.id and label required' };
    const action = s.action as Record<string, unknown> | null | undefined;
    if (!action || action.type !== 'private_transfer') return { ok: false, error: 'scenario.action must be a private_transfer' };
    if (typeof action.asset !== 'string' || typeof action.amount !== 'string' || typeof action.recipient !== 'string') {
      return { ok: false, error: 'scenario.action.asset/amount/recipient required' };
    }
    if (typeof s.simulation !== 'object' || s.simulation === null) return { ok: false, error: 'scenario.simulation required (deterministic)' };
    if (typeof s.policyCompliant !== 'boolean') return { ok: false, error: 'scenario.policyCompliant required' };
  }
  const selected = r.selectedScenarioId;
  if (selected !== null && (typeof selected !== 'string' || !r.scenarios.some((s) => (s as Record<string, unknown>).id === selected))) {
    return { ok: false, error: 'selectedScenarioId must reference a scenario or be null' };
  }
  const status = r.policyStatus;
  if (status !== 'PASS' && status !== 'FAIL' && status !== 'ADVISORY') return { ok: false, error: 'invalid policyStatus' };
  if (typeof r.requiresUserConfirmation !== 'boolean') return { ok: false, error: 'requiresUserConfirmation must be boolean' };
  if (r.requiresUserConfirmation !== (selected !== null)) return { ok: false, error: 'requiresUserConfirmation must be true iff an action is selected' };
  if (typeof r.reason !== 'string' || r.reason.trim() === '') return { ok: false, error: 'plan.reason missing' };

  // Execution intent: present iff an action is selected, and consistent with the selected scenario.
  const intent = r.executionIntent;
  if (selected === null) {
    if (intent !== null && intent !== undefined) return { ok: false, error: 'executionIntent must be null when no action is selected' };
  } else {
    if (intent === null || typeof intent !== 'object') return { ok: false, error: 'executionIntent required when an action is selected' };
    const it = intent as Record<string, unknown>;
    if (it.executionPath !== 'standard' && it.executionPath !== 'shadow') return { ok: false, error: 'invalid executionPath' };
    const selectedAction = (r.scenarios.find((s) => (s as Record<string, unknown>).id === selected) as Record<string, unknown>).action as Record<string, unknown>;
    if (it.asset !== selectedAction.asset) return { ok: false, error: 'executionIntent.asset must match the selected scenario' };
    if (it.amountHuman !== selectedAction.amount) return { ok: false, error: 'executionIntent.amountHuman must match the selected scenario' };
    if (it.recipient !== selectedAction.recipient) return { ok: false, error: 'executionIntent.recipient must match the selected scenario' };
    if (typeof it.amountBaseUnits !== 'string' || !/^\d+$/.test(it.amountBaseUnits)) return { ok: false, error: 'executionIntent.amountBaseUnits must be a decimal string' };
    const snap = it.guardrailSnapshot as Record<string, unknown> | null | undefined;
    if (!snap || typeof snap !== 'object') return { ok: false, error: 'executionIntent.guardrailSnapshot required' };
    for (const key of ['minLiquidityUsd', 'maxPositionPct', 'maxTxUsd'] as const) {
      if (typeof snap[key] !== 'number') return { ok: false, error: `executionIntent.guardrailSnapshot.${key} required` };
    }
    if (typeof it.expectedSimulation !== 'object' || it.expectedSimulation === null) return { ok: false, error: 'executionIntent.expectedSimulation required' };
  }
  return { ok: true, value: r as unknown as AgentPlan };
}

/** Convenience: pick the selected scenario from a compiled plan. */
export function selectedScenarioOf(plan: AgentPlan): AgentScenario | null {
  if (!plan.selectedScenarioId) return null;
  return plan.scenarios.find((s) => s.id === plan.selectedScenarioId) ?? null;
}

/**
 * JSON-safe plan for the HTTP boundary. Scenario simulations carry exact bigint base units
 * internally; at the API they are serialized as decimal strings so `NextResponse.json` never
 * throws. Numbers the UI displays (concentration, liquidity) are untouched.
 */
export function planToJsonSafe(plan: AgentPlan): AgentPlan {
  const safeSimulation = (sim: ScenarioSimulation) => ({
    ...sim,
    amountBaseUnits: sim.amountBaseUnits.toString(),
    verdict: {
      ...sim.verdict,
      amountBaseUnits: sim.verdict.amountBaseUnits.toString(),
    },
  });
  return {
    ...plan,
    scenarios: plan.scenarios.map((sc) => ({ ...sc, simulation: safeSimulation(sc.simulation) })),
    executionIntent: plan.executionIntent
      ? { ...plan.executionIntent, expectedSimulation: safeSimulation(plan.executionIntent.expectedSimulation) }
      : null,
  } as unknown as AgentPlan;
}

export function planToProposal(plan: AgentPlan): ActionProposal {
  const selected = selectedScenarioOf(plan);
  if (!selected) {
    return {
      intent: 'report',
      reason: plan.reason,
      action: { type: 'report', asset: '', amount: '', recipient: '' },
      requiresUserConfirmation: false,
      insight: {
        diagnosis: plan.observations[0] ?? 'Treasury analysis',
        recommendation: 'No state-changing action is recommended.',
        why: plan.reason,
        outcome: plan.expectedOutcome,
      },
    };
  }
  return {
    intent: 'rebalance',
    reason: plan.reason,
    action: { type: 'private_transfer', asset: selected.action.asset, amount: selected.action.amount, recipient: selected.action.recipient },
    requiresUserConfirmation: true,
    insight: {
      diagnosis: plan.observations[0] ?? 'Treasury analysis',
      recommendation: `Move ${selected.action.amount} to your approved private reserve.`,
      why: `Expected ${selected.action.asset} concentration to fall to ${selected.simulation.after.concentrationPct.toFixed(0)}%.`,
      outcome: plan.expectedOutcome,
    },
  };
}