import { describe, it, expect } from 'vitest';
import {
  generateRebalanceCandidates,
  selectBestAction,
  rankCandidates,
  concentrationBreakEvenUsd,
  compileAgentPlan,
  validateAgentPlan,
  buildPlanContext,
  PlanContext,
  planToProposal,
} from '@/ai/plan';
import { buildPortfolioSummary, PortfolioSummary } from '@/ai/portfolio';
import { DEFAULT_TREASURY_POLICY, TreasuryPolicy, simulateAction } from '@/ai/policy';
import { getShadowAccountCapability } from '@/ai/shadow';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';
const NOW = Date.now();

function summary(): PortfolioSummary {
  return buildPortfolioSummary(
    [
      { token: STRK, balance: 1480n * 10n ** 18n }, // $7,400 @ $5 (74%)
      { token: USDC, balance: 2600n * 10n ** 6n }, // $2,600 (26%)
    ],
    {
      [STRK]: { priceUsd: 5, source: 'avnu', priceFetchedAt: NOW },
      [USDC]: { priceUsd: 1, source: 'static', priceFetchedAt: NOW },
    },
    NOW,
  );
}

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, minLiquidityUsd: 1000, maxPositionPct: 60, maxTxUsd: 5000, allowedDestinations: [DEST], ...over };
}

function ctx(p = policy()): PlanContext {
  return buildPlanContext(summary(), p, getShadowAccountCapability({}));
}

describe('candidate generation — deterministic', () => {
  it('generates 2..5 candidates for the over-concentrated top asset', () => {
    const candidates = generateRebalanceCandidates(summary(), policy());
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(5);
    for (const c of candidates) {
      expect(c.action.asset).toBe(STRK);
      expect(c.action.recipient).toBe(DEST);
      expect(c.simulation.ok).toBe(true);
      // Non-compliant candidates carry an Infinity sentinel; compliant ones a finite score.
      expect(c.score >= 0).toBe(true);
    }
  });

  it('computed the break-even amount to reach the concentration cap', () => {
    const be = concentrationBreakEvenUsd(summary(), policy(), STRK);
    expect(be).not.toBeNull();
    if (be !== null) expect(be).toBeCloseTo(3500, 0); // (7400 − 0.6·10000) / 0.4
  });

  it('flags policy-violating candidates and ranks compliant ones first', () => {
    const candidates = rankCandidates(generateRebalanceCandidates(summary(), policy()));
    const compliant = candidates.filter((c) => c.policyCompliant);
    const violating = candidates.filter((c) => !c.policyCompliant);
    expect(compliant.length).toBeGreaterThan(0);
    // Every candidate is simulated against the real policy.
    for (const c of candidates) {
      expect(c.policyCompliant).toBe(c.simulation.verdict.allowed);
    }
    // Compliant candidates come before violating ones.
    const firstViolating = violating.length > 0 ? candidates.indexOf(violating[0]) : -1;
    if (firstViolating >= 0) {
      expect(candidates.every((c, i) => !c.policyCompliant || i < firstViolating)).toBe(true);
    }
  });

  it('selectBestAction returns a compliant candidate that reduces concentration below the cap', () => {
    const best = selectBestAction(generateRebalanceCandidates(summary(), policy()));
    expect(best).not.toBeNull();
    if (best) {
      expect(best.policyCompliant).toBe(true);
      expect(best.simulation.after.concentrationPct).toBeLessThanOrEqual(policy().maxPositionPct);
    }
  });

  it('is deterministic for the same inputs', () => {
    const a = generateRebalanceCandidates(summary(), policy());
    const b = generateRebalanceCandidates(summary(), policy());
    expect(a.map((c) => c.action.amount)).toEqual(b.map((c) => c.action.amount));
    expect(a.map((c) => c.score)).toEqual(b.map((c) => c.score));
  });
});

