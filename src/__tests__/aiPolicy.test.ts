import { describe, it, expect } from 'vitest';
import { evaluateProposal, DEFAULT_TREASURY_POLICY, TreasuryPolicy, PolicyVerdict } from '@/ai/policy';
import { PortfolioSummary } from '@/ai/portfolio';
import { ActionProposal } from '@/ai/schema';

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const STRK_CANON = '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
const USDC = '0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343';
const DEST = '0x20cc56b8972d4ecbba9a9eb2629b74f11c89c13a870b83d28658b25a7bda34d';

/** $5,000 STRK (50%, LIVE avnu price $5) + $5,000 USDC (50%, stablecoin). $10k liquid. */
function summary(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    generatedAt: 1,
    totalUsd: 10000,
    liquidityUsd: 10000,
    liquidPct: 100,
    topAsset: { symbol: 'STRK', pct: 50 },
    positions: [
      { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: '1000000000000000000000', balanceHuman: 1000, usdValue: 5000, priceUsd: 5, priceSource: 'avnu', pct: 50, liquid: true },
      { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
    ],
    ...over,
  };
}

function policy(over: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return { ...DEFAULT_TREASURY_POLICY, allowedDestinations: [DEST], ...over };
}

function transfer(asset: string, amount: string, recipient = DEST): ActionProposal {
  return { intent: 'rebalance', reason: 'test', action: { type: 'private_transfer', asset, amount, recipient }, requiresUserConfirmation: true };
}

function check(verdict: PolicyVerdict, id: string) {
  return verdict.checks.find((c) => c.id === id);
}

describe('evaluateProposal — happy path', () => {
  it('allows a small compliant transfer with a live price', () => {
    const v = evaluateProposal(transfer(STRK, '100'), summary(), policy());
    expect(v.allowed).toBe(true);
    expect(v.amountUsd).toBeCloseTo(500, 2);
    expect(v.amountBaseUnits).toBe(100n * 10n ** 18n);
    expect(v.checks.every((c) => c.passed)).toBe(true);
  });

  it('allows advisory reports without execution', () => {
    const v = evaluateProposal(
      { intent: 'report', reason: 'ok', action: { type: 'report', asset: '', amount: '', recipient: '' }, requiresUserConfirmation: false },
      summary(),
      policy(),
    );
    expect(v.allowed).toBe(true);
    expect(v.reportOnly).toBe(true);
    expect(v.amountBaseUnits).toBe(0n);
  });
});

