/**
 * @file src/ai/agent.ts
 * @description Hamster treasury agent: a bounded planning loop over deterministic tools.
 *
 * The model emits structured tool calls or a structured AgentPlan as strict JSON. The server
 * runs each tool deterministically and feeds the result back; the loop stops when the model
 * produces a plan (or the step budget is exhausted, in which case a deterministic fallback
 * report is returned). The agent NEVER signs, never sees viewing keys/notes, and never emits
 * arbitrary calldata. The deterministic policy + user confirmation remain the execution gate.
 */
import { AiProvider } from '@/ai/provider';
import { AgentToolContext, executeTool, ToolCallIntent } from '@/ai/tools';
import {
  compileAgentPlan,
  validateAgentPlan,
  AgentPlan,
  PlanContext,
  buildPlanContext,
  planToProposal,
  generateRebalanceCandidates,
  deterministicNarrativeFor,
} from '@/ai/plan';

export const MAX_AGENT_STEPS = 5;

export interface AgentToolTrace {
  step: number;
  tool?: string;
  ok: boolean;
  error?: string;
  summary?: string;
}

export interface AgentLoopResult {
  plan: AgentPlan;
  trace: AgentToolTrace[];
  stepsUsed: number;
}

export function buildAgentSystemPrompt(ctx: AgentToolContext): string {
  const toolLines = TOOL_LIST.map((t) => `- ${t.name}: ${t.desc}`).join('\n');
  return [
    'You are Hamster, the private treasury agent for a STRK20 private treasury on Starknet.',
    'You PROPOSE and PLAN. You never execute. A deterministic policy and the user decide. You never see viewing keys or encrypted notes.',
    '',
    'You operate in a bounded tool loop. Each response MUST be strict JSON, one of:',
    '1. {"type":"tool_call","tool":"<tool>","args":{...}}',
    '2. {"type":"plan", ...} (see schema below)',
    '',
    `AVAILABLE TOOLS (use these; no other tools exist):\n${toolLines}`,
    '',
    'PLAN SCHEMA — the server computes every number; do NOT include computed results:',
    '{',
    '  "type": "plan",',
    '  "goal": "the user goal",',
    '  "observations": ["short finding", "..."],',
    '  "risks": ["short risk", "..."],',
    '  "scenarios": [{ "id": "s1", "label": "move 100 STRK", "action": { "type": "private_transfer", "asset": "0x...", "amount": "100" } }],',
    '  "selectedScenarioId": "s1" | null,',
    '  "expectedOutcome": "one sentence",',
    '  "reason": "one sentence"',
    '}',
    '',
    'RULES:',
    '- Use ONLY assets present in the portfolio and ONLY approved destinations (read them with tools).',
    '- Simulate before deciding: call simulate_action / generate_options / compare_scenarios with candidate amounts.',
    '- Stop with a plan as soon as you can decide. Max 4 tool calls.',
    '- If no compliant action exists, emit a plan with scenarios: [] and selectedScenarioId: null.',
    '- Never invent balances, prices, scenario outcomes, or tool names. Never emit prose outside JSON.',
  ].join('\n');
}

const TOOL_LIST: { name: string; desc: string }[] = [
  { name: 'get_portfolio', desc: 'read the private treasury portfolio (positions, USD values, allocations, prices)' },
  { name: 'get_health', desc: 'read advisory health (concentration, liquidity, diversification)' },
  { name: 'get_policy', desc: 'read the active guardrail and approved destinations' },
  { name: 'get_context', desc: 'read the STRK20 private identity, approved destinations, and shadow-account capability' },
  { name: 'get_activity', desc: 'read recent treasury activity' },
  { name: 'inspect_risk', desc: 'identify the dominant treasury risk (concentration / liquidity / diversification)' },
  { name: 'generate_options', desc: 'generate deterministic, policy-ranked rebalance options for an asset (optional asset)' },
  { name: 'simulate_action', desc: 'simulate moving an amount of an asset (args: asset, amount)' },
  { name: 'compare_scenarios', desc: 'compare 1..6 candidate moves (args: scenarios)' },
  { name: 'prepare_action', desc: 'prepare a private-transfer action for review (never executes)' },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isToolCall(raw: unknown): raw is ToolCallIntent {
  if (!isRecord(raw) || raw.type !== 'tool_call') return false;
  return typeof raw.tool === 'string' && isRecord(raw.args);
}

function isPlanOrProposal(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.type === 'plan') return true;
  // Legacy single-shot proposal (intent + action, no type) — compiled as a one-scenario plan.
  return typeof raw.intent === 'string' && raw.action !== undefined && raw.type === undefined;
}

