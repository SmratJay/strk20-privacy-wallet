import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai/analyze/route';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const USER = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

const PROPOSAL = {
  intent: 'rebalance',
  reason: 'Reduce concentration.',
  action: { type: 'private_transfer', asset: STRK, amount: '10', recipient: USER },
  requiresUserConfirmation: true,
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.AI_API_KEY;
const originalModel = process.env.AI_MODEL;

function body(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    prompt: 'Make my treasury safer while keeping $1,000 liquid.',
    balances: [
      { token: STRK, balance: '500000000000000000000' },
      { token: USDC, balance: '2000000000' },
    ],
    context: { userAddress: USER, privateTreasuryAddress: STRK },
    ...over,
  };
}

function request(over: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body(over)),
  });
}

function mockProposal(proposal: unknown) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: any) => {
    const url = String(input);
    if (url.includes('/chat/completions')) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new TypeError('network unavailable');
  });
}

describe('/api/ai/analyze', () => {
  beforeAll(() => {
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_MODEL = 'test-model';
    // Mock the AI chat-completions endpoint; any other network call (AVNU) throws so prices
    // fall back to the documented static feed (still a valid, successful response).
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(PROPOSAL) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new TypeError('network unavailable');
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalModel;
  });

  it('returns a JSON-safe successful response for a valid request', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    const json = await res.json();

    // bigint serialized as a decimal string (never a raw bigint that JSON.stringify rejects)
    expect(typeof json.verdict.amountBaseUnits).toBe('string');
    expect(json.verdict.amountBaseUnits).toMatch(/^\d+$/);

    // structured proposal + policy checks + freshness
    expect(json.proposal.action.amount).toBe('10');
    expect(Array.isArray(json.verdict.checks)).toBe(true);
    expect(json.verdict.checks.length).toBeGreaterThan(0);
    expect(json.proposalGeneratedAt).toBeGreaterThan(0);
    expect(json.proposalExpiresAt).toBeGreaterThan(json.proposalGeneratedAt);

    // trust boundary is explicit
    expect(json.addresses.verification).toBe('client-claimed');
    expect(json.trust.balances).toBe('wallet-provided-analysis-input');
    // summary is a real privacy-minimized portfolio (aggregates only)
    expect(Array.isArray(json.summary.positions)).toBe(true);
    expect(typeof json.summary.totalUsd).toBe('number');
  });

  it('rejects unknown tokens with 400 (no invented metadata)', async () => {
    const res = await POST(
      request({ balances: [{ token: '0x0000000000000000000000000000000000000000000000000000000000000abc', balance: '1' }] }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/unsupported token/);
  });

  it('rejects an unknown token mixed into a valid list', async () => {
    const res = await POST(
      request({
        balances: [
          { token: STRK, balance: '1' },
          { token: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', balance: '1' },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('validates prompt presence and length', async () => {
    expect((await POST(request({ prompt: '' }))).status).toBe(400);
    expect((await POST(request({ prompt: 'x'.repeat(2001) }))).status).toBe(400);
    expect((await POST(request({ balances: [] }))).status).toBe(400);
  });

  it('never executes a malformed AI proposal — the agent falls back to an advisory plan', async () => {
    const malformed = { ...PROPOSAL, action: { type: 'mint_money', asset: STRK, amount: '1', recipient: USER } };
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(malformed) } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new TypeError('network unavailable');
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const json = await res.json();
    // The unsupported action type is rejected, never executed; the response is a safe advisory plan.
    expect(json.plan.type).toBe('plan');
    expect(json.plan.selectedScenarioId).toBeNull();
    expect(json.proposal.action.type).toBe('report');
    expect(json.proposal.requiresUserConfirmation).toBe(false);
  });

  it('reflects a user-selected preset as the server-authoritative policy', async () => {
    mockProposal(PROPOSAL);
    const res = await POST(request({ policy: { preset: 'conservative' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // The effective policy returned for execution carries the user's chosen guardrail.
    expect(json.policy.minLiquidityUsd).toBe(100);
    expect(json.policy.maxPositionPct).toBe(60);
    expect(json.policy.maxTxUsd).toBe(100);
  });

  it('defaults to the small-wallet-friendly preset when no policy is sent', async () => {
    mockProposal(PROPOSAL);
    const res = await POST(request());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.policy.minLiquidityUsd).toBe(25);
    expect(json.policy.maxPositionPct).toBe(100);
  });

  it('returns a canonical ExecutionIntent on the plan (single executable artifact)', async () => {
    mockProposal(PROPOSAL);
    const res = await POST(request({ policy: { preset: 'conservative' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const intent = json.plan.executionIntent;
    expect(intent).not.toBeNull();
    expect(intent.executionPath).toBe('standard');
    expect(BigInt(intent.asset)).toBe(BigInt(STRK));
    expect(intent.amountHuman).toBe('10');
    expect(intent.amountBaseUnits).toBe('10000000000000000000');
    expect(intent.recipient).toBe(USER); // authoritative approved destination
    expect(intent.guardrailSnapshot).toEqual({ minLiquidityUsd: 100, maxPositionPct: 60, maxTxUsd: 100 });
    expect(typeof intent.expectedSimulation.after.concentrationPct).toBe('number');
  });

  it('rejects an out-of-bounds custom policy with 400 (server validates bounds)', async () => {
    const res = await POST(
      request({ policy: { preset: 'custom', custom: { minLiquidityUsd: -5, maxPositionPct: 80, maxTxUsd: 150 } } }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/out of bounds/);
  });

  it('rejects an unknown preset with 400', async () => {
    const res = await POST(request({ policy: { preset: 'mega-loose' } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/unknown policy preset/);
  });

  it('the AI can never inject its own policy — model output has no policy authority', async () => {
    const withModelPolicy = { ...PROPOSAL, constraints: { minLiquidityAfterUsd: 0 } };
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(withModelPolicy) } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new TypeError('network unavailable');
    });
    const res = await POST(request({ policy: { preset: 'conservative' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // The model's constraints were rejected; the effective policy is the USER-selected preset,
    // and the response is a safe advisory plan (nothing executable was produced).
    expect(json.policy.minLiquidityUsd).toBe(100);
    expect(json.policy.maxPositionPct).toBe(60);
    expect(json.plan.selectedScenarioId).toBeNull();
    expect(json.proposal.action.type).toBe('report');
  });
});