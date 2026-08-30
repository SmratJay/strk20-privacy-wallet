import { describe, it, expect, vi } from 'vitest';
import { executeIntent, ExecuteIntentInput, ExecutionResult } from '@/ai/execution';
import { ExecutionIntent } from '@/ai/plan';
import { simulateAction, DEFAULT_TREASURY_POLICY, TreasuryPolicy } from '@/ai/policy';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';
import { AssetPrice } from '@/ai/prices';
import { verifyExecution } from '@/ai/verification';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

const NOW = 1_700_000_000_000;

const STRK_BAL = 6250n * 10n ** 18n; // 6250 STRK = $2500 @ $0.4
const USDC_BAL = 2500n * 10n ** 6n; // 2500 USDC = $2500

function balances(over: Partial<Record<string, bigint>> = {}): PrivateBalanceRow[] {
  const base: Record<string, bigint> = { [STRK]: STRK_BAL, [USDC]: USDC_BAL };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return Object.entries(base).map(([token, balance]) => ({ token, balance }));
}

function freshPrices(): Record<string, AssetPrice> {
  return {
    [STRK]: { priceUsd: 0.4, source: 'avnu', priceFetchedAt: NOW },
    [USDC]: { priceUsd: 1, source: 'static', priceFetchedAt: NOW },
  };
}

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, minLiquidityUsd: 1000, maxPositionPct: 60, maxTxUsd: 10000, allowedDestinations: [DEST], ...over };
}

function expectedSimulation(): ReturnType<typeof simulateAction> {
  const s = buildPortfolioSummary(balances(), freshPrices());
  return simulateAction(s, policy(), { asset: STRK, amount: '10' });
}

function intent(over: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    executionPath: 'standard',
    asset: STRK,
    amountHuman: '10',
    amountBaseUnits: (10n * 10n ** 18n).toString(),
    recipient: DEST,
    guardrailSnapshot: { minLiquidityUsd: 1000, maxPositionPct: 60, maxTxUsd: 10000 },
    expectedSimulation: expectedSimulation(),
    ...over,
  };
}

function baseInput(over: Partial<ExecuteIntentInput> = {}): ExecuteIntentInput {
  return {
    intent: intent(),
    expiresAt: NOW + 120_000,
    policy: policy(),
    analysisBalances: balances(),
    currentBalances: balances(),
    resolvePrices: vi.fn(async () => freshPrices()),
    executeTransfer: vi.fn(async () => ({ transactionHash: '0xabc' })),
    now: NOW,
    ...over,
  };
}

async function result(input: ExecuteIntentInput): Promise<ExecutionResult> {
  return executeIntent(input);
}

describe('ExecutionRouter — executeIntent', () => {
  it('executes a successful standard private transfer and returns the hash + same-plan expectation', async () => {
    const input = baseInput();
    const res = await result(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.transactionHash).toBe('0xabc');
      expect(res.amountBaseUnits).toBe(10n * 10n ** 18n);
      expect(res.verdict.allowed).toBe(true);
      expect(input.executeTransfer).toHaveBeenCalledTimes(1);
      expect(input.executeTransfer).toHaveBeenCalledWith({ amountBase: 10n * 10n ** 18n, token: STRK, recipient: DEST });
      // The router returns the SAME expected simulation from the plan — used for verification.
      expect(res.expectedSimulation).toBe(input.intent.expectedSimulation);
      // And the expected outcome verifies against the actual (fresh) summary within tolerance.
      expect(verifyExecution(res.expectedSimulation.after, res.summary).matches).toBe(true);
    }
  });

  it('rejects an EXPIRED plan before any execution', async () => {
    const input = baseInput({ expiresAt: NOW - 1 });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXPIRED', detail: expect.any(String) });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects when current balances CHANGED since analysis', async () => {
    const input = baseInput({ currentBalances: balances({ [STRK]: STRK_BAL - 1n }) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'STATE_CHANGED', detail: expect.any(String) });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects a STALE price for a volatile asset on re-run', async () => {
    const input = baseInput({
      resolvePrices: vi.fn(async () => ({ ...freshPrices(), [STRK]: { priceUsd: 0.4, source: 'static' as const, priceFetchedAt: NOW } })),
    });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('Fresh live price') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the current policy differs from the plan snapshot (re-analyze)', async () => {
    const input = baseInput({ policy: policy({ minLiquidityUsd: 5000 }) }); // changed guardrail
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('guardrail changed') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the amount no longer fits the balance on re-run', async () => {
    const input = baseInput({ intent: intent({ amountHuman: '7000', amountBaseUnits: (7000n * 10n ** 18n).toString() }) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('Balance') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects a tampered amount (base units do not match the human amount)', async () => {
    const input = baseInput({ intent: intent({ amountBaseUnits: (11n * 10n ** 18n).toString() }) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'AMOUNT_INVALID', detail: expect.stringContaining('does not match') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects a self-transfer to the treasury identity deterministically', async () => {
    const input = baseInput({ policy: policy({ selfTransferAddress: DEST }), intent: intent({ recipient: DEST }) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('self-transfer') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('accepts only an approved destination — an unapproved recipient is rejected', async () => {
    const input = baseInput({
      intent: intent({ recipient: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }),
    });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('not an approved destination') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('does NOT silently fall back to standard when a shadow path is requested', async () => {
    const input = baseInput({ intent: intent({ executionPath: 'shadow' }) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'SHADOW_UNAVAILABLE', detail: expect.any(String) });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('handles wallet rejection as a human-readable execution failure', async () => {
    const input = baseInput({
      executeTransfer: vi.fn(async () => {
        throw new Error('User rejected the transaction.');
      }),
    });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXECUTION_FAILED', detail: 'User rejected the transaction.' });
  });

  it('reports a missing transaction hash as an execution failure', async () => {
    const input = baseInput({ executeTransfer: vi.fn(async () => ({ transactionHash: '' })) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXECUTION_FAILED', detail: expect.stringContaining('no transaction hash') });
  });
});