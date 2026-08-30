import { describe, it, expect } from 'vitest';
import { executeTool, AgentToolContext } from '@/ai/tools';
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
      { token: STRK, balance: 1480n * 10n ** 18n }, // $7,400 @ $5
      { token: USDC, balance: 2600n * 10n ** 6n }, // $2,600
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

function ctx(over: Partial<AgentToolContext> = {}): AgentToolContext {
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
    ...over,
  };
}

function tool(tool: string, args: Record<string, unknown> = {}) {
  return executeTool(ctx(), { type: 'tool_call', tool, args });
}

describe('agent tools — registry', () => {
  it('runs a valid read tool and returns deterministic output', async () => {
    const a = await tool('get_portfolio');
    const b = await tool('get_portfolio');
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect((a.output as { positions: unknown[] }).positions).toHaveLength(2);
      expect(a.output).toEqual(b.ok ? b.output : undefined);
    }
  });

  it('rejects an unsupported tool without executing anything', async () => {
    const r = await tool('send_calldata', { calldata: ['0x1'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported tool/);
  });

  it('rejects low-level tools that must never reach the model', async () => {
    for (const bad of ['sign', 'call_contract', 'execute_arbitrary']) {
      const r = await tool(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it('execution-lifecycle tools are NOT model-callable', async () => {
    for (const bad of ['refresh_portfolio', 'get_execution_status', 'compare_expected_vs_actual']) {
      const r = await tool(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/unsupported tool/);
    }
  });

  it('rejects malformed args for simulate_action', async () => {
    for (const args of [{ asset: STRK, amount: '0' }, { asset: STRK, amount: '1e5' }, { asset: STRK, amount: '-5' }, { asset: STRK }, { amount: '10' }, {}]) {
      const r = await tool('simulate_action', args);
      expect(r.ok, JSON.stringify(args)).toBe(false);
    }
  });

  it('simulate_action returns the real deterministic scenario', async () => {
    const r = await tool('simulate_action', { asset: STRK, amount: '740' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { before: { concentrationPct: number }; after: { concentrationPct: number }; policy: { allowed: boolean } };
      expect(out.before.concentrationPct).toBeCloseTo(74, 0);
      expect(out.after.concentrationPct).toBeLessThan(60);
    }
  });

  it('generate_options returns deterministic policy-ranked candidates', async () => {
    const r = await tool('generate_options', { asset: STRK });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { policyCompliant: boolean; concentrationAfter: number }[];
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.some((c) => c.policyCompliant)).toBe(true);
    }
  });

  it('inspect_risk reports the dominant risk and break-even', async () => {
    const r = await tool('inspect_risk');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { dominantRisk: string; aboveCap: boolean; breakEvenUsd: number | null; liquidityFloor: number };
      expect(out.dominantRisk).toBe('concentration');
      expect(out.aboveCap).toBe(true);
      expect(out.breakEvenUsd).toBeCloseTo(3500, 0);
      expect(out.liquidityFloor).toBe(1000);
    }
  });

  it('get_context reports identity, destinations, and shadow capability (disabled)', async () => {
    const r = await tool('get_context');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { approvedDestinations: string[]; shadowAccountsEnabled: boolean; privateTreasuryAddress: string };
      expect(out.approvedDestinations).toEqual([DEST]);
      expect(out.shadowAccountsEnabled).toBe(false);
      expect(out.privateTreasuryAddress).toBe(STRK);
    }
  });

  it('prepare_action rejects an unapproved recipient', async () => {
    const r = await tool('prepare_action', { asset: STRK, amount: '100', recipient: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not an approved destination/);
  });

  it('prepare_action falls back to the first approved destination, uses the standard path, and never executes', async () => {
    const r = await tool('prepare_action', { asset: STRK, amount: '100' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { prepared: { recipient: string; amountBaseUnits: string }; executionPath: string; note: string };
      expect(out.prepared.recipient).toBe(DEST);
      expect(out.prepared.amountBaseUnits).toBe('100000000000000000000');
      expect(out.executionPath).toBe('standard');
      expect(out.note).toMatch(/never executes|prepared only/);
    }
  });
});