describe('compileAgentPlan — numbers come from the simulator, never the model', () => {
  it('recomputes every scenario with real deterministic math', () => {
    const modelNumbers = {
      type: 'plan',
      goal: 'Reduce concentration.',
      scenarios: [{ id: 's1', label: 'move 740 STRK', action: { type: 'private_transfer', asset: STRK, amount: '740' } }],
      selectedScenarioId: 's1',
      expectedOutcome: 'fabricated number 1%', // model could lie — must be ignored
    };
    const compiled = compileAgentPlan(modelNumbers, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const sc = compiled.plan.scenarios[0];
      const real = simulateAction(summary(), policy(), { asset: STRK, amount: '740' });
      expect(sc.simulation.after.concentrationPct).toBe(real.after.concentrationPct);
      expect(sc.policyCompliant).toBe(true);
      expect(compiled.plan.policyStatus).toBe('PASS');
    }
  });

  it('forces requiresUserConfirmation true whenever an action is selected', () => {
    const raw = {
      type: 'plan',
      goal: 'g',
      scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '740' } }],
      selectedScenarioId: 's1',
      requiresUserConfirmation: false, // model attempts to skip confirmation
    };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.plan.requiresUserConfirmation).toBe(true);
      // And the compiled plan passes its own schema check.
      expect(validateAgentPlan(compiled.plan).ok).toBe(true);
    }
  });

  it('produces an advisory plan when no action is selected', () => {
    const raw = { type: 'plan', goal: 'g', scenarios: [], selectedScenarioId: null };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.plan.policyStatus).toBe('ADVISORY');
      expect(compiled.plan.requiresUserConfirmation).toBe(false);
      expect(planToProposal(compiled.plan).action.type).toBe('report');
    }
  });

  it('rejects arbitrary / unsupported scenario actions', () => {
    const raw = {
      type: 'plan',
      goal: 'g',
      scenarios: [{ id: 's1', label: 'x', action: { type: 'mint_money', asset: STRK, amount: '1' } }],
    };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(false);
  });

  it('rejects a selectedScenarioId that does not reference a scenario', () => {
    const raw = {
      type: 'plan',
      goal: 'g',
      scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '10' } }],
      selectedScenarioId: 'nope',
    };
    expect(compileAgentPlan(raw, ctx()).ok).toBe(false);
  });

  it('rejects model attempts to set policy or constraints', () => {
    const raw = { type: 'plan', goal: 'g', scenarios: [], policy: { minLiquidityUsd: 0 } };
    expect(compileAgentPlan(raw, ctx()).ok).toBe(false);
    const raw2 = { type: 'plan', goal: 'g', scenarios: [], constraints: { maxPositionPctAfter: 100 } };
    expect(compileAgentPlan(raw2, ctx()).ok).toBe(false);
  });

  it('compiles a legacy single-shot proposal into a one-scenario plan', () => {
    const legacy = {
      intent: 'rebalance',
      reason: 'Reduce concentration.',
      action: { type: 'private_transfer', asset: STRK, amount: '740', recipient: DEST },
      requiresUserConfirmation: true,
    };
    const compiled = compileAgentPlan(legacy, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.plan.scenarios).toHaveLength(1);
      expect(compiled.plan.selectedScenarioId).toBe('candidate-1');
      expect(compiled.plan.requiresUserConfirmation).toBe(true);
    }
  });
});

describe('validateAgentPlan — schema guard', () => {
  it('rejects a plan whose confirmation flag contradicts an action', () => {
    const plan = {
      type: 'plan',
      goal: 'g',
      observations: [],
      risks: [],
      scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '10', recipient: DEST }, simulation: simulateAction(summary(), policy(), { asset: STRK, amount: '10' }), policyCompliant: true }],
      selectedScenarioId: 's1',
      expectedOutcome: 'o',
      policyStatus: 'PASS',
      requiresUserConfirmation: false, // inconsistent
      reason: 'r',
    };
    const r = validateAgentPlan(plan);
    expect(r.ok).toBe(false);
  });

  it('accepts a well-formed compiled plan', () => {
    const raw = { type: 'plan', goal: 'g', scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '740' } }], selectedScenarioId: 's1' };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(validateAgentPlan(compiled.plan).ok).toBe(true);
  });
});

describe('ExecutionIntent — the plan becomes the executable artifact', () => {
  it('compiles exact base units, recipient, and guardrail snapshot deterministically', () => {
    const raw = { type: 'plan', goal: 'g', scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '740' } }], selectedScenarioId: 's1' };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const intent = compiled.plan.executionIntent;
      expect(intent).not.toBeNull();
      if (intent) {
        expect(intent.executionPath).toBe('standard');
        expect(intent.asset).toBe(STRK);
        expect(intent.amountHuman).toBe('740');
        expect(intent.amountBaseUnits).toBe((740n * 10n ** 18n).toString());
        expect(intent.recipient).toBe(DEST); // first approved destination (authoritative)
        expect(intent.guardrailSnapshot).toEqual({ minLiquidityUsd: 1000, maxPositionPct: 60, maxTxUsd: 5000 });
        // The expected simulation is the real deterministic one (the same used for verification).
        expect(intent.expectedSimulation.after.concentrationPct).toBeLessThan(60);
      }
    }
  });

  it('ignores any model-supplied intent — the server recomputes everything', () => {
    const raw = {
      type: 'plan',
      goal: 'g',
      scenarios: [{ id: 's1', label: 'x', action: { type: 'private_transfer', asset: STRK, amount: '740' } }],
      selectedScenarioId: 's1',
      executionIntent: {
        executionPath: 'shadow',
        asset: '0xdead',
        amountHuman: '99999',
        amountBaseUnits: '1',
        recipient: '0xattacker',
        guardrailSnapshot: { minLiquidityUsd: 0, maxPositionPct: 100, maxTxUsd: 100000000 },
        expectedSimulation: { fake: true },
      },
    };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const intent = compiled.plan.executionIntent!;
      // The model's injected intent is dropped; the server-compiled one is authoritative.
      expect(intent.executionPath).toBe('standard');
      expect(intent.asset).toBe(STRK);
      expect(intent.amountHuman).toBe('740');
      expect(intent.recipient).toBe(DEST);
      expect(intent.guardrailSnapshot.minLiquidityUsd).toBe(1000);
      expect(intent.expectedSimulation).not.toHaveProperty('fake');
    }
  });

  it('is null for advisory plans', () => {
    const raw = { type: 'plan', goal: 'g', scenarios: [], selectedScenarioId: null };
    const compiled = compileAgentPlan(raw, ctx());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.plan.executionIntent).toBeNull();
      expect(validateAgentPlan(compiled.plan).ok).toBe(true);
    }
  });
});