import { describe, it, expect } from 'vitest';
import { runAgentLoop, buildAgentSystemPrompt, MAX_AGENT_STEPS } from '@/ai/agent';
import { AiProvider } from '@/ai/provider';
import { AgentToolContext } from '@/ai/tools';
import { buildPortfolioSummary, PortfolioSummary } from '@/ai/portfolio';
import { computeTreasuryHealth } from '@/ai/health';
import { DEFAULT_TREASURY_POLICY, TreasuryPolicy } from '@/ai/policy';
import { getShadowAccountCapability } from '@/ai/shadow';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
const NOW = Date.now();

function summary(): PortfolioSummary {
  return buildPortfolioSummary(
    [
      { token: STRK, balance: 1480n * 10n ** 18n },
      { token: USDC, balance: 2600n * 10n ** 6n },
    ],
    {
      [STRK]: { priceUsd: 5, source: 'avnu', priceFetchedAt: NOW },
      [USDC]: { priceUsd: 1, source: 'static', priceFetchedAt: NOW },
    },
    NOW,
  );
}

function policy(): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, minLiquidityUsd: 1000, maxPositionPct: 60, maxTxUsd: 5000, allowedDestinations: [DEST] };
}

function ctx(): AgentToolContext {
  const s = summary();
  const p = policy();
  return {
    summary: s,
    policy: p,
    health: computeTreasuryHealth(s, p),
    prices: {},
    identity: { userAddress: DEST, privateTreasuryAddress: STRK, verification: 'client-claimed' },
    recentActivity: [],
    shadowCapability: getShadowAccountCapability({}),
  };
}

const PLAN_RAW = {
  type: 'plan',
  goal: 'Make my treasury safer.',
  observations: ['74% of the treasury is STRK.'],
  risks: ['Above the 60% concentration cap.'],
  scenarios: [{ id: 's1', label: 'move 740 STRK', action: { type: 'private_transfer', asset: STRK, amount: '740' } }],
  selectedScenarioId: 's1',
  expectedOutcome: 'Concentration falls below the cap.',
  reason: 'Reduce concentration.',
};

function scriptedProvider(responses: unknown[]): AiProvider {
  let i = 0;
  return {
    completeJson: async () => responses[0],
    completeChatJson: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

describe('runAgentLoop — bounded planning loop', () => {
  it('executes tool calls deterministically and stops at the plan', async () => {
    const provider = scriptedProvider([
      { type: 'tool_call', tool: 'get_portfolio', args: {} },
      { type: 'tool_call', tool: 'simulate_action', args: { asset: STRK, amount: '740' } },
      PLAN_RAW,
    ]);
    const { plan, trace, stepsUsed } = await runAgentLoop(provider, ctx(), 'Make my treasury safer.');
    expect(stepsUsed).toBe(3);
    expect(trace).toHaveLength(3);
    expect(trace[0].tool).toBe('get_portfolio');
    expect(trace[0].ok).toBe(true);
    expect(trace[1].tool).toBe('simulate_action');
    expect(trace[1].ok).toBe(true);
    expect(plan.selectedScenarioId).toBe('s1');
    expect(plan.policyStatus).toBe('PASS');
    // Scenario numbers are real, not from the model.
    expect(plan.scenarios[0].simulation.after.concentrationPct).toBeLessThan(60);
  });

  it('rejects an unsupported tool and keeps the loop bounded', async () => {
    const provider = scriptedProvider([
      { type: 'tool_call', tool: 'send_calldata', args: { calldata: ['0x1'] } },
      PLAN_RAW,
    ]);
    const { plan, trace } = await runAgentLoop(provider, ctx(), 'x');
    expect(trace[0].ok).toBe(false);
    expect(trace[0].error).toMatch(/unsupported tool/);
    expect(plan.selectedScenarioId).toBe('s1');
  });

  it('falls back to an advisory report when the model never produces a plan', async () => {
    const provider = scriptedProvider([{ type: 'garbage', nonsense: true }]);
    const { plan, trace, stepsUsed } = await runAgentLoop(provider, ctx(), 'x');
    expect(stepsUsed).toBe(MAX_AGENT_STEPS);
    expect(trace.filter((t) => !t.ok).length).toBeGreaterThan(0);
    expect(plan.type).toBe('plan');
    expect(plan.selectedScenarioId).toBeNull();
    expect(plan.policyStatus).toBe('ADVISORY');
    expect(plan.requiresUserConfirmation).toBe(false);
  });

  it('never lets a malformed plan become an executable action', async () => {
    const malformed = { type: 'plan', goal: 'g', scenarios: [{ id: 's1', action: { type: 'mint_money', asset: STRK, amount: '1' } }] };
    const provider = scriptedProvider([malformed]);
    const { plan } = await runAgentLoop(provider, ctx(), 'x');
    expect(plan.selectedScenarioId).toBeNull();
    expect(plan.requiresUserConfirmation).toBe(false);
  });

  it('lists only the supported tools in the system prompt', () => {
    const prompt = buildAgentSystemPrompt(ctx());
    for (const forbidden of ['send_calldata', 'sign', 'call_contract', 'refresh_portfolio', 'get_execution_status']) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(prompt).toContain('simulate_action');
    expect(prompt).toContain('get_portfolio');
    expect(prompt).toContain('prepare_action');
  });
});