function traceSummary(result: { ok: true; output: unknown } | { ok: false; error: string }, tool: string): string {
  if (!result.ok) return `${tool}: ${result.error}`;
  const out = result.output as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(out)) return `${tool}: ${out.length} items`;
  if (isRecord(out)) {
    if (typeof out.policyCompliant === 'boolean') return `${tool}: ${out.policyCompliant ? 'compliant' : 'not compliant'}`;
    if (Array.isArray(out.scenarios)) return `${tool}: ${out.scenarios.length} scenarios compared`;
    if (Array.isArray(out.positions)) return `${tool}: ${out.positions.length} positions`;
    if (typeof out.concentrationPct === 'number') return `${tool}: concentration ${out.concentrationPct}%`;
    if (typeof out.liquidityUsd === 'number') return `${tool}: liquidity $${out.liquidityUsd}`;
  }
  return `${tool}: ok`;
}

/**
 * Run the bounded agent loop for one user goal. Returns a validated AgentPlan (never a raw model
 * output) plus a tool trace for the UI. Falls back to a deterministic report when the model
 * cannot produce a plan within the step budget.
 */
export async function runAgentLoop(
  provider: AiProvider,
  ctx: AgentToolContext,
  prompt: string,
): Promise<AgentLoopResult> {
  const planCtx: PlanContext = buildPlanContext(ctx.summary, ctx.policy, ctx.shadowCapability);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: buildAgentSystemPrompt(ctx) },
    { role: 'user', content: prompt },
  ];
  const trace: AgentToolTrace[] = [];

  for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
    const raw = await provider.completeChatJson(messages);

    if (isPlanOrProposal(raw)) {
      const compiled = compileAgentPlan(raw, planCtx);
      if (!compiled.ok) {
        trace.push({ step, ok: false, error: compiled.error });
        messages.push({ role: 'assistant', content: JSON.stringify(raw) });
        messages.push({ role: 'user', content: `Your plan was rejected: ${compiled.error}. Emit a corrected plan or a tool_call.` });
        continue;
      }
      const plan = compiled.plan;
      const validated = validateAgentPlan(plan);
      if (!validated.ok) {
        trace.push({ step, ok: false, error: `invalid compiled plan: ${validated.error}` });
        messages.push({ role: 'user', content: `Plan validation failed: ${validated.error}. Emit a corrected plan.` });
        continue;
      }
      trace.push({ step, ok: true, summary: planRequiresConfirmation(plan) ? `plan: ${plan.scenarios.length} scenarios` : 'plan: advisory' });
      return { plan, trace, stepsUsed: step };
    }

    if (isToolCall(raw)) {
      const result = await executeTool(ctx, raw);
      trace.push({ step, tool: raw.tool, ok: result.ok, error: result.ok ? undefined : result.error, summary: traceSummary(result, raw.tool) });
      messages.push({ role: 'assistant', content: JSON.stringify({ type: 'tool_call', tool: raw.tool, args: raw.args }) });
      messages.push({ role: 'user', content: `TOOL RESULT (${raw.tool}): ${JSON.stringify(result)}` });
      continue;
    }

    // Malformed output — reject without executing anything.
    trace.push({ step, ok: false, error: 'malformed model output' });
    messages.push({ role: 'assistant', content: JSON.stringify(raw) });
    messages.push({
      role: 'user',
      content: 'Your output must be strict JSON: either {"type":"tool_call","tool":"<listed tool>","args":{}} or a plan (type:"plan").',
    });
  }

  // Step budget exhausted — deterministic fallback report.
  const fallback = buildFallbackPlan(planCtx);
  return { plan: fallback, trace, stepsUsed: MAX_AGENT_STEPS };
}

function planRequiresConfirmation(plan: AgentPlan): boolean {
  return plan.selectedScenarioId !== null;
}

/**
 * Deterministic fallback plan used when the model cannot produce one. It reports what it found
 * and why no action is being proposed, and is ALWAYS advisory — a broken/absent model can never
 * auto-generate an executable action.
 */
export function buildFallbackPlan(ctx: PlanContext): AgentPlan {
  const narrative = deterministicNarrativeFor(ctx);
  const candidates = generateRebalanceCandidates(ctx.summary, ctx.policy);
  const plan: AgentPlan = {
    type: 'plan',
    goal: 'Treasury analysis',
    observations: narrative.observations,
    risks: narrative.risks,
    scenarios: candidates.slice(0, 3).map((c) => ({
      id: c.id,
      label: c.label,
      action: { type: 'private_transfer' as const, ...c.action },
      simulation: c.simulation,
      policyCompliant: c.policyCompliant,
    })),
    selectedScenarioId: null,
    expectedOutcome:
      'The agent could not produce a validated plan, so no action is proposed. Use the What-If simulator to explore options manually.',
    policyStatus: 'ADVISORY',
    requiresUserConfirmation: false,
    reason: 'Deterministic fallback after the agent could not produce a plan.',
    executionIntent: null,
  };
  return plan;
}

// Re-export for callers that previously used analyzeTreasury: a one-shot wrapper that runs the
// loop and returns the compiled proposal (for back-compat with any external consumer).
export async function analyzeTreasury(provider: AiProvider, ctx: AgentToolContext, prompt: string): Promise<{ proposal: ReturnType<typeof planToProposal>; plan: AgentPlan }> {
  const { plan } = await runAgentLoop(provider, ctx, prompt);
  return { proposal: planToProposal(plan), plan };
}