describe('evaluateProposal — exact balance enforcement (bigint)', () => {
  it('allows an exact full-balance transfer (balance check passes at the boundary)', () => {
    const v = evaluateProposal(transfer(STRK, '1000'), summary(), policy());
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
    expect(v.amountBaseUnits).toBe(1000n * 10n ** 18n);
  });

  it('rejects one smallest unit over the balance', () => {
    const v = evaluateProposal(transfer(STRK, '1000.000000000000000001'), summary(), policy());
    expect(check(v, 'amount-exact')?.passed).toBe(true); // parses exactly (18 dp)
    expect(check(v, 'balance-valid')?.passed).toBe(false);
    expect(v.amountBaseUnits).toBe(1000n * 10n ** 18n + 1n);
  });

  it('handles huge bigint balances without precision loss', () => {
    const s = summary({
      positions: [
        { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: (10n ** 45n).toString(), balanceHuman: 1e27, usdValue: 5e27, priceUsd: 5, priceSource: 'avnu', pct: 50, liquid: true },
        { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
      ],
      totalUsd: 5e27,
      liquidityUsd: 5e27,
    });
    const v = evaluateProposal(transfer(STRK, '100000000000000000000000000'), summaryFor(s), policy({ maxTxUsd: 1e9 }));
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
  });

  it('parses a tiny decimal amount exactly and respects the balance', () => {
    const v = evaluateProposal(transfer(STRK, '0.000001'), summary(), policy());
    expect(check(v, 'amount-exact')?.passed).toBe(true);
    expect(v.amountBaseUnits).toBe(10n ** 12n);
    expect(check(v, 'balance-valid')?.passed).toBe(true);
  });

  it('rejects excessive decimal precision instead of rounding', () => {
    const v = evaluateProposal(transfer(STRK, '0.0000000000000000001'), summary(), policy());
    expect(check(v, 'amount-exact')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });

  it('rejects zero, negative and scientific-notation amounts', () => {
    for (const bad of ['0', '0.000', '-5', '1e5', 'NaN', 'Infinity']) {
      const v = evaluateProposal(transfer(STRK, bad), summary(), policy());
      expect(check(v, 'amount-exact')?.passed, `amount ${JSON.stringify(bad)}`).toBe(false);
      expect(v.allowed).toBe(false);
    }
  });
});

describe('evaluateProposal — destination allowlist', () => {
  it('denies ALL execution when no destinations are approved', () => {
    const v = evaluateProposal(transfer(STRK, '1'), summary(), DEFAULT_TREASURY_POLICY);
    expect(check(v, 'destination-valid')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });

  it('allows only approved destinations — the LLM cannot invent one', () => {
    const ok = evaluateProposal(transfer(STRK, '1'), summary(), policy());
    expect(check(ok, 'destination-valid')?.passed).toBe(true);

    const llmInvented = evaluateProposal(transfer(STRK, '1', '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'), summary(), policy());
    expect(check(llmInvented, 'destination-valid')?.passed).toBe(false);
    expect(llmInvented.allowed).toBe(false);
  });
});

describe('evaluateProposal — price safety for execution', () => {
  it('rejects execution on a volatile asset with a static/fallback price', () => {
    const s = summary({
      positions: [
        { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: '1000000000000000000000', balanceHuman: 1000, usdValue: 5000, priceUsd: 5, priceSource: 'static', pct: 50, liquid: true },
        { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
      ],
    });
    const v = evaluateProposal(transfer(STRK, '1'), s, policy());
    const price = check(v, 'price-valid');
    expect(price?.passed).toBe(false);
    if (price) expect(price.detail).toMatch(/live price/);
    expect(v.allowed).toBe(false);
  });

  it('rejects execution when the price is unknown/zero', () => {
    const s = summary({
      positions: [
        { token: STRK, symbol: 'STRK', name: 'STRK', decimals: 18, balanceBase: '1000000000000000000000', balanceHuman: 1000, usdValue: 0, priceUsd: 0, priceSource: 'avnu', pct: 50, liquid: true },
        { token: USDC, symbol: 'USDC', name: 'USDC', decimals: 6, balanceBase: '5000000000', balanceHuman: 5000, usdValue: 5000, priceUsd: 1, priceSource: 'static', pct: 50, liquid: true },
      ],
    });
    const v = evaluateProposal(transfer(STRK, '1'), s, policy());
    expect(check(v, 'price-valid')?.passed).toBe(false);
  });

  it('allows stablecoin execution on its pinned $1 price', () => {
    const v = evaluateProposal(transfer(USDC, '10'), summary(), policy());
    expect(check(v, 'price-valid')?.passed).toBe(true);
  });
});

describe('evaluateProposal — exact boundaries', () => {
  it('allows a tx exactly at the maxTxUsd cap and rejects one cent over', () => {
    const p = policy({ maxTxUsd: 500 });
    const atBoundary = evaluateProposal(transfer(STRK, '100'), summary(), p); // $500
    expect(check(atBoundary, 'max-tx-amount')?.passed).toBe(true);
    expect(atBoundary.allowed).toBe(true);

    const over = evaluateProposal(transfer(STRK, '100.01'), summary(), p); // $500.05
    expect(check(over, 'max-tx-amount')?.passed).toBe(false);
    expect(over.allowed).toBe(false);
  });

  it('allows liquidity to land exactly on the floor and rejects one cent below', () => {
    const p = policy({ maxTxUsd: 20000 });
    const atBoundary = evaluateProposal(transfer(USDC, '9000'), summary(), p); // 10000-9000 = 1000 liquid
    expect(check(atBoundary, 'min-liquidity-after')?.passed).toBe(true);

    const below = evaluateProposal(transfer(USDC, '9001'), summary(), p); // 999 liquid
    expect(check(below, 'min-liquidity-after')?.passed).toBe(false);
    expect(below.allowed).toBe(false);
  });

  it('rejects when a position would exceed the concentration cap after the action', () => {
    const v = evaluateProposal(transfer(USDC, '2000'), summary(), policy()); // STRK -> 62.5%
    expect(check(v, 'max-position-after')?.passed).toBe(false);
    expect(v.allowed).toBe(false);
  });
});

describe('evaluateProposal — policy cannot be weakened by the model', () => {
  it('ignores any model-side constraint; the server policy is authoritative', () => {
    const normal = transfer(STRK, '100');
    const withFakeConstraint = { ...normal, constraints: { minLiquidityAfterUsd: 0, maxPositionPctAfter: 100 } } as unknown as ActionProposal;
    const a = evaluateProposal(normal, summary(), policy());
    const b = evaluateProposal(withFakeConstraint, summary(), policy());
    expect(a.allowed).toBe(b.allowed);
    expect(a.checks.map((c) => [c.id, c.passed])).toEqual(b.checks.map((c) => [c.id, c.passed]));
  });
});

// helper to satisfy TS with an overridden PortfolioSummary
function summaryFor(s: PortfolioSummary): PortfolioSummary {
  return s;
}