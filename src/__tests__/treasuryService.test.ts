import { describe, it, expect, vi } from 'vitest';
import { executeProposal, ExecutionResult } from '@/services/treasuryService';
import { ActionProposal } from '@/ai/schema';
import { TreasuryPolicy, DEFAULT_TREASURY_POLICY } from '@/ai/policy';
import { PrivateBalanceRow } from '@/ai/portfolio';
import { AssetPrice } from '@/ai/prices';
import { SEPOLIA_TOKENS } from '@/config/networks';

const STRK = SEPOLIA_TOKENS.find((t) => t.symbol === 'STRK')!.address;
const USDC = SEPOLIA_TOKENS.find((t) => t.symbol === 'USDC')!.address;
const TREASURY = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

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

function proposal(amount = '10'): ActionProposal {
  return {
    intent: 'rebalance',
    reason: 'Test',
    action: { type: 'private_transfer', asset: STRK, amount, recipient: TREASURY },
    requiresUserConfirmation: true,
  };
}

function policy(): TreasuryPolicy {
  return {
    ...DEFAULT_TREASURY_POLICY,
    minLiquidityUsd: 1000,
    maxPositionPct: 60,
    maxTxUsd: 10000,
    allowedAssets: [],
    allowedDestinations: [TREASURY],
  };
}

/** Fresh avnu prices keyed by raw token address. */
function freshPrices(): Record<string, AssetPrice> {
  return {
    [STRK]: { priceUsd: 0.4, source: 'avnu', priceFetchedAt: NOW },
    [USDC]: { priceUsd: 1, source: 'static', priceFetchedAt: NOW },
  };
}

function baseInput(over: Partial<Parameters<typeof executeProposal>[0]> = {}): Parameters<typeof executeProposal>[0] {
  return {
    proposal: proposal(),
    proposalExpiresAt: NOW + 120_000,
    policy: policy(),
    analysisBalances: balances(),
    currentBalances: balances(),
    resolvePrices: vi.fn(async () => freshPrices()),
    executeTransfer: vi.fn(async () => ({ transactionHash: '0xabc' })),
    now: NOW,
    ...over,
  };
}

async function result(input: ReturnType<typeof baseInput>): Promise<ExecutionResult> {
  return executeProposal(input);
}

describe('executeProposal — execution gate', () => {
  it('executes successfully via the injected privateTransfer path with exact base units', async () => {
    const input = baseInput();
    const res = await result(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.transactionHash).toBe('0xabc');
      expect(res.amountBaseUnits).toBe(10n * 10n ** 18n);
      expect(res.verdict.allowed).toBe(true);
      expect(input.executeTransfer).toHaveBeenCalledTimes(1);
      expect(input.executeTransfer).toHaveBeenCalledWith({
        amountBase: 10n * 10n ** 18n,
        token: STRK,
        recipient: TREASURY,
      });
    }
  });

  it('blocks an EXPIRED proposal before any execution', async () => {
    const input = baseInput({ proposalExpiresAt: NOW - 1 });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXPIRED', detail: expect.any(String) });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('blocks when current balances CHANGED since analysis (requires re-analysis)', async () => {
    const changed = balances({ [STRK]: STRK_BAL - 1n });
    const input = baseInput({ currentBalances: changed });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'STATE_CHANGED', detail: expect.any(String) });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('re-runs the policy and blocks when the fresh verdict no longer allows the action', async () => {
    // The proposal passed analysis, but current state (STRK price now static) fails the
    // fresh-price-for-execution check on re-run.
    const input = baseInput({
      resolvePrices: vi.fn(async () => ({
        ...freshPrices(),
        [STRK]: { priceUsd: 0.4, source: 'static' as const, priceFetchedAt: NOW },
      })),
    });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('Fresh live price') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the amount no longer fits the balance on re-run', async () => {
    const input = baseInput({ proposal: proposal('7000') }); // 7000 STRK > 6250 balance
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'POLICY_REJECTED', detail: expect.stringContaining('Balance') });
    expect(input.executeTransfer).not.toHaveBeenCalled();
  });

  it('rejects an unparseable / over-precision amount before policy re-run', async () => {
    const input = baseInput({ proposal: proposal('10.0000000000000000001') });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'AMOUNT_INVALID', detail: expect.any(String) });
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

  it('handles prover/discovery failure as a human-readable execution failure', async () => {
    const input = baseInput({
      executeTransfer: vi.fn(async () => {
        throw new Error('Prover service unavailable.');
      }),
    });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXECUTION_FAILED', detail: 'Prover service unavailable.' });
  });

  it('reports a missing transaction hash as an execution failure', async () => {
    const input = baseInput({ executeTransfer: vi.fn(async () => ({ transactionHash: '' })) });
    const res = await result(input);
    expect(res).toEqual({ ok: false, reason: 'EXECUTION_FAILED', detail: expect.stringContaining('no transaction hash') });
  });

  it('is deterministic: same inputs yield the same verdict path', async () => {
    const a = await result(baseInput());
    const b = await result(baseInput());
    expect(a.ok).toBe(b.ok);
    if (a.ok && b.ok) expect(a.amountBaseUnits).toBe(b.amountBaseUnits);
  